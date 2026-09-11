import logging

import pyodbc
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import get_settings

settings = get_settings()
database_url = settings.resolved_database_url
connect_args = {'check_same_thread': False} if database_url.startswith('sqlite') else {}
engine = create_engine(database_url, future=True, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)
Base = declarative_base()


logger = logging.getLogger(__name__)


class DatabaseUnavailableError(RuntimeError):
    """Raised when the operational SQL Server cannot be reached quickly."""


def _sqlserver_odbc_connection_string(timeout_seconds: int) -> str:
    trust = "yes" if settings.sqlserver_trust_cert else "no"
    encrypt = str(settings.sqlserver_encrypt).lower()
    if encrypt in {"false", "0", "off"}:
        encrypt = "no"
    if encrypt in {"true", "1", "on"}:
        encrypt = "yes"

    server_part = settings.sqlserver_host
    if "\\" not in settings.sqlserver_host and settings.sqlserver_port:
        server_part = f"{settings.sqlserver_host},{settings.sqlserver_port}"

    parts = [
        f"DRIVER={{{settings.sqlserver_driver}}}",
        f"SERVER={server_part}",
        f"DATABASE={settings.sqlserver_database}",
        f"TrustServerCertificate={trust}",
        f"Encrypt={encrypt}",
        f"Connection Timeout={max(int(timeout_seconds), 1)}",
    ]
    if settings.sqlserver_use_windows_auth:
        parts.append("Trusted_Connection=yes")
    else:
        parts.extend([
            f"UID={settings.sqlserver_username}",
            f"PWD={settings.sqlserver_password}",
        ])
    return ";".join(parts)


def ensure_database_available(timeout_seconds: int = 3) -> None:
    """Fail fast when a report cannot reach its operational data source."""
    if settings.db_mode.lower() != "sqlserver":
        try:
            with engine.connect() as connection:
                connection.exec_driver_sql("SELECT 1")
            return
        except Exception as exc:
            logger.warning("Report data-source availability check failed.")
            raise DatabaseUnavailableError(
                "No fue posible generar el reporte porque la fuente de datos no está disponible."
            ) from exc

    try:
        connection_string = _sqlserver_odbc_connection_string(timeout_seconds)
        with pyodbc.connect(connection_string, timeout=max(int(timeout_seconds), 1)) as connection:
            cursor = connection.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except (pyodbc.Error, OSError) as exc:
        logger.warning("Report data-source availability check failed.")
        raise DatabaseUnavailableError(
            "No fue posible generar el reporte porque la fuente de datos no está disponible."
        ) from exc


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
