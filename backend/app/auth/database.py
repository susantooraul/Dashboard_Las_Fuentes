from __future__ import annotations

import logging
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

logger = logging.getLogger(__name__)

_SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'viewer')),
    is_active INTEGER NOT NULL DEFAULT 1,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    csrf_token_hash TEXT NOT NULL,
    browser_session_hash TEXT NULL,
    created_at TEXT NOT NULL,
    last_activity_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT NULL,
    ip_address TEXT NULL,
    user_agent TEXT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS auth_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER NULL,
    target_user_id INTEGER NULL,
    action TEXT NOT NULL,
    created_at TEXT NOT NULL,
    ip_address TEXT NULL,
    details TEXT NULL,
    FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY(target_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at, revoked_at);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON auth_audit(created_at);
"""


class AuthDatabase:
    """SQLite local de autenticacion. Nunca usa SQL Server/BOS."""

    def __init__(self, path: Path | str):
        self.path = Path(path).expanduser().resolve()

    def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute("PRAGMA synchronous = NORMAL")
            connection.executescript(_SCHEMA)
            self._migrate_sessions(connection)
            connection.execute("PRAGMA user_version = 2")
            connection.commit()
        self._tighten_file_permissions()

    @staticmethod
    def _migrate_sessions(connection: sqlite3.Connection) -> None:
        columns = {
            str(row["name"])
            for row in connection.execute("PRAGMA table_info(sessions)").fetchall()
        }
        if "browser_session_hash" not in columns:
            connection.execute("ALTER TABLE sessions ADD COLUMN browser_session_hash TEXT NULL")
            if "tab_session_hash" in columns:
                connection.execute(
                    "UPDATE sessions SET browser_session_hash = tab_session_hash "
                    "WHERE browser_session_hash IS NULL AND tab_session_hash IS NOT NULL"
                )

    def _tighten_file_permissions(self) -> None:
        # En Windows los ACL se administran fuera de Python. En POSIX evitamos
        # que la base quede legible globalmente por accidente.
        if os.name == "posix" and self.path.exists():
            try:
                self.path.chmod(0o600)
            except OSError:
                pass

    @staticmethod
    def _ensure_schema(connection: sqlite3.Connection) -> None:
        required_tables = {"users", "sessions", "auth_audit"}
        existing_tables = {
            str(row["name"])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        if required_tables.issubset(existing_tables):
            return

        missing = sorted(required_tables - existing_tables)
        logger.warning(
            "auth sqlite schema missing; recreating tables missing=%s",
            ",".join(missing) or "unknown",
        )
        connection.executescript(_SCHEMA)
        AuthDatabase._migrate_sessions(connection)
        connection.execute("PRAGMA user_version = 2")
        connection.commit()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        self._ensure_schema(connection)
        try:
            yield connection
        finally:
            connection.close()
