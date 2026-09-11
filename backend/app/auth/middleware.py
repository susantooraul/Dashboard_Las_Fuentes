from __future__ import annotations

import logging
import ipaddress

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import get_settings

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
BROWSER_SESSION_HEADER = "X-ARCA-Browser-Session"
LOCAL_SESSION_HEADER = "X-ARCA-Local-Session"
USER_ACTIVITY_HEADER = "X-ARCA-User-Activity"
logger = logging.getLogger(__name__)
settings = get_settings()




def _request_origin(request) -> str:
    origin = (request.headers.get("origin") or "").strip().rstrip("/")
    if not origin or origin.lower() == "null":
        return ""
    return origin


def _is_loopback_client(request) -> bool:
    host = request.client.host if request.client else ""
    try:
        return bool(host and ipaddress.ip_address(host).is_loopback)
    except ValueError:
        return host.lower() in {"localhost", "testclient"}


def _bos_local_compat_request(request) -> bool:
    if not settings.auth_bos_local_compat_mode:
        return False
    origin = _request_origin(request)
    if origin and origin not in settings.auth_local_http_origins:
        return False
    if origin.lower().startswith("https://"):
        return False
    forwarded_proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
    if forwarded_proto == "https":
        return False
    if request.headers.get("cf-connecting-ip") or request.headers.get("cf-ray"):
        return False
    return _is_loopback_client(request) and request.url.scheme.lower() == "http"


class LocalAuthMiddleware(BaseHTTPMiddleware):
    """Valida sesion/CSRF para toda la API y aplica denegacion segura por defecto."""

    def __init__(self, app, *, api_prefix: str, cookie_name: str, browser_cookie_name: str, csrf_header: str):
        super().__init__(app)
        self.api_prefix = api_prefix.rstrip("/")
        self.cookie_name = cookie_name
        self.browser_cookie_name = browser_cookie_name
        self.csrf_header = csrf_header
        self.public_paths = {
            "/",
            "/health/db",
            f"{self.api_prefix}/auth/login",
            f"{self.api_prefix}/auth/setup-status",
        }
        # Operador solo puede mutar las operaciones explicitamente autorizadas.
        # Cualquier nueva mutacion queda denegada hasta declararla de forma consciente.
        self.operator_mutation_paths = {
            f"{self.api_prefix}/auth/logout",
            f"{self.api_prefix}/water/reports/daily/email",
            f"{self.api_prefix}/email/report",
        }

    async def dispatch(self, request, call_next):
        path = request.url.path
        if request.method == "OPTIONS" or path in self.public_paths:
            return await call_next(request)
        if not path.startswith(self.api_prefix):
            return await call_next(request)

        service = request.app.state.auth_service
        bos_local_compat = _bos_local_compat_request(request)
        raw_session_cookie = request.cookies.get(self.cookie_name)
        local_session_header = request.headers.get(LOCAL_SESSION_HEADER) if bos_local_compat else None
        embedded_browser_session = None
        session_token = raw_session_cookie or local_session_header
        if session_token and '~' in session_token:
            session_token, embedded_browser_session = session_token.split('~', 1)

        # La cookie HttpOnly auxiliar permite que Blue Open Studio funcione aun
        # cuando su WebBrowser no soporte storage/BroadcastChannel de forma fiable.
        browser_session = (
            request.cookies.get(self.browser_cookie_name)
            or request.headers.get(BROWSER_SESSION_HEADER)
            or embedded_browser_session
        )
        session = service.get_session(
            session_token,
            browser_session,
            require_browser_session=False if bos_local_compat else None,
        )
        if not session:
            logger.warning(
                'auth_session_rejected path=%s session_cookie=%s local_header=%s browser_binding=%s composite_cookie=%s bos_local_compat=%s',
                path,
                bool(raw_session_cookie),
                bool(local_session_header),
                bool(browser_session),
                bool(embedded_browser_session),
                bos_local_compat,
            )
            return JSONResponse(status_code=401, content={"detail": "Sesión no válida o expirada."})

        user = session["user"]
        request.state.auth_session = session
        request.state.auth_user = user

        if request.headers.get(USER_ACTIVITY_HEADER) == "1":
            service.touch_session(int(session["id"]))

        if request.method not in SAFE_METHODS:
            if not service.validate_csrf(session, request.headers.get(self.csrf_header)):
                return JSONResponse(
                    status_code=403,
                    content={"detail": "La validación de seguridad de la solicitud no es válida."},
                )

            role = str(user.get("role") or "")
            if role == "viewer" and path != f"{self.api_prefix}/auth/logout":
                return JSONResponse(status_code=403, content={"detail": "No cuenta con permisos para esta operación."})
            if role == "operator" and path not in self.operator_mutation_paths:
                return JSONResponse(status_code=403, content={"detail": "No cuenta con permisos para esta operación."})

        return await call_next(request)


class ApiExceptionBoundaryMiddleware(BaseHTTPMiddleware):
    """Convierte errores no controlados dentro de CORS para conservar headers."""

    async def dispatch(self, request, call_next):
        try:
            return await call_next(request)
        except Exception:
            logger.exception("unhandled_request_error path=%s", request.url.path)
            return JSONResponse(status_code=500, content={"detail": "Error interno del servidor."})
