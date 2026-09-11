/*
    PLANTA LAS FUENTES
    Correccion de dbo.SensorsTanque_Upsert_ReadingsMinute

    Objetivo:
      - Incorporar TANQUE_FLOW_IN[12] a [17] en iot.readings_minute.
      - Conservar todos los sensor_id existentes.
      - Asignar sensor_id 3036 a TANQUE_FLOW_IN[17] (Salida de cisterna).
      - Conservar TANQUE_FLOW_IN[7] / sensor_id 3016 en el trigger para no
        alterar la captura existente, aunque quede fuera del dashboard.
      - Permitir una recuperacion historica controlada de los seis puntos.

    Correspondencia agregada:
      3022 = ENTRADA TAM             (TANQUE_FLOW_IN[12])
      3028 = ENTRADA PC 1            (TANQUE_FLOW_IN[13])
      3030 = ENTRADA PC 2            (TANQUE_FLOW_IN[14])
      3032 = ENTRADA PC 3            (TANQUE_FLOW_IN[15])
      3034 = CIP                     (TANQUE_FLOW_IN[16])
      3036 = SALIDA DE CISTERNA      (TANQUE_FLOW_IN[17])

    IMPORTANTE:
      1. Ejecutar primero la seccion A.
      2. Esperar al menos un minuto y ejecutar la seccion B.
      3. Solo despues de comprobar lecturas nuevas, ejecutar la seccion C.
*/

USE [ARCA];
GO

/* ========================================================================
   A) ACTUALIZAR EL TRIGGER (lecturas nuevas)
   ======================================================================== */

