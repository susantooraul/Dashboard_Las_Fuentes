/*
  ARCA CONTINENTAL - SQL Server definitivo (Opcion A)

  Arquitectura:
    - La app se conecta SOLO a ARCA
    - ARCA contiene o expone las vistas/tablas usadas por el dashboard

  Requisitos:
    1) Ejecutar este script dentro de ARCA
    2) El login SQL usado por la app debe tener permiso de lectura sobre ION_Data.dbo.Source y ION_Data.dbo.DataLog2

  Fuente real:
    - ION_Data.dbo.Source
    - ION_Data.dbo.DataLog2
*/
USE ARCA;
GO

/*
  ARCA CONTINENTAL - Vistas canónicas para el dashboard.
  Origen esperado:
    - ION_Data.dbo.DataLog2
    - ION_Data.dbo.Source
    - o equivalentes accesibles desde ARCA

  Esta versión deja el backend listo para usar SQLSERVER_SOURCE_TABLE=dbo.v_dashboard_measurements
  y conecta:
    - transformadores (TR1..TR5)
    - subestación principal
    - agrupaciones/circuitos del dashboard PME

  Nota:
    - PTAR no viene identificado en los procedimientos compartidos; si no hay filas para PTAR,
      el backend caerá a datos demo para esa sección.
*/

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER VIEW dbo.v_arca_transformer_hourly
AS
WITH Raw AS
(
    SELECT
        SourceID = dl.SourceID,
        Transformador = CASE s.Name
            WHEN 'ARCA_GPE.TR2' THEN 'TR-01'
            WHEN 'ARCA_GPE.TR1' THEN 'TR-02'
            WHEN 'ARCA_GPE.TR3' THEN 'TR-03'
            WHEN 'ARCA_GPE.TR4' THEN 'TR-04'
            WHEN 'ARCA_GPE.TR5' THEN 'TR-05'
        END,
        Capacidad_KVA = CASE s.Name
            WHEN 'ARCA_GPE.TR2' THEN CAST(1000.0 AS decimal(18,2))
            WHEN 'ARCA_GPE.TR1' THEN CAST(800.0 AS decimal(18,2))
            WHEN 'ARCA_GPE.TR3' THEN CAST(800.0 AS decimal(18,2))
            WHEN 'ARCA_GPE.TR4' THEN CAST(800.0 AS decimal(18,2))
            WHEN 'ARCA_GPE.TR5' THEN CAST(800.0 AS decimal(18,2))
        END,
        TsLocal = DATEADD(HOUR, -6, dl.TimestampUTC),
        TsHour = DATEADD(HOUR, DATEDIFF(HOUR, 0, DATEADD(HOUR, -6, dl.TimestampUTC)), 0),
        dl.TimestampUTC,
        dl.QuantityID,
        Val = TRY_CONVERT(float, dl.Value)
    FROM ION_Data.dbo.DataLog2 dl
    INNER JOIN ION_Data.dbo.Source s ON s.ID = dl.SourceID
    WHERE s.Name IN ('ARCA_GPE.TR1','ARCA_GPE.TR2','ARCA_GPE.TR3','ARCA_GPE.TR4','ARCA_GPE.TR5')
      AND dl.Value IS NOT NULL
      AND dl.QuantityID IN (129, 128, 58, 167, 173, 176, 9, 16, 19, 91)
),
EnergiaActiva AS
(
    SELECT
        SourceID,
        Transformador,
        Capacidad_KVA,
        TsHour,
        TimestampUTC,
        Val,
        ValPrev = LAG(Val) OVER (PARTITION BY SourceID, QuantityID ORDER BY TimestampUTC)
    FROM Raw
    WHERE QuantityID = 129 AND Transformador IS NOT NULL
),
EnergiaReactiva AS
(
    SELECT
        SourceID,
        Transformador,
        Capacidad_KVA,
        TsHour,
        TimestampUTC,
        Val,
        ValPrev = LAG(Val) OVER (PARTITION BY SourceID, QuantityID ORDER BY TimestampUTC)
    FROM Raw
    WHERE QuantityID = 91 AND Transformador IS NOT NULL
),
EnergiaActivaHora AS
(
    SELECT
        Transformador,
        TsHour,
        kWh = SUM(CASE
            WHEN ValPrev IS NULL THEN 0
            WHEN Val <= 0 OR ValPrev <= 0 THEN 0
            WHEN Val < ValPrev THEN 0
            ELSE Val - ValPrev
        END)
    FROM EnergiaActiva
    GROUP BY Transformador, TsHour
),
EnergiaReactivaHora AS
(
    SELECT
        Transformador,
        TsHour,
        kVARh = SUM(CASE
            WHEN ValPrev IS NULL THEN 0
            WHEN Val <= 0 OR ValPrev <= 0 THEN 0
            WHEN Val < ValPrev THEN 0
            ELSE Val - ValPrev
        END)
    FROM EnergiaReactiva
    GROUP BY Transformador, TsHour
),
VarsHora AS
(
    SELECT
        Transformador,
        Capacidad_KVA = MAX(Capacidad_KVA),
        TsHour,
        kW = AVG(CASE WHEN QuantityID = 128 THEN Val END),
        kVA = AVG(CASE WHEN QuantityID = 58 THEN Val END),
        V_AB = AVG(CASE WHEN QuantityID = 167 THEN Val END),
        V_BC = AVG(CASE WHEN QuantityID = 173 THEN Val END),
        V_CA = AVG(CASE WHEN QuantityID = 176 THEN Val END),
        I_A = AVG(CASE WHEN QuantityID = 9 THEN Val END),
        I_B = AVG(CASE WHEN QuantityID = 16 THEN Val END),
        I_C = AVG(CASE WHEN QuantityID = 19 THEN Val END)
    FROM Raw
    WHERE Transformador IS NOT NULL
    GROUP BY Transformador, TsHour
)
SELECT
    [timestamp] = V.TsHour,
    [section] = CAST('transformadores' AS varchar(80)),
    [system_name] = CAST(V.Transformador AS varchar(80)),
    [kw] = CAST(ISNULL(V.kW, 0) AS decimal(18,2)),
    [kwh] = CAST(ISNULL(EA.kWh, 0) AS decimal(18,2)),
    [kvarh] = CAST(ISNULL(ER.kVARh, 0) AS decimal(18,2)),
    [voltage] = CAST(ISNULL((ISNULL(V.V_AB, 0) + ISNULL(V.V_BC, 0) + ISNULL(V.V_CA, 0)) / NULLIF((CASE WHEN V.V_AB IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN V.V_BC IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN V.V_CA IS NOT NULL THEN 1 ELSE 0 END), 0), 0) AS decimal(18,2)),
    [current] = CAST(ISNULL((ISNULL(V.I_A, 0) + ISNULL(V.I_B, 0) + ISNULL(V.I_C, 0)) / NULLIF((CASE WHEN V.I_A IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN V.I_B IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN V.I_C IS NOT NULL THEN 1 ELSE 0 END), 0), 0) AS decimal(18,2)),
    [power_factor] = CAST(CASE WHEN ISNULL(V.kVA, 0) > 0 THEN V.kW / V.kVA ELSE 0 END AS decimal(10,4)),
    [cost_mxn] = CAST(0 AS decimal(18,2)),
    [status] = CAST(CASE
        WHEN ISNULL(V.kVA, 0) >= ISNULL(V.Capacidad_KVA, 0) THEN 'CRITICO'
        WHEN ISNULL(V.kVA, 0) >= ISNULL(V.Capacidad_KVA, 0) * 0.85 THEN 'ALERTA'
        ELSE 'NORMAL'
    END AS varchar(50)),
    [kva] = CAST(ISNULL(V.kVA, 0) AS decimal(18,2)),
    [capacity_kva] = CAST(ISNULL(V.Capacidad_KVA, 0) AS decimal(18,2)),
    [load_pct] = CAST(CASE WHEN ISNULL(V.Capacidad_KVA, 0) > 0 THEN (ISNULL(V.kVA, 0) / V.Capacidad_KVA) * 100 ELSE 0 END AS decimal(10,2))
