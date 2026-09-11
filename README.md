# Dashboard ARCA — Planta Las Fuentes

Proyecto completo de monitoreo hídrico para Planta Las Fuentes.

## Alcance confirmado

- Dashboard general.
- 5 pozos.
- 10 medidores del área TAM.
- 4 medidores de embotellado.
- 1 medidor de salida de cisterna.
- Flujo instantáneo y totalizador.
- Histórico individual con agrupaciones 1 min, 15 min, 1 h y 1 día.
- Exportación histórica Excel/PDF heredada de la arquitectura homologada.
- Autenticación local por roles: administrador, operador y consulta.
- Tema claro/oscuro y navegación adaptable.

Los módulos Líneas, Niveles, Lámparas UV, Diagrama hídrico, Revisión diaria, Reportes y turnos permanecen deshabilitados hasta recibir reglas y fuentes confirmadas de Planta.

## Fuentes de datos

| Grupo | Snapshot | Histórico |
|---|---|---|
| Pozos | `dbo.SensorsBOS_Pozo` | `iot.readings_minute` |
| TAM | `dbo.SensorsBOS_Tanque` | `iot.readings_minute` |
| Embotellado | `dbo.SensorsBOS_Tanque` | `iot.readings_minute` |
| Cisterna | `dbo.SensorsBOS_Tanque` | `iot.readings_minute` |

Zona horaria operativa: `America/Mexico_City`. Los 20 sensores confirmados se normalizan desde UTC.

La correspondencia completa se encuentra en `DOCUMENTACION_LAS_FUENTES.md`. El script `LAS_FUENTES_CORRECCION_SENSORES_TANQUE.sql` documenta y reproduce la carga de los sensores 3022, 3028, 3030, 3032, 3034 y 3036.

## Tecnología

- Frontend: React 18, Vite, TypeScript gradual, Recharts y Axios.
- Backend: FastAPI, SQLAlchemy, PyODBC, Pandas, OpenPyXL y ReportLab.
- Base: SQL Server `ARCA` en `POZOSLASFUENTES` mediante autenticación de Windows.
- Autenticación de usuarios: SQLite local, independiente de SQL Server.

## Inicio rápido en Windows

1. Crear `backend/.env` a partir de `backend/.env.example` y configurar SMTP/orígenes si aplican.
2. Desde `backend`, crear el entorno e instalar dependencias:

```powershell
python -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
```

3. Crear el primer administrador:

```powershell
python -m app.scripts.create_admin
```

4. Desde `frontend`, instalar dependencias:

```powershell
npm install
```

5. Ejecutar `Iniciar Dashboard ARCA.bat` o iniciar backend y frontend por separado.

## Configuración sensible

- El paquete no contiene archivos `.env`, bases SQLite, credenciales ni dependencias instaladas.
- No colocar contraseñas reales en `.env.example`.
- Si la contraseña SMTP que estaba en el proyecto de referencia continúa vigente, debe rotarse.

## Compatibilidad interna

Algunos archivos y funciones conservan el prefijo técnico `insurgentes_*` para mantener compatibilidad con la arquitectura base. La identidad, configuración, sensores, rutas visibles y archivos exportados corresponden a Las Fuentes.