ALTER TRIGGER [dbo].[SensorsTanque_Upsert_ReadingsMinute]
ON [dbo].[SensorsBOS_Tanque]
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF OBJECT_ID('tempdb..#src_raw') IS NOT NULL DROP TABLE #src_raw;

    SELECT
        v.sensor_id,
        CAST(i.Time_Stamp AS DATETIME2(3))                    AS ts_local,
        DATEADD(minute, DATEDIFF(minute, 0, i.Time_Stamp), 0) AS ts_minute,
        CAST(v.instant_value AS DECIMAL(20,6))                AS instant_value,
        CAST(v.total_value   AS DECIMAL(20,6))                AS total_value,
        CAST(v.quality       AS SMALLINT)                     AS quality,
        CAST(v.source        AS VARCHAR(50))                  AS source
    INTO #src_raw
    FROM inserted AS i
    CROSS APPLY (VALUES
        -- Medidores existentes
        (i.TANQUE_FLOW_IN_0_sensor_id, i.TANQUE_FLOW_IN_0_instant_value, i.TANQUE_FLOW_IN_0_total_value, i.TANQUE_FLOW_IN_0_quality, i.TANQUE_FLOW_IN_0_source),
        (i.TANQUE_FLOW_IN_1_sensor_id, i.TANQUE_FLOW_IN_1_instant_value, i.TANQUE_FLOW_IN_1_total_value, i.TANQUE_FLOW_IN_1_quality, i.TANQUE_FLOW_IN_1_source),
        (i.TANQUE_FLOW_IN_2_sensor_id, i.TANQUE_FLOW_IN_2_instant_value, i.TANQUE_FLOW_IN_2_total_value, i.TANQUE_FLOW_IN_2_quality, i.TANQUE_FLOW_IN_2_source),
        (i.TANQUE_FLOW_IN_3_sensor_id, i.TANQUE_FLOW_IN_3_instant_value, i.TANQUE_FLOW_IN_3_total_value, i.TANQUE_FLOW_IN_3_quality, i.TANQUE_FLOW_IN_3_source),
        (i.TANQUE_FLOW_IN_4_sensor_id, i.TANQUE_FLOW_IN_4_instant_value, i.TANQUE_FLOW_IN_4_total_value, i.TANQUE_FLOW_IN_4_quality, i.TANQUE_FLOW_IN_4_source),
        (i.TANQUE_FLOW_IN_5_sensor_id, i.TANQUE_FLOW_IN_5_instant_value, i.TANQUE_FLOW_IN_5_total_value, i.TANQUE_FLOW_IN_5_quality, i.TANQUE_FLOW_IN_5_source),
        (i.TANQUE_FLOW_IN_6_sensor_id, i.TANQUE_FLOW_IN_6_instant_value, i.TANQUE_FLOW_IN_6_total_value, i.TANQUE_FLOW_IN_6_quality, i.TANQUE_FLOW_IN_6_source),
        -- Se conserva TANQUE_FLOW_IN[7] / 3016 sin mostrarlo en el dashboard.
        (i.TANQUE_FLOW_IN_7_sensor_id, i.TANQUE_FLOW_IN_7_instant_value, i.TANQUE_FLOW_IN_7_total_value, i.TANQUE_FLOW_IN_7_quality, i.TANQUE_FLOW_IN_7_source),
        (i.TANQUE_FLOW_IN_8_sensor_id, i.TANQUE_FLOW_IN_8_instant_value, i.TANQUE_FLOW_IN_8_total_value, i.TANQUE_FLOW_IN_8_quality, i.TANQUE_FLOW_IN_8_source),
        (i.TANQUE_FLOW_IN_9_sensor_id, i.TANQUE_FLOW_IN_9_instant_value, i.TANQUE_FLOW_IN_9_total_value, i.TANQUE_FLOW_IN_9_quality, i.TANQUE_FLOW_IN_9_source),

        -- Los nuevos campos BOS no incluyen quality/source. Se usa quality=0,
        -- requerido por iot.readings_minute, y BOS como origen de la lectura.
        (i.TANQUE_FLOW_IN_12_sensor_id, i.TANQUE_FLOW_IN_12_instant_value, i.TANQUE_FLOW_IN_12_total_value, CAST(0 AS INT), CAST('BOS' AS VARCHAR(50))),
        (i.TANQUE_FLOW_IN_13_sensor_id, i.TANQUE_FLOW_IN_13_instant_value, i.TANQUE_FLOW_IN_13_total_value, CAST(0 AS INT), CAST('BOS' AS VARCHAR(50))),
        (i.TANQUE_FLOW_IN_14_sensor_id, i.TANQUE_FLOW_IN_14_instant_value, i.TANQUE_FLOW_IN_14_total_value, CAST(0 AS INT), CAST('BOS' AS VARCHAR(50))),
        (i.TANQUE_FLOW_IN_15_sensor_id, i.TANQUE_FLOW_IN_15_instant_value, i.TANQUE_FLOW_IN_15_total_value, CAST(0 AS INT), CAST('BOS' AS VARCHAR(50))),
        (i.TANQUE_FLOW_IN_16_sensor_id, i.TANQUE_FLOW_IN_16_instant_value, i.TANQUE_FLOW_IN_16_total_value, CAST(0 AS INT), CAST('BOS' AS VARCHAR(50))),

        -- La tabla BOS no tiene TANQUE_FLOW_IN_17_sensor_id; el ID confirmado
        -- para Salida de cisterna se asigna aqui sin cambiar el esquema BOS.
        (CAST(3036 AS INT), i.TANQUE_FLOW_IN_17_instant_value, i.TANQUE_FLOW_IN_17_total_value, CAST(0 AS INT), CAST('BOS' AS VARCHAR(50)))
    ) AS v (sensor_id, instant_value, total_value, quality, source)
    WHERE (v.instant_value IS NOT NULL OR v.total_value IS NOT NULL)
      AND v.sensor_id IS NOT NULL
      AND v.sensor_id <> 0
      AND i.Time_Stamp IS NOT NULL;

    IF OBJECT_ID('tempdb..#src') IS NOT NULL DROP TABLE #src;

    ;WITH d AS
    (
        SELECT
            r.*,
            ROW_NUMBER() OVER (
                PARTITION BY r.sensor_id, r.ts_minute
                ORDER BY r.ts_local DESC
            ) AS rn
        FROM #src_raw AS r
    )
    SELECT
        sensor_id,
        ts_local,
        ts_minute,
        instant_value,
        total_value,
        quality,
        source
    INTO #src
    FROM d
    WHERE rn = 1;

    UPDATE tgt
       SET tgt.ts_local      = s.ts_local,
           tgt.instant_value = s.instant_value,
           tgt.total_value   = s.total_value,
           tgt.quality       = COALESCE(s.quality, tgt.quality),
           tgt.source        = COALESCE(s.source, tgt.source),
           tgt.inserted_at   = SYSDATETIME()
      FROM [ARCA].[iot].[readings_minute] AS tgt WITH (HOLDLOCK)
      JOIN #src AS s
        ON tgt.sensor_id = s.sensor_id
       AND tgt.ts_minute = s.ts_minute;

    INSERT INTO [ARCA].[iot].[readings_minute]
           (sensor_id, ts_local, ts_minute, instant_value, total_value, quality, source)
    SELECT
        s.sensor_id,
        s.ts_local,
        s.ts_minute,
        s.instant_value,
        s.total_value,
        s.quality,
        s.source
    FROM #src AS s
    WHERE NOT EXISTS (
        SELECT 1
        FROM [ARCA].[iot].[readings_minute] AS t WITH (UPDLOCK, HOLDLOCK)
        WHERE t.sensor_id = s.sensor_id
          AND t.ts_minute = s.ts_minute
    );

    DROP TABLE #src;
    DROP TABLE #src_raw;