FROM VarsHora V
LEFT JOIN EnergiaActivaHora EA ON EA.Transformador = V.Transformador AND EA.TsHour = V.TsHour
LEFT JOIN EnergiaReactivaHora ER ON ER.Transformador = V.Transformador AND ER.TsHour = V.TsHour;
GO

CREATE OR ALTER VIEW dbo.v_arca_process_hourly
AS
WITH CircuitMap AS
(
    SELECT *
    FROM (VALUES
      ('110','Extractores','auxiliares'),
      ('1C1','Transp L1','linea1'),
      ('1C2','Bombas Hidro-Const','tag'),
      ('1C3','Comp. NH3-4','refrigeracion'),
      ('1C4','Interruptor a Interlock','auxiliares'),
      ('1C5','Comp. NH3-7','refrigeracion'),
      ('1C6','Pozo #3','pozos'),
      ('1C7','Torre de Enfriamiento #3','auxiliares'),
      ('1C8','Bomba Vs incendio','auxiliares'),
      ('1C9','CCM Laboratorios','jarabes'),
      ('2C1','Paletizador L1','linea1'),
      ('2C2','CO2','auxiliares'),
      ('2C3','Lavadora #1 L1','linea1'),
      ('2C4','Aire Lavado L1 y L2','auxiliares'),
      ('2C5','CCM Tratamiento de Aguas','tag'),
      ('2C6','CCM Equipos Auxiliares (Calderas)','auxiliares'),
      ('2C7','Planta Emergencia 2 Ctos','auxiliares'),
      ('2C8','Preparacion de Jarabes','jarabes'),
      ('2C9','CCM L1 32 Motores','linea1'),
      ('3C1','Bombas Mejoradas','tag'),
      ('3C2','Extractor de Etiquetas','linea2'),
      ('3C3','NH3-2','refrigeracion'),
      ('3C4','NH3-4','refrigeracion'),
      ('3C5','Lampara UV','tag'),
      ('4C1','Sala Osmosis','linea3'),
      ('4C2','ML 2 Alumbrado','alumbrado'),
      ('4C3','Tab Control de Embalaje L3/L4','linea3'),
      ('4C4','Estacion de Gasolina','transporte'),
      ('4C5','Condensador #3','refrigeracion'),
      ('4C6','Comp. NH3-2','refrigeracion'),
      ('4C7','CCM L2 Tab 3','linea2'),
      ('4C8','Condensador #2','refrigeracion'),
      ('4C9','Lavadora de Botellas #2','linea2'),
      ('210','Filtro Carbon','tag'),
      ('211','Control de Compresores','refrigeracion'),
      ('212','Control NH3-7/8','refrigeracion'),
      ('213','Condensador #2','refrigeracion'),
      ('410','Sala Osmosis','linea3'),
      ('411','Paletizador L1','linea1'),
      ('412','Comp. NH3-1','refrigeracion'),
      ('413','Filtro Carbon','tag'),
      ('414','Comp. NH3-6','refrigeracion')
    ) AS M(Codigo, Equipo, Seccion)
),
Raw AS
(
    SELECT
        M.Codigo,
        M.Equipo,
        M.Seccion,
        TsHour = DATEADD(HOUR, DATEDIFF(HOUR, 0, DATEADD(HOUR, -6, D.TimeStampUTC)), 0),
        D.TimeStampUTC,
        D.QuantityID,
        Val = TRY_CONVERT(float, D.Value)
    FROM CircuitMap M
    INNER JOIN ION_Data.dbo.Source S ON S.Name = M.Codigo
    INNER JOIN ION_Data.dbo.DataLog2 D ON D.SourceID = S.ID
    WHERE D.Value IS NOT NULL
      AND D.QuantityID IN (198, 191, 193)
),
Agg AS
(
    SELECT
        Codigo,
        Equipo,
        Seccion,
        TsHour,
        kWh = MAX(CASE WHEN QuantityID = 198 THEN Val END) - MIN(CASE WHEN QuantityID = 198 THEN Val END),
        kVARh = ABS(MAX(CASE WHEN QuantityID = 191 THEN Val END) - MIN(CASE WHEN QuantityID = 191 THEN Val END)),
        kW = AVG(CASE WHEN QuantityID = 193 THEN Val END)
    FROM Raw
    GROUP BY Codigo, Equipo, Seccion, TsHour
)
SELECT
    [timestamp] = TsHour,
    [section] = CAST(Seccion AS varchar(80)),
    [system_name] = CAST(Equipo AS varchar(80)),
    [kw] = CAST(ISNULL(kW, 0) AS decimal(18,2)),
    [kwh] = CAST(ISNULL(kWh, 0) AS decimal(18,2)),
    [kvarh] = CAST(ISNULL(kVARh, 0) AS decimal(18,2)),
    [voltage] = CAST(0 AS decimal(18,2)),
    [current] = CAST(0 AS decimal(18,2)),
    [power_factor] = CAST(0 AS decimal(10,4)),
    [cost_mxn] = CAST(0 AS decimal(18,2)),
    [status] = CAST('NORMAL' AS varchar(50))
