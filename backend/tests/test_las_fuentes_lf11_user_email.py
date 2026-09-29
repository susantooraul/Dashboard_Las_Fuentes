from __future__ import annotations

from pathlib import Path

import pytest

from app.auth.security import normalize_username
from app.auth.service import AuthService, DuplicateUserError, InvalidCredentialsError


def test_normalize_accepts_legacy_username_and_email() -> None:
    assert normalize_username("Adriana_Flores1") == "adriana_flores1"
    assert normalize_username("Adriana.Flores@Empresa.COM") == "adriana.flores@empresa.com"


def test_invalid_email_is_rejected() -> None:
    with pytest.raises(ValueError):
        normalize_username("adriana@")


def test_existing_user_can_be_changed_to_email_and_login_with_new_identifier(tmp_path: Path) -> None:
    service = AuthService(tmp_path / "auth.sqlite3")
    service.initialize()

    created = service.create_user(
        username="adriana_flores1",
        display_name="Adriana Flores",
        password="ClaveSegura1",
        role="operator",
    )
    assert created["username"] == "adriana_flores1"

    updated = service.update_user(
        int(created["id"]),
        username="Adriana.Flores@Empresa.COM",
    )
    assert updated["username"] == "adriana.flores@empresa.com"

    with pytest.raises(InvalidCredentialsError):
        service.authenticate(username="adriana_flores1", password="ClaveSegura1")

    session = service.authenticate(
        username="adriana.flores@empresa.com",
        password="ClaveSegura1",
    )
    assert session.user["id"] == created["id"]
    assert session.user["username"] == "adriana.flores@empresa.com"


def test_email_and_username_uniqueness_remains_case_insensitive(tmp_path: Path) -> None:
    service = AuthService(tmp_path / "auth.sqlite3")
    service.initialize()

    first = service.create_user(
        username="operador1",
        display_name="Operador Uno",
        password="ClaveSegura1",
        role="operator",
    )
    second = service.create_user(
        username="otro1",
        display_name="Operador Dos",
        password="ClaveSegura2",
        role="operator",
    )
    service.update_user(int(first["id"]), username="Operador@Empresa.com")

    with pytest.raises(DuplicateUserError):
        service.update_user(int(second["id"]), username="OPERADOR@EMPRESA.COM")
