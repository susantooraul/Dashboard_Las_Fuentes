# Conexión SQL Server — Planta Las Fuentes

Configuración observada para esta planta:

```text
Servidor: POZOSLASFUENTES
Base: ARCA
Autenticación: Windows Authentication
```

Crear `backend/.env` a partir de `backend/.env.example`:

```env
DB_MODE=sqlserver
SQLSERVER_HOST=POZOSLASFUENTES
SQLSERVER_DATABASE=ARCA
SQLSERVER_DRIVER=ODBC Driver 17 for SQL Server
SQLSERVER_USE_WINDOWS_AUTH=true
SQLSERVER_ENCRYPT=no
SQLSERVER_TRUST_CERT=true
```

El backend debe ejecutarse con un usuario de Windows autorizado en SQL Server.

Fuentes hídricas confirmadas:

```text
dbo.SensorsBOS_Pozo
dbo.SensorsBOS_Tanque
iot.readings_minute
```

Comprobación:

```powershell
cd backend
python -m uvicorn app.main:app --reload
```

Abrir:

```text
http://localhost:8000/health/db
http://localhost:8000/docs
```

Si el equipo tiene ODBC Driver 18, cambiar ambos campos `SQLSERVER_DRIVER` y `DB_DRIVER` en el `.env`.
