/*
Recommended indexes for Dashboard ARCA water queries.

Manual review script only:
- Do not run automatically from the application.
- Validate names, existing indexes and write volume before applying.
- These indexes support latest-row and date-range reads used by water dashboard endpoints.
*/

-- BOS latest-row and historical range queries
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_SensorsBOS_Pozo_Time_Stamp'
      AND object_id = OBJECT_ID('dbo.SensorsBOS_Pozo')
)
BEGIN
    CREATE INDEX IX_SensorsBOS_Pozo_Time_Stamp
    ON dbo.SensorsBOS_Pozo(Time_Stamp);
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_SensorsBOS_Linea_Time_Stamp'
      AND object_id = OBJECT_ID('dbo.SensorsBOS_Linea')
)
BEGIN
    CREATE INDEX IX_SensorsBOS_Linea_Time_Stamp
    ON dbo.SensorsBOS_Linea(Time_Stamp);
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_SensorsBOS_Tanque_Time_Stamp'
      AND object_id = OBJECT_ID('dbo.SensorsBOS_Tanque')
)
BEGIN
    CREATE INDEX IX_SensorsBOS_Tanque_Time_Stamp
    ON dbo.SensorsBOS_Tanque(Time_Stamp);
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_NIVELES_BOS_Time_Stamp'
      AND object_id = OBJECT_ID('dbo.NIVELES_BOS')
)
BEGIN
    CREATE INDEX IX_NIVELES_BOS_Time_Stamp
    ON dbo.NIVELES_BOS(Time_Stamp);
END;
GO

-- Latest amperage/quality lookup per sensor.
-- The current query orders by COALESCE(ts_local, ts_minute, inserted_at), so this index is a safe recommendation
-- but the optimizer benefit should be validated with the actual execution plan.
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_readings_minute_sensor_ts_quality'
      AND object_id = OBJECT_ID('iot.readings_minute')
)
BEGIN
    CREATE INDEX IX_readings_minute_sensor_ts_quality
    ON iot.readings_minute(sensor_id, ts_local DESC, ts_minute DESC, inserted_at DESC)
    INCLUDE (quality)
    WHERE quality IS NOT NULL;
END;
GO
