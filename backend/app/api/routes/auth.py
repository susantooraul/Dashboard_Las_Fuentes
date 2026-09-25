from __future__ import annotations

import ipaddress
import logging
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.auth.dependencies import require_roles
from app.auth.service import (
    AccountLockedError,
    DuplicateUserError,
    InactiveUserError,
    InvalidCredentialsError,
    LastAdministratorError,
    UserNotFoundError,
)
from app.config import get_settings
from app.schemas.auth import (
    AuthUser,
    ChangePasswordRequest,
    LoginRequest,
    LoginResponse,
    MeResponse,
    PasswordResetRequest,
    SetupStatusResponse,
    UserCreateRequest,
    UserUpdateRequest,
)

router = APIRouter(prefix='/auth', tags=['auth'])
settings = get_settings()
logger = logging.getLogger(__name__)
_admin_required = Depends(require_roles('admin'))


def _client_ip(request: Request) -> str | None:
    # cloudflared conserva CF-Connecting-IP. El backend de planta normalmente
    # escucha solo en localhost, por lo que este encabezado llega desde el proxy
    # de confianza. Si no existe o es inválido, usamos request.client.host.
    candidate = (request.headers.get('cf-connecting-ip') or '').strip()
    if candidate:
        try:
            return str(ipaddress.ip_address(candidate))
        except ValueError:
            pass
    return request.client.host if request.client else None


def _request_origin(request: Request) -> str:
    origin = (request.headers.get('origin') or '').strip().rstrip('/')
    if origin and origin.lower() != 'null':
        return origin
    referer = (request.headers.get('referer') or '').strip()
    if not referer:
        return ''
    try:
        parsed = urlsplit(referer)
    except ValueError:
        return ''
    if not parsed.scheme or not parsed.netloc:
        return ''
    return f"{parsed.scheme}://{parsed.netloc}".rstrip('/')


def _is_loopback_client(request: Request) -> bool:
    client_host = request.client.host if request.client else ''
    try:
        return bool(client_host and ipaddress.ip_address(client_host).is_loopback)
    except ValueError:
        return client_host.lower() in {'localhost', 'testclient'}


def _bos_local_compat_request(request: Request) -> bool:
    """Compatibilidad controlada para Blue Open Studio/WebBrowser local.

    Vite proxifica las peticiones locales al backend desde loopback. El dominio
    HTTPS/Cloudflare conserva el flujo completo con cookie Secure y browser
    binding; este modo sólo aplica a HTTP local/LAN autorizado.
    """
    if not settings.auth_bos_local_compat_mode:
        return False
    origin = _request_origin(request)
    if origin and origin not in settings.auth_local_http_origins:
        return False
    if origin.lower().startswith('https://'):
        return False
    forwarded_proto = (request.headers.get('x-forwarded-proto') or '').split(',')[0].strip().lower()
    if forwarded_proto == 'https':
        return False
    if request.headers.get('cf-connecting-ip') or request.headers.get('cf-ray'):
        return False
    return _is_loopback_client(request) and request.url.scheme.lower() == 'http'


def _cookie_secure_for_request(request: Request) -> tuple[bool, str]:
    """Conserva Secure en HTTPS y usa cookie HTTP sólo en modo local/BOS."""
    origin = _request_origin(request)
    if origin:
        if origin in settings.auth_local_http_origins:
            return False, 'explicit_local_http_origin'
        if origin.lower().startswith('https://'):
            return settings.auth_cookie_secure, 'explicit_https_origin'

    forwarded_proto = (request.headers.get('x-forwarded-proto') or '').split(',')[0].strip().lower()
    if forwarded_proto == 'https':
        return settings.auth_cookie_secure, 'forwarded_https'

    if request.headers.get('cf-connecting-ip') or request.headers.get('cf-ray'):
        return settings.auth_cookie_secure, 'cloudflare'

    if _bos_local_compat_request(request):
        return False, 'bos_local_compat'

    return settings.auth_cookie_secure, 'default'


def _set_auth_cookie(
    response: Response,
    *,
    key: str,
    value: str,
    secure: bool,
    legacy_local_http: bool = False,
) -> None:
    cookie_options: dict[str, int] = {}
    if not settings.auth_cookie_session_only:
        cookie_options['max_age'] = settings.auth_session_absolute_hours * 3600
    response.set_cookie(
        key=key,
        value=value,
        httponly=True,
        secure=secure,
        samesite=None if legacy_local_http else settings.auth_cookie_samesite,
        path='/',
        **cookie_options,
    )


def _set_session_cookies(
    request: Request,
    response: Response,
    *,
    token: str,
    browser_session: str,
) -> None:
    secure, policy_source = _cookie_secure_for_request(request)
    bos_local_compat = _bos_local_compat_request(request)
    legacy_local_http = bool(settings.auth_cookie_secure and not secure)

    if bos_local_compat:
        # Modo BOS/LAN local: una sola cookie para maximizar compatibilidad con
        # WebBrowser legacy. Si la descarta, el frontend usa X-ARCA-Local-Session.
        _set_auth_cookie(
            response,
            key=settings.auth_cookie_name,
            value=token,
            secure=False,
            legacy_local_http=True,
        )
    else:
        _set_auth_cookie(response, key=settings.auth_cookie_name, value=token, secure=secure)
        _set_auth_cookie(
            response,
            key=settings.auth_browser_cookie_name,
            value=browser_session,
            secure=secure,
        )

    logger.warning(
        'auth_cookie_policy secure=%s source=%s legacy_local_http=%s bos_local_compat=%s client=%s origin_present=%s forwarded_proto=%s',
        secure,
        policy_source,
        legacy_local_http,
        bos_local_compat,
        request.client.host if request.client else 'unknown',
        bool(_request_origin(request)),
        (request.headers.get('x-forwarded-proto') or '').split(',')[0].strip().lower() or 'missing',
    )