END;
GO

/* ========================================================================
   B) VALIDAR LECTURAS NUEVAS
   Ejecutar despues de esperar al menos un ciclo de escritura de BOS.
   Deben aparecer los seis sensor_id.
   ======================================================================== */

;WITH Ultima AS
(
    SELECT
        sensor_id,
        ts_local,
        ts_minute,
        instant_value,
        total_value,
        quality,
        source,
        ROW_NUMBER() OVER (
            PARTITION BY sensor_id
            ORDER BY ts_minute DESC, ts_local DESC
        ) AS rn
    FROM [ARCA].[iot].[readings_minute]
    WHERE sensor_id IN (3022, 3028, 3030, 3032, 3034, 3036)
)
SELECT
    sensor_id,
    ts_local,
    ts_minute,
    instant_value,
    total_value,
    quality,
    source
FROM Ultima
WHERE rn = 1
ORDER BY sensor_id;
GO

/* ========================================================================
   C) RECUPERACION HISTORICA CONTROLADA

   Esta seccion inicia desactivada. Cambiar @EjecutarHistorico a 1 solamente
   despues de validar que la seccion B muestra lecturas nuevas correctas.

   @Desde = NULL recupera toda la historia disponible en SensorsBOS_Tanque.
   Para una prueba acotada puede usarse, por ejemplo: '2026-09-01'.
   ======================================================================== */

DECLARE @EjecutarHistorico BIT = 0;
DECLARE @Desde DATETIME2(0) = NULL;

