/*
Recomendaciones para endurecer iot.sp_get_energy_water.
No reemplaza el SP completo; muestra los cambios clave.
*/

-- 1. Validar periodo al inicio del procedimiento:
IF @period NOT IN ('hourly', 'daily', 'monthly', 'yearly')
BEGIN
    THROW 50001, 'Periodo inválido. Usa hourly, daily, monthly o yearly.', 1;
END;

-- 2. En sensors_parsed, convertir well_id a INT:
-- Sustituir:
-- JSON_VALUE(s.metadata,'$.well_id') AS well_id,
-- Por:
-- TRY_CAST(JSON_VALUE(s.metadata,'$.well_id') AS INT) AS well_id,

-- 3. Índices recomendados si la tabla tiene mucha información JSON:
-- ALTER TABLE iot.sensors
-- ADD metadata_well_id AS TRY_CAST(JSON_VALUE(metadata, '$.well_id') AS INT) PERSISTED;
--
-- ALTER TABLE iot.sensors
-- ADD metadata_role AS JSON_VALUE(metadata, '$.role') PERSISTED;
--
-- CREATE INDEX IX_sensors_active_role_well
-- ON iot.sensors(active, metadata_role, metadata_well_id, sensor_id);