@router.get('/setup-status', response_model=SetupStatusResponse)
def setup_status(request: Request):
    return SetupStatusResponse(configured=request.app.state.auth_service.has_admin())


@router.post('/login', response_model=LoginResponse)
def login(payload: LoginRequest, request: Request, response: Response):
    service = request.app.state.auth_service
    if not service.has_admin():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail='No hay un administrador configurado. Realice la configuración inicial en el servidor.',
        )
    try:
        session = service.authenticate(
            username=payload.username,
            password=payload.password,
            ip_address=_client_ip(request),
            user_agent=request.headers.get('user-agent'),
        )
    except (InvalidCredentialsError, AccountLockedError, InactiveUserError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Usuario o contraseña incorrectos.') from exc
    _set_session_cookies(
        request,
        response,
        token=session.token,
        browser_session=session.browser_session,
    )
    return LoginResponse(
        user=AuthUser(**session.user),
        browser_session=session.browser_session,
        csrf_token=session.csrf_token,
        expires_at=session.expires_at,
        # Fallback deliberado para WebBrowser legacy/BOS. Sólo se expone en
        # trafico HTTP local autorizado; nunca en el dominio HTTPS.
        local_session_token=session.token if _bos_local_compat_request(request) else None,
    )


@router.get('/me', response_model=MeResponse)
def me(request: Request):
    session = request.state.auth_session
    return MeResponse(
        user=AuthUser(**session['user']),
        csrf_token=request.app.state.auth_service.csrf_token_for_session(session),
        expires_at=session['expires_at'],
    )


@router.post('/change-password')
def change_password(payload: ChangePasswordRequest, request: Request):
    session = request.state.auth_session
    user = request.state.auth_user
    try:
        request.app.state.auth_service.change_password(
            int(user['id']),
            payload.current_password,
            payload.new_password,
            current_session_id=int(session['id']),
            ip_address=_client_ip(request),
        )
    except InvalidCredentialsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except UserNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {'message': 'Contraseña actualizada. La sesión actual permanece activa y las demás sesiones fueron revocadas.'}


@router.post('/logout')
def logout(request: Request, response: Response):
    request.app.state.auth_service.revoke_session(int(request.state.auth_session['id']))
    secure, _ = _cookie_secure_for_request(request)
    legacy_local_http = bool(settings.auth_cookie_secure and not secure)
    for cookie_name in (settings.auth_cookie_name, settings.auth_browser_cookie_name):
        response.delete_cookie(
            key=cookie_name,
            path='/',
            secure=secure,
            httponly=True,
            samesite=None if legacy_local_http else settings.auth_cookie_samesite,
        )
    return {'message': 'Sesión cerrada.'}


@router.get('/users', response_model=list[AuthUser], dependencies=[_admin_required])
def list_users(request: Request):
    return [AuthUser(**user) for user in request.app.state.auth_service.list_users()]


@router.post('/users', response_model=AuthUser, status_code=status.HTTP_201_CREATED, dependencies=[_admin_required])
def create_user(payload: UserCreateRequest, request: Request):
    actor = request.state.auth_user
    try:
        user = request.app.state.auth_service.create_user(
            **payload.model_dump(),
            actor_user_id=int(actor['id']),
            ip_address=_client_ip(request),
        )
    except DuplicateUserError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return AuthUser(**user)


@router.patch('/users/{user_id}', response_model=AuthUser, dependencies=[_admin_required])
def update_user(user_id: int, payload: UserUpdateRequest, request: Request):
    actor = request.state.auth_user
    try:
        user = request.app.state.auth_service.update_user(
            user_id,
            **payload.model_dump(exclude_unset=True),
            actor_user_id=int(actor['id']),
            ip_address=_client_ip(request),
        )
    except UserNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except LastAdministratorError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return AuthUser(**user)


@router.post('/users/{user_id}/reset-password', dependencies=[_admin_required])
def reset_password(user_id: int, payload: PasswordResetRequest, request: Request):
    actor = request.state.auth_user
    try:
        request.app.state.auth_service.reset_password(
            user_id,
            payload.password,
            actor_user_id=int(actor['id']),
            ip_address=_client_ip(request),
        )
    except UserNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {'message': 'Contraseña actualizada y sesiones revocadas.'}


@router.post('/users/{user_id}/revoke-sessions', dependencies=[_admin_required])
def revoke_sessions(user_id: int, request: Request):
    actor = request.state.auth_user
    try:
        request.app.state.auth_service.revoke_user_sessions(
            user_id,
            actor_user_id=int(actor['id']),
            ip_address=_client_ip(request),
        )
    except UserNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {'message': 'Sesiones revocadas.'}
