/*
Crea una vista compatible con el backend.
Ajusta los nombres reales de tu tabla fuente y columnas.
*/

CREATE OR ALTER VIEW dbo.v_dashboard_measurements AS
SELECT
    CAST(fecha_hora AS datetime2) AS [timestamp],
    CASE
        WHEN area = 'SUBESTACION' THEN 'subestacion'
        WHEN area = 'TRANSFORMADORES' THEN 'transformadores'
        WHEN area = 'LINEA 1' THEN 'linea1'
        WHEN area = 'LINEA 2' THEN 'linea2'
        WHEN area = 'LINEA 3' THEN 'linea3'
        WHEN area = 'ALUMBRADO' THEN 'alumbrado'
        WHEN area = 'AUXILIARES' THEN 'auxiliares'
        WHEN area = 'TRANSPORTE' THEN 'transporte'
        WHEN area = 'REFRIGERACION' THEN 'refrigeracion'
        WHEN area = 'POZOS' THEN 'pozos'
        WHEN area = 'JARABES' THEN 'jarabes'
        ELSE 'dashboard'
    END AS [section],
    equipo AS [system_name],
    CAST(kw AS decimal(18,2)) AS [kw],
    CAST(kwh AS decimal(18,2)) AS [kwh],
    CAST(kvarh AS decimal(18,2)) AS [kvarh],
    CAST(voltaje AS decimal(18,2)) AS [voltage],
    CAST(corriente AS decimal(18,2)) AS [current],
    CAST(factor_potencia AS decimal(10,4)) AS [power_factor],
    CAST(ISNULL(costo_mxn, 0) AS decimal(18,2)) AS [cost_mxn],
    CAST(ISNULL(estatus, 'NORMAL') AS varchar(50)) AS [status]
FROM dbo.tu_tabla_origen;
