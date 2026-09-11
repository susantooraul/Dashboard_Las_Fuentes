from __future__ import annotations

import getpass

from app.auth.security import PasswordPolicyError
from app.auth.service import AuthPolicy, AuthService, DuplicateUserError
from app.config import get_settings


def main() -> int:
    settings = get_settings()
    service = AuthService(
        settings.auth_database_file,
        AuthPolicy(
            idle_hours=settings.auth_session_idle_hours,
            absolute_hours=settings.auth_session_absolute_hours,
            max_failed_attempts=settings.auth_max_failed_attempts,
            lock_minutes=settings.auth_lock_minutes,
            require_browser_session=settings.auth_require_browser_session,
        ),
    )
    service.initialize()

    print('Crear administrador local de Planta Las Fuentes')
    username = input('Usuario: ').strip()
    display_name = input('Nombre visible: ').strip()
    password = getpass.getpass('Contraseña: ')
    confirmation = getpass.getpass('Confirmar contraseña: ')
    if password != confirmation:
        print('Las contraseñas no coinciden.')
        return 2

    try:
        user = service.create_user(
            username=username,
            display_name=display_name,
            password=password,
            role='admin',
            is_active=True,
        )
    except (PasswordPolicyError, ValueError, DuplicateUserError) as exc:
        print(str(exc))
        return 2

    print(f"Administrador creado: {user['username']}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