FROM Agg;
GO

CREATE OR ALTER VIEW dbo.v_arca_substation_hourly
AS
SELECT
    [timestamp] = T.[timestamp],
    [section] = CAST('subestacion' AS varchar(80)),
    [system_name] = CAST('Subestacion Principal' AS varchar(80)),
    [kw] = CAST(SUM(T.[kw]) AS decimal(18,2)),
    [kwh] = CAST(SUM(T.[kwh]) AS decimal(18,2)),
    [kvarh] = CAST(SUM(T.[kvarh]) AS decimal(18,2)),
    [voltage] = CAST(AVG(T.[voltage]) AS decimal(18,2)),
    [current] = CAST(SUM(T.[current]) AS decimal(18,2)),
    [power_factor] = CAST(CASE WHEN SUM(ISNULL(T.[kva], 0)) > 0 THEN SUM(T.[kw]) / SUM(T.[kva]) ELSE 0 END AS decimal(10,4)),
    [cost_mxn] = CAST(0 AS decimal(18,2)),
    [status] = CAST(CASE WHEN MAX(T.[load_pct]) >= 100 THEN 'CRITICO' WHEN MAX(T.[load_pct]) >= 85 THEN 'ALERTA' ELSE 'NORMAL' END AS varchar(50))
FROM dbo.v_arca_transformer_hourly T
GROUP BY T.[timestamp];
GO

CREATE OR ALTER VIEW dbo.v_dashboard_measurements
AS
SELECT
    [timestamp], [section], [system_name], [kw], [kwh], [kvarh], [voltage], [current], [power_factor], [cost_mxn], [status]
FROM dbo.v_arca_transformer_hourly
UNION ALL
SELECT
    [timestamp], [section], [system_name], [kw], [kwh], [kvarh], [voltage], [current], [power_factor], [cost_mxn], [status]
FROM dbo.v_arca_substation_hourly
UNION ALL
SELECT
    [timestamp], [section], [system_name], [kw], [kwh], [kvarh], [voltage], [current], [power_factor], [cost_mxn], [status]
FROM dbo.v_arca_process_hourly;
GO


CREATE OR ALTER VIEW dbo.v_dashboard_transformer_capacity
AS
SELECT system_name, capacity_kva
FROM (
    SELECT DISTINCT [system_name], [capacity_kva]
    FROM dbo.v_arca_transformer_hourly
) X;
GO