IF @EjecutarHistorico = 1
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF OBJECT_ID('tempdb..#historico_raw') IS NOT NULL DROP TABLE #historico_raw;
    IF OBJECT_ID('tempdb..#historico') IS NOT NULL DROP TABLE #historico;

    SELECT
        v.sensor_id,
        CAST(i.Time_Stamp AS DATETIME2(3))                    AS ts_local,
        DATEADD(minute, DATEDIFF(minute, 0, i.Time_Stamp), 0) AS ts_minute,
        CAST(v.instant_value AS DECIMAL(20,6))                AS instant_value,
        CAST(v.total_value   AS DECIMAL(20,6))                AS total_value,
        CAST(0 AS SMALLINT)                                   AS quality,
        CAST('BOS' AS VARCHAR(50))                            AS source
    INTO #historico_raw
    FROM [dbo].[SensorsBOS_Tanque] AS i
    CROSS APPLY (VALUES
        (i.TANQUE_FLOW_IN_12_sensor_id, i.TANQUE_FLOW_IN_12_instant_value, i.TANQUE_FLOW_IN_12_total_value),
        (i.TANQUE_FLOW_IN_13_sensor_id, i.TANQUE_FLOW_IN_13_instant_value, i.TANQUE_FLOW_IN_13_total_value),
        (i.TANQUE_FLOW_IN_14_sensor_id, i.TANQUE_FLOW_IN_14_instant_value, i.TANQUE_FLOW_IN_14_total_value),
        (i.TANQUE_FLOW_IN_15_sensor_id, i.TANQUE_FLOW_IN_15_instant_value, i.TANQUE_FLOW_IN_15_total_value),
        (i.TANQUE_FLOW_IN_16_sensor_id, i.TANQUE_FLOW_IN_16_instant_value, i.TANQUE_FLOW_IN_16_total_value),
        (CAST(3036 AS INT), i.TANQUE_FLOW_IN_17_instant_value, i.TANQUE_FLOW_IN_17_total_value)
    ) AS v (sensor_id, instant_value, total_value)
    WHERE (v.instant_value IS NOT NULL OR v.total_value IS NOT NULL)
      AND v.sensor_id IS NOT NULL
      AND v.sensor_id <> 0
      AND i.Time_Stamp IS NOT NULL
      AND (@Desde IS NULL OR i.Time_Stamp >= @Desde);

    ;WITH d AS
    (
        SELECT
            r.*,
            ROW_NUMBER() OVER (
                PARTITION BY r.sensor_id, r.ts_minute
                ORDER BY r.ts_local DESC
            ) AS rn
        FROM #historico_raw AS r
    )
    SELECT
        sensor_id,
        ts_local,
        ts_minute,
        instant_value,
        total_value,
        quality,
        source
    INTO #historico
    FROM d
    WHERE rn = 1;

    BEGIN TRANSACTION;

    UPDATE tgt
       SET tgt.ts_local      = s.ts_local,
           tgt.instant_value = s.instant_value,
           tgt.total_value   = s.total_value,
           tgt.quality       = COALESCE(s.quality, tgt.quality),
           tgt.source        = COALESCE(s.source, tgt.source),
           tgt.inserted_at   = SYSDATETIME()
      FROM [ARCA].[iot].[readings_minute] AS tgt WITH (HOLDLOCK)
      JOIN #historico AS s
        ON tgt.sensor_id = s.sensor_id
       AND tgt.ts_minute = s.ts_minute;

    INSERT INTO [ARCA].[iot].[readings_minute]
           (sensor_id, ts_local, ts_minute, instant_value, total_value, quality, source)
    SELECT
        s.sensor_id,
        s.ts_local,
        s.ts_minute,
        s.instant_value,
        s.total_value,
        s.quality,
        s.source
    FROM #historico AS s
    WHERE NOT EXISTS (
        SELECT 1
        FROM [ARCA].[iot].[readings_minute] AS t WITH (UPDLOCK, HOLDLOCK)
        WHERE t.sensor_id = s.sensor_id
          AND t.ts_minute = s.ts_minute
    );

    COMMIT TRANSACTION;

    SELECT
        sensor_id,
        COUNT(*) AS minutos_recuperados,
        MIN(ts_minute) AS primera_lectura,
        MAX(ts_minute) AS ultima_lectura
    FROM [ARCA].[iot].[readings_minute]
    WHERE sensor_id IN (3022, 3028, 3030, 3032, 3034, 3036)
      AND (@Desde IS NULL OR ts_local >= @Desde)
    GROUP BY sensor_id
    ORDER BY sensor_id;

    DROP TABLE #historico;
    DROP TABLE #historico_raw;
END
ELSE
BEGIN
    PRINT 'Historico no ejecutado. Cambie @EjecutarHistorico a 1 despues de validar la seccion B.';
END;
GO

/* ========================================================================
   D) COMPROBACION DE DUPLICADOS
   El resultado esperado es cero filas.
   ======================================================================== */

SELECT
    sensor_id,
    ts_minute,
    COUNT(*) AS cantidad
FROM [ARCA].[iot].[readings_minute]
WHERE sensor_id IN (3022, 3028, 3030, 3032, 3034, 3036)
GROUP BY sensor_id, ts_minute
HAVING COUNT(*) > 1
ORDER BY sensor_id, ts_minute;
GO
