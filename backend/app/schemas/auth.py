from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

RoleName = Literal['admin', 'operator', 'viewer']


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=1024)


class AuthUser(BaseModel):
    id: int
    username: str
    display_name: str
    name: str
    role: RoleName
    is_active: bool = True
    is_locked: bool = False
    locked_until: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    last_login_at: str | None = None


class LoginResponse(BaseModel):
    user: AuthUser
    browser_session: str
    csrf_token: str
    expires_at: str
    # Solo se entrega para el modo local/BOS. En HTTPS permanece None y la
    # autenticacion principal sigue exclusivamente en cookie HttpOnly.
    local_session_token: str | None = None


class MeResponse(BaseModel):
    user: AuthUser
    csrf_token: str
    expires_at: str


class SetupStatusResponse(BaseModel):
    configured: bool


class UserCreateRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    display_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=10, max_length=1024)
    role: RoleName
    is_active: bool = True


class UserUpdateRequest(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    role: RoleName | None = None
    is_active: bool | None = None


class PasswordResetRequest(BaseModel):
    password: str = Field(min_length=10, max_length=1024)
