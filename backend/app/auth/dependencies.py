from __future__ import annotations

from collections.abc import Callable

from fastapi import HTTPException, Request, status


def current_user(request: Request) -> dict:
    user = getattr(request.state, "auth_user", None)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sesión no válida o expirada.")
    return user


def require_roles(*roles: str) -> Callable[[Request], dict]:
    allowed = frozenset(roles)

    def dependency(request: Request) -> dict:
        user = current_user(request)
        if user.get("role") not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No cuenta con permisos para esta operación.")
        return user

    return dependency
