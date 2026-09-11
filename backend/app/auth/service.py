from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from app.auth.database import AuthDatabase
from app.auth.security import (
    constant_time_raw_match,
    constant_time_token_match,
    hash_password,
    hash_token,
    normalize_username,
    password_needs_rehash,
    random_token,
    verify_password,
)

logger = logging.getLogger(__name__)
ROLES = {"admin", "operator", "viewer"}


class AuthError(Exception):
    pass


class InvalidCredentialsError(AuthError):
    pass


class AccountLockedError(AuthError):
    pass


class InactiveUserError(AuthError):
    pass


class DuplicateUserError(AuthError):
    pass


class LastAdministratorError(AuthError):
    pass


class UserNotFoundError(AuthError):
    pass


@dataclass(frozen=True)
class AuthPolicy:
    idle_hours: int = 8
    absolute_hours: int = 12
    max_failed_attempts: int = 5
    lock_minutes: int = 15
    require_browser_session: bool = True


@dataclass(frozen=True)
class SessionResult:
    token: str
    browser_session: str
    csrf_token: str
    user: dict[str, Any]
    expires_at: str


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


class AuthService:
    def __init__(self, database_path: Path | str, policy: AuthPolicy | None = None):
        self.database = AuthDatabase(database_path)
        self.policy = policy or AuthPolicy()

    def initialize(self) -> None:
        self.database.initialize()
        self.cleanup_sessions()

    def cleanup_sessions(self, retain_days: int = 7) -> int:
        cutoff = iso(utc_now() - timedelta(days=max(1, retain_days)))
        with self.database.connect() as connection:
            cursor = connection.execute(
                """
                DELETE FROM sessions
                WHERE (revoked_at IS NOT NULL AND revoked_at < ?)
                   OR (expires_at < ?)
                """,
                (cutoff, cutoff),
            )
        return int(cursor.rowcount or 0)

    def has_admin(self) -> bool:
        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT 1 FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1"
            ).fetchone()
        return bool(row)

    @staticmethod
    def _serialize_user(row: Any) -> dict[str, Any]:
        locked_until = parse_datetime(row["locked_until"])
        locked = bool(locked_until and locked_until > utc_now())
        return {
            "id": int(row["id"]),
            "username": str(row["username"]),
            "display_name": str(row["display_name"]),
            "name": str(row["display_name"]),
            "role": str(row["role"]),
            "is_active": bool(row["is_active"]),
            "is_locked": locked,
            "locked_until": iso(locked_until),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "last_login_at": row["last_login_at"],
        }

    def _audit(
        self,
        connection,
        *,
        action: str,
        actor_user_id: int | None = None,
        target_user_id: int | None = None,
        ip_address: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        connection.execute(
            """
            INSERT INTO auth_audit (actor_user_id, target_user_id, action, created_at, ip_address, details)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                actor_user_id,
                target_user_id,
                action,
                iso(utc_now()),
                ip_address,
                json.dumps(details or {}, ensure_ascii=False, sort_keys=True),
            ),
        )

    def create_user(
        self,
        *,
        username: str,
        display_name: str,
        password: str,
        role: str,
        is_active: bool = True,
        actor_user_id: int | None = None,
        ip_address: str | None = None,
    ) -> dict[str, Any]:
        username_value = normalize_username(username)
        display_value = display_name.strip()
        if not display_value:
            raise ValueError("El nombre visible es obligatorio.")
        if role not in ROLES:
            raise ValueError("Rol no válido.")
        password_hash = hash_password(password)
        now = iso(utc_now())
        try:
            with self.database.connect() as connection:
                connection.execute("BEGIN IMMEDIATE")
                cursor = connection.execute(
                    """
                    INSERT INTO users (
                        username, display_name, password_hash, role, is_active,
                        failed_login_attempts, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
                    """,
                    (username_value, display_value, password_hash, role, int(is_active), now, now),
                )
                user_id = int(cursor.lastrowid)
                self._audit(
                    connection,
                    action="user_created",
                    actor_user_id=actor_user_id,
                    target_user_id=user_id,
                    ip_address=ip_address,
                    details={"role": role, "is_active": bool(is_active)},
                )
                connection.commit()
                row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        except Exception as exc:
            if "UNIQUE constraint failed" in str(exc):
                raise DuplicateUserError("El nombre de usuario ya existe.") from exc
            raise
        return self._serialize_user(row)

    def list_users(self) -> list[dict[str, Any]]:
        with self.database.connect() as connection:
            rows = connection.execute("SELECT * FROM users ORDER BY username COLLATE NOCASE").fetchall()
        return [self._serialize_user(row) for row in rows]

    @staticmethod
    def _active_admin_count(connection) -> int:
        row = connection.execute(
            "SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND is_active = 1"
        ).fetchone()
        return int(row["total"])

    def update_user(
        self,
        user_id: int,
        *,
        display_name: str | None = None,
        role: str | None = None,
        is_active: bool | None = None,
        actor_user_id: int | None = None,
        ip_address: str | None = None,
    ) -> dict[str, Any]:
        if role is not None and role not in ROLES:
            raise ValueError("Rol no válido.")
        with self.database.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            current = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not current:
                connection.rollback()
                raise UserNotFoundError("Usuario no encontrado.")

            next_role = role if role is not None else current["role"]
            next_active = int(is_active) if is_active is not None else int(current["is_active"])
            if current["role"] == "admin" and current["is_active"] and (next_role != "admin" or not next_active):
                if self._active_admin_count(connection) <= 1:
                    connection.rollback()
                    raise LastAdministratorError("Debe permanecer al menos un administrador activo.")

            fields: list[str] = []
            values: list[Any] = []
            audit_changes: dict[str, Any] = {}
            if display_name is not None:
                clean_name = display_name.strip()
                if not clean_name:
                    connection.rollback()
                    raise ValueError("El nombre visible es obligatorio.")
                fields.append("display_name = ?")
                values.append(clean_name)
                audit_changes["display_name_changed"] = clean_name != current["display_name"]
            if role is not None:
                fields.append("role = ?")
                values.append(role)
                audit_changes["role"] = role
            if is_active is not None:
                fields.append("is_active = ?")
                values.append(int(is_active))
                audit_changes["is_active"] = bool(is_active)
            fields.append("updated_at = ?")
            values.append(iso(utc_now()))
            values.append(user_id)
            connection.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = ?", values)
            if is_active is False:
                self._revoke_sessions(connection, user_id)
            self._audit(
                connection,
                action="user_updated",
                actor_user_id=actor_user_id,
                target_user_id=user_id,
                ip_address=ip_address,
                details=audit_changes,
            )
            connection.commit()
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return self._serialize_user(row)

    def reset_password(
        self,
        user_id: int,
        password: str,
        *,
        actor_user_id: int | None = None,
        ip_address: str | None = None,
    ) -> None:
        password_hash = hash_password(password)
        with self.database.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
            if not row:
                connection.rollback()
                raise UserNotFoundError("Usuario no encontrado.")
            connection.execute(
                """
                UPDATE users
                SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL, updated_at = ?
                WHERE id = ?
                """,
                (password_hash, iso(utc_now()), user_id),
            )
            self._revoke_sessions(connection, user_id)
            self._audit(
                connection,
                action="password_reset",
                actor_user_id=actor_user_id,
                target_user_id=user_id,
                ip_address=ip_address,
            )
            connection.commit()

    @staticmethod
    def _revoke_sessions(connection, user_id: int) -> None:
        connection.execute(
            "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
            (iso(utc_now()), user_id),
        )

    def revoke_user_sessions(
        self,
        user_id: int,
        *,
        actor_user_id: int | None = None,
        ip_address: str | None = None,
    ) -> None:
        with self.database.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
            if not row:
                connection.rollback()
                raise UserNotFoundError("Usuario no encontrado.")
            self._revoke_sessions(connection, user_id)
            self._audit(
                connection,
                action="sessions_revoked",
                actor_user_id=actor_user_id,
                target_user_id=user_id,
                ip_address=ip_address,
            )
            connection.commit()

    def authenticate(
        self,
        *,
        username: str,
        password: str,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> SessionResult:
        attempted = username.strip().lower()
        now = utc_now()
        with self.database.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM users WHERE username = ? COLLATE NOCASE",
                (attempted,),
            ).fetchone()
            password_valid = verify_password(row["password_hash"] if row else None, password)

            if not row:
                connection.commit()
                logger.warning("auth_login username=%s result=invalid ip=%s", attempted or "<empty>", ip_address or "unknown")
                raise InvalidCredentialsError("Usuario o contraseña incorrectos.")

            locked_until = parse_datetime(row["locked_until"])
            if locked_until and locked_until > now:
                connection.commit()
                logger.warning("auth_login username=%s result=locked ip=%s", attempted, ip_address or "unknown")
                raise AccountLockedError("Usuario o contraseña incorrectos.")
            if not row["is_active"]:
                connection.commit()
                logger.warning("auth_login username=%s result=inactive ip=%s", attempted, ip_address or "unknown")
                raise InactiveUserError("Usuario o contraseña incorrectos.")

            if not password_valid:
                attempts = int(row["failed_login_attempts"] or 0) + 1
                lock_until = now + timedelta(minutes=self.policy.lock_minutes) if attempts >= self.policy.max_failed_attempts else None
                connection.execute(
                    "UPDATE users SET failed_login_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?",
                    (0 if lock_until else attempts, iso(lock_until), iso(now), row["id"]),
                )
                connection.commit()
                logger.warning("auth_login username=%s result=invalid ip=%s", attempted, ip_address or "unknown")
                raise InvalidCredentialsError("Usuario o contraseña incorrectos.")

            if password_needs_rehash(row["password_hash"]):
                connection.execute(
                    "UPDATE users SET password_hash = ? WHERE id = ?",
                    (hash_password(password), row["id"]),
                )

            token = random_token(48)
            browser_session = random_token(32)
            csrf_secret_hash = hash_token(random_token(32))
            absolute_expiry = now + timedelta(hours=self.policy.absolute_hours)
            created_at = iso(now) or ""
            cursor = connection.execute(
                """
                INSERT INTO sessions (
                    user_id, token_hash, csrf_token_hash, browser_session_hash, created_at,
                    last_activity_at, expires_at, ip_address, user_agent
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row["id"],
                    hash_token(token),
                    csrf_secret_hash,
                    hash_token(browser_session),
                    created_at,
                    created_at,
                    iso(absolute_expiry),
                    ip_address,
                    (user_agent or "")[:500],
                ),
            )
            session_id = int(cursor.lastrowid)
            csrf_token = self._stable_csrf_token(session_id, created_at, csrf_secret_hash)
            connection.execute(
                """
                UPDATE users
                SET failed_login_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (iso(now), iso(now), row["id"]),
            )
            self._audit(
                connection,
                action="login_success",
                actor_user_id=int(row["id"]),
                target_user_id=int(row["id"]),
                ip_address=ip_address,
            )
            connection.commit()
            updated = connection.execute("SELECT * FROM users WHERE id = ?", (row["id"],)).fetchone()

        logger.info("auth_login username=%s result=success ip=%s", attempted, ip_address or "unknown")
        return SessionResult(
            token=token,
            browser_session=browser_session,
            csrf_token=csrf_token,
            user=self._serialize_user(updated),
            expires_at=iso(absolute_expiry) or "",
        )

    def get_session(
        self,
        token: str | None,
        browser_session: str | None = None,
        *,
        require_browser_session: bool | None = None,
    ) -> dict[str, Any] | None:
        if not token:
            return None
        token_hash = hash_token(token)
        now = utc_now()
        with self.database.connect() as connection:
            row = connection.execute(
                """
                SELECT s.*, u.username, u.display_name, u.role, u.is_active,
                       u.created_at AS user_created_at, u.updated_at AS user_updated_at,
                       u.last_login_at, u.locked_until, u.failed_login_attempts
                FROM sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.token_hash = ?
                LIMIT 1
                """,
                (token_hash,),
            ).fetchone()
            if not row or row["revoked_at"] or not row["is_active"]:
                return None
            if not constant_time_token_match(token, str(row["token_hash"])):
                return None
            effective_require_browser_session = (
                self.policy.require_browser_session
                if require_browser_session is None
                else bool(require_browser_session)
            )
            if effective_require_browser_session:
                stored_browser_hash = row["browser_session_hash"]
                if not browser_session or not stored_browser_hash:
                    return None
                if not constant_time_token_match(browser_session, str(stored_browser_hash)):
                    return None

            expires_at = parse_datetime(row["expires_at"])
            created_at = parse_datetime(row["created_at"])
            last_activity = parse_datetime(row["last_activity_at"])
            policy_expiry = created_at + timedelta(hours=self.policy.absolute_hours) if created_at else now
            idle_expiry = last_activity + timedelta(hours=self.policy.idle_hours) if last_activity else now
            if not expires_at or expires_at <= now or policy_expiry <= now or idle_expiry <= now:
                connection.execute(
                    "UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
                    (iso(now), row["id"]),
                )
                return None

            user = {
                "id": int(row["user_id"]),
                "username": row["username"],
                "display_name": row["display_name"],
                "name": row["display_name"],
                "role": row["role"],
                "is_active": bool(row["is_active"]),
                "last_login_at": row["last_login_at"],
            }
            return {
                "id": int(row["id"]),
                "user": user,
                "csrf_token_hash": row["csrf_token_hash"],
                "created_at": row["created_at"],
                "last_activity_at": row["last_activity_at"],
                "expires_at": row["expires_at"],
            }

    def touch_session(self, session_id: int) -> None:
        now = utc_now()
        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT last_activity_at FROM sessions WHERE id = ? AND revoked_at IS NULL",
                (session_id,),
            ).fetchone()
            if not row:
                return
            last_activity = parse_datetime(row["last_activity_at"])
            if not last_activity or (now - last_activity).total_seconds() >= 60:
                connection.execute(
                    "UPDATE sessions SET last_activity_at = ? WHERE id = ? AND revoked_at IS NULL",
                    (iso(now), session_id),
                )

    @staticmethod
    def _stable_csrf_token(session_id: int, created_at: str | None, csrf_seed_hash: str | None) -> str:
        seed = f"{session_id}:{created_at or ''}:{csrf_seed_hash or ''}"
        return hash_token(seed)

    def csrf_token_for_session(self, session: dict[str, Any]) -> str:
        return self._stable_csrf_token(
            int(session["id"]),
            session.get("created_at"),
            str(session.get("csrf_token_hash") or ""),
        )

    def validate_csrf(self, session: dict[str, Any], csrf_token: str | None) -> bool:
        if not csrf_token:
            return False
        return constant_time_raw_match(csrf_token, self.csrf_token_for_session(session))

    def revoke_session(self, session_id: int) -> None:
        with self.database.connect() as connection:
            connection.execute(
                "UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
                (iso(utc_now()), session_id),
            )
