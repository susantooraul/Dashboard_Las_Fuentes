from sqlalchemy import text
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.auth import router as auth_router
from app.api.routes.dashboard import router as dashboard_router
from app.api.routes.email import router as email_router
from app.api.routes.export import router as export_router
from app.api.routes.plants import router as plants_router
from app.api.routes.water import router as water_router
from app.api.routes.water_export import router as water_export_router
from app.auth.middleware import (
    ApiExceptionBoundaryMiddleware,
    BROWSER_SESSION_HEADER,
    LOCAL_SESSION_HEADER,
    LocalAuthMiddleware,
    USER_ACTIVITY_HEADER,
)
from app.auth.service import AuthPolicy, AuthService
from app.config import get_settings
from app.database import Base, SessionLocal, engine
from app.services.seed_service import seed_if_empty
from app.services.report_email_scheduler_service import report_email_scheduler_engine

settings = get_settings()
app = FastAPI(
    title=settings.app_name,
    debug=settings.debug,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.state.auth_service = AuthService(
    settings.auth_database_file,
    AuthPolicy(
        idle_hours=settings.auth_session_idle_hours,
        absolute_hours=settings.auth_session_absolute_hours,
        max_failed_attempts=settings.auth_max_failed_attempts,
        lock_minutes=settings.auth_lock_minutes,
        require_browser_session=settings.auth_require_browser_session,
    ),
)

# Orden deliberado: el ultimo middleware agregado es la capa exterior.
# CORS debe envolver auth y el boundary para que 200/401/403/422/500 y OPTIONS
# conserven Access-Control-Allow-Origin cuando el origen esta autorizado.
app.add_middleware(
    LocalAuthMiddleware,
    api_prefix=settings.api_v1_prefix,
    cookie_name=settings.auth_cookie_name,
    browser_cookie_name=settings.auth_browser_cookie_name,
    csrf_header=settings.auth_csrf_header,
)
app.add_middleware(ApiExceptionBoundaryMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allow_headers=[
        'Accept',
        'Content-Type',
        'X-Requested-With',
        settings.auth_csrf_header,
        BROWSER_SESSION_HEADER,
        LOCAL_SESSION_HEADER,
        USER_ACTIVITY_HEADER,
    ],
    expose_headers=['Content-Disposition'],
)

app.include_router(auth_router, prefix=settings.api_v1_prefix)
app.include_router(dashboard_router, prefix=settings.api_v1_prefix)
app.include_router(export_router, prefix=settings.api_v1_prefix)
app.include_router(email_router, prefix=settings.api_v1_prefix)
app.include_router(plants_router, prefix=settings.api_v1_prefix)
app.include_router(water_router, prefix=settings.api_v1_prefix)
app.include_router(water_export_router, prefix=settings.api_v1_prefix)


@app.on_event('startup')
def on_startup():
    app.state.auth_service.initialize()
    report_email_scheduler_engine.start()
    if settings.db_mode.lower() == 'demo':
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        try:
            seed_if_empty(db)
        finally:
            db.close()


@app.on_event('shutdown')
def on_shutdown():
    report_email_scheduler_engine.stop()


@app.get('/')
def root():
    return {
        'message': 'ARCA CONTINENTAL Water API running',
        'db_mode': settings.db_mode,
        'sqlserver_source_mode': settings.sqlserver_source_mode,
    }


@app.get('/health/db')
def db_health():
    with engine.connect() as conn:
        conn.execute(text('SELECT 1'))
    return {'ok': True}
