"""Contrato operativo centralizado para Planta Las Fuentes.

Este archivo concentra nombres, sensores, fuentes, unidades y politicas de
calidad conocidas por el proyecto. Los campos marcados como pendientes no son
suposiciones: deben resolverse con auditoria SQL y/o confirmacion de Planta
antes de convertirse en reglas hidraulicas.

Regla de homologacion inicial:
- centralizar el contrato sin cambiar la matematica existente;
- conservar sensores/mapeos confirmados;
- hacer explicitos los datos todavia no confirmados.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Iterable


PLANT_NAME = "Las Fuentes"
PLANT_DISPLAY_NAME = "PLANTA LAS FUENTES"
DASHBOARD_TITLE = "Dashboard ARCA Las Fuentes"
LOCAL_TIMEZONE = "America/Mexico_City"
PLANT_CONTRACT_VERSION = 1

# Barrera tecnica amplia contra corrupciones evidentes; no es un limite
# operativo de flujo ni una regla heredada de otra planta.
MAX_TECHNICAL_PERIOD_DELTA_M3 = 1_000_000.0


# Fuentes fisicas/logicas consideradas por la arquitectura heredada.
# ``timestamp_status`` distingue una regla ya usada por el runtime de una
# validacion fisica pendiente. No se inventan reglas temporales.
SOURCE_CONTRACTS: dict[str, dict[str, Any]] = {
    "readings_minute": {
        "table": "iot.readings_minute",
        "timestamp_mode": "mixed_by_sensor",
        "timestamp_expression": "COALESCE(ts_local, ts_minute, inserted_at)",
        "timestamp_status": "sql_observed_utc_by_sensor",
        "physical_history_start_raw": None,
        "physical_history_note": "Las lecturas observadas el 11/09/2026 usan hora UTC en ts_local/ts_minute y se convierten a America/Mexico_City.",
        "expected_cadence_minutes": 1,
        "flow_column": "instant_value",
        "total_column": "total_value",
        "sensor_id_column": "sensor_id",
        "purpose": "historico_operativo",
    },
    "pozos_bos": {
        "table": "dbo.SensorsBOS_Pozo",
        "timestamp_mode": "utc",
        "timestamp_column": "Time_Stamp",
        "timestamp_status": "sql_observed_2026_09_11",
        "physical_history_start_raw": None,
        "physical_history_start_local": None,
        "expected_cadence_minutes": 1,
        "purpose": "snapshot_y_fallback_pozos",
    },
    "lineas_bos": {
        "table": "dbo.SensorsBOS_Linea",
        "timestamp_mode": "local",
        "timestamp_column": "Time_Stamp",
        "timestamp_status": "unused_for_las_fuentes",
        "physical_history_start_raw": None,
        "physical_history_start_local": None,
        "expected_cadence_minutes": 1,
        "purpose": "snapshot_y_fallback_lineas",
    },
    "tanque_bos": {
        "table": "dbo.SensorsBOS_Tanque",
        "timestamp_mode": "utc",
        "timestamp_column": "Time_Stamp",
        "timestamp_status": "sql_observed_2026_09_11",
        "physical_history_start_raw": None,
        "physical_history_start_local": None,
        "expected_cadence_minutes": 1,
        "purpose": "snapshot_flujos_y_sosa",
    },
    "lavadoras_bos": {
        "table": "dbo.SensorsBOS_Lavadoras",
        "timestamp_mode": "utc",
        "timestamp_column": "Time_Stamp",
        "timestamp_status": "unused_not_confirmed_for_las_fuentes",
        "physical_history_start_raw": None,
        "physical_history_start_local": None,
        "expected_cadence_minutes": None,
        "purpose": "pendiente_sin_modulo_operativo",
    },
    "niveles_bos": {
        "table": "dbo.NIVELES_BOS",
        "timestamp_mode": "local",
        "timestamp_column": "Time_Stamp",
        "timestamp_status": "unused_not_confirmed_for_las_fuentes",
        "physical_history_start_raw": None,
        "physical_history_start_local": None,
        "expected_cadence_minutes": 60,
        "purpose": "pendiente_sin_modulo_operativo",
    },
    "uv_bos": {
        "table": "dbo.LAMPARAS_UV",
        "timestamp_mode": "utc",
        "timestamp_column": "Time_Stamp",
        "timestamp_status": "unused_not_confirmed_for_las_fuentes",
        "physical_history_start_raw": None,
        "physical_history_start_local": None,
        "expected_cadence_minutes": 60,
        "purpose": "pendiente_sin_modulo_operativo",
    },
}

READINGS_MINUTE_TABLE = SOURCE_CONTRACTS["readings_minute"]["table"]
POZO_BOS_TABLE = SOURCE_CONTRACTS["pozos_bos"]["table"]
LINEA_BOS_TABLE = SOURCE_CONTRACTS["lineas_bos"]["table"]
TANQUE_BOS_TABLE = SOURCE_CONTRACTS["tanque_bos"]["table"]
LAVADORAS_BOS_TABLE = SOURCE_CONTRACTS["lavadoras_bos"]["table"]
NIVELES_BOS_TABLE = SOURCE_CONTRACTS["niveles_bos"]["table"]
UV_BOS_TABLE = SOURCE_CONTRACTS["uv_bos"]["table"]

LOCAL_TIMESTAMP_TABLES = {
    str(source["table"])
    for source in SOURCE_CONTRACTS.values()
    if source.get("timestamp_mode") == "local" and str(source.get("table") or "").lower() != READINGS_MINUTE_TABLE.lower()
}

UTC_TIMESTAMP_TABLES = {
    str(source["table"])
    for source in SOURCE_CONTRACTS.values()
    if source.get("timestamp_mode") == "utc"
}

# Evidencia SQL del 11/09/2026 en Las Fuentes: los sensores hidraulicos
# confirmados almacenan ts_local/ts_minute en UTC (se observaron seis horas
# por delante de inserted_at en hora local). La normalizacion se hace por sensor.
READINGS_MINUTE_TIMESTAMP_MODE_BY_SENSOR: dict[int, str] = {
    1001: "utc",
    1051: "utc",
    1101: "utc",
    1151: "utc",
    1201: "utc",
    3002: "utc",
    3004: "utc",
    3006: "utc",
    3008: "utc",
    3010: "utc",
    3012: "utc",
    3014: "utc",
    3018: "utc",
    3020: "utc",
    3022: "utc",
    3028: "utc",
    3030: "utc",
    3032: "utc",
    3034: "utc",
    3036: "utc",
}
READINGS_MINUTE_LOCAL_SENSOR_IDS = frozenset(
    sensor_id for sensor_id, mode in READINGS_MINUTE_TIMESTAMP_MODE_BY_SENSOR.items() if mode == "local"
)
READINGS_MINUTE_UTC_SENSOR_IDS = frozenset(
    sensor_id for sensor_id, mode in READINGS_MINUTE_TIMESTAMP_MODE_BY_SENSOR.items() if mode == "utc"
)

# Evidencia observada; no equivale automaticamente a fecha de validez hidraulica.
# Se conserva separada de hydraulic_valid_from/instant_value_trust_from para que
# el Incremental 02 no confunda "primer dato existente" con "dato confiable".
SENSOR_AUDIT_EVIDENCE: dict[int, dict[str, Any]] = {}


# Politica base: refleja lo que la aplicacion ya hace sin declarar hechos
# fisicos que todavia no han sido auditados.
HYDRAULIC_POLICY_DEFAULTS: dict[str, Any] = {
    "flow_unit": "L/s",
    "totalizer_unit": "m3",
    "flow_zero_policy": "valid_sample",
    "totalizer_zero_policy": "ignore_as_analytical_boundary_sql_audited",
    "negative_totalizer_delta_policy": "review",
    "positive_transition_jump_policy": "review_above_technical_limit",
    "technical_max_period_delta_m3": MAX_TECHNICAL_PERIOD_DELTA_M3,
    "hydraulic_valid_from": None,
    "instant_value_trust_from": None,
    "require_flow_validation": None,
    "async_totalizer_tolerance_seconds": None,
    "audit_status": "pending_sql_audit",
}


def _hydraulic_contract(
    *,
    snapshot_source: str,
    history_source: str | None,
    **overrides: Any,
) -> dict[str, Any]:
    contract = deepcopy(HYDRAULIC_POLICY_DEFAULTS)
    contract.update({
        "snapshot_source": snapshot_source,
        "history_source": history_source,
    })
    contract.update(overrides)
    return contract


WELLS = [
    {
        "id": "pozo-1",
        "name": "Pozo 1",
        "sensor_id": 1001,
        "bos_prefix": "POZO_FLOW_OUT",
        "bos_index": 0,
        "operational_number": 1,
        "hydraulic_contract": _hydraulic_contract(snapshot_source="pozos_bos", history_source="readings_minute"),
    },
    {
        "id": "pozo-2",
        "name": "Pozo 2",
        "sensor_id": 1051,
        "bos_prefix": "POZO_FLOW_OUT",
        "bos_index": 1,
        "operational_number": 2,
        "hydraulic_contract": _hydraulic_contract(snapshot_source="pozos_bos", history_source="readings_minute"),
    },
    {
        "id": "pozo-3",
        "name": "Pozo 3",
        "sensor_id": 1101,
        "bos_prefix": "POZO_FLOW_OUT",
        "bos_index": 2,
        "operational_number": 3,
        "hydraulic_contract": _hydraulic_contract(snapshot_source="pozos_bos", history_source="readings_minute"),
    },
    {
        "id": "pozo-4",
        "name": "Pozo 4",
        "sensor_id": 1151,
        "bos_prefix": "POZO_FLOW_OUT",
        "bos_index": 3,
        "operational_number": 4,
        "hydraulic_contract": _hydraulic_contract(snapshot_source="pozos_bos", history_source="readings_minute"),
    },
    {
        "id": "pozo-5",
        "name": "Pozo 5",
        "sensor_id": 1201,
        "bos_prefix": "POZO_FLOW_OUT",
        "bos_index": 4,
        "operational_number": 5,
        "hydraulic_contract": _hydraulic_contract(snapshot_source="pozos_bos", history_source="readings_minute"),
    },
]

# Referencia tecnica requerida por la arquitectura heredada. No se muestra como
# una entrada independiente porque Las Fuentes no ha confirmado un medidor
# maestro separado de sus cinco pozos.
WATER_ENTRY = {
    "id": "referencia-pozo-1",
    "name": "Referencia interna Pozo 1",
    "primary_sensor_id": 1001,
    "backup_sensor_id": 1001,
    "primary_bos": {"prefix": "POZO_FLOW_OUT", "index": 0},
    "backup_bos": {"prefix": "POZO_FLOW_OUT", "index": 0},
    "visible": False,
    "communication_minutes": 5,
    "hydraulic_contract": _hydraulic_contract(snapshot_source="pozos_bos", history_source="readings_minute"),
}

LINES: list[dict[str, Any]] = []

FLOWS = [
    *[
        {
            "id": element_id,
            "name": name,
            "sensor_id": sensor_id,
            "bos_index": bos_index,
            "module_group": "tam",
            "visible": True,
            "hydraulic_contract": _hydraulic_contract(snapshot_source="tanque_bos", history_source="readings_minute"),
        }
        for element_id, name, sensor_id, bos_index in (
            ("salida-def-1", "Salida DEF 1", 3018, 8),
            ("salida-def-2", "Salida DEF 2", 3008, 3),
            ("salida-def-3", "Salida DEF 3", 3002, 0),
            ("salida-def-4", "Salida DEF 4", 3004, 1),
            ("salida-def-5", "Salida DEF 5", 3006, 2),
            ("entrada-pc-4", "Entrada PC 4", 3014, 6),
            ("entrada-pc-5", "Entrada PC 5", 3012, 5),
            ("entrada-pc-6", "Entrada PC 6", 3010, 4),
            ("llegada-pozo-5", "Llegada Pozo 5", 3020, 9),
            ("entrada-tam", "Entrada TAM", 3022, 12),
        )
    ],
    *[
        {
            "id": element_id,
            "name": name,
            "sensor_id": sensor_id,
            "bos_index": bos_index,
            "module_group": "embotellado",
            "visible": True,
            "hydraulic_contract": _hydraulic_contract(snapshot_source="tanque_bos", history_source="readings_minute"),
        }
        for element_id, name, sensor_id, bos_index in (
            ("entrada-pc-1", "Entrada PC 1", 3028, 13),
            ("entrada-pc-2", "Entrada PC 2", 3030, 14),
            ("entrada-pc-3", "Entrada PC 3", 3032, 15),
            ("cip", "CIP", 3034, 16),
        )
    ],
    {
        "id": "salida-cisterna",
        "name": "Salida de cisterna",
        "sensor_id": 3036,
        "bos_index": 17,
        "module_group": "cisterna",
        "visible": True,
        "hydraulic_contract": _hydraulic_contract(snapshot_source="tanque_bos", history_source="readings_minute"),
    },
]

LEVELS: list[dict[str, Any]] = []

UV_SCALE_STATUS = "disabled_not_confirmed_for_las_fuentes"
UV = {
    "enabled": False,
    "communication_minutes": 90,
    "state_map": {0: "Apagada", 1: "Ignición", 2: "Encendida"},
    "lamps": [],
    "system_fields": {
        "UVT": {"key": "uvt", "label": "UVT", "unit": "%"},
        "Power": {"key": "power", "label": "Potencia", "unit": "%"},
        "Flow": {"key": "flow", "label": "Flujo", "unit": "m³/h"},
        "Dosis": {"key": "dose", "label": "Dosis", "unit": "mJ/cm²"},
    },
    # Escala neutral mientras el modulo permanezca deshabilitado.
    "field_scale": {"UVT": 1.0, "Power": 1.0, "Flow": 1.0, "Dosis": 1.0, "StatusL1": 1.0, "StatusL2": 1.0, "AGEL1": 1.0, "AGEL2": 1.0},
    "scale_status": UV_SCALE_STATUS,
}

# Cadencia tecnica heredada. Los cortes por turno no se exponen hasta que Planta
# confirme formalmente sus horarios y reglas operativas.
SHIFT_SAMPLE_CADENCE_MINUTES = {
    "entrada": SOURCE_CONTRACTS["pozos_bos"]["expected_cadence_minutes"],
    "pozos": SOURCE_CONTRACTS["pozos_bos"]["expected_cadence_minutes"],
    "lineas": SOURCE_CONTRACTS["lineas_bos"]["expected_cadence_minutes"],
    "flujos": SOURCE_CONTRACTS["tanque_bos"]["expected_cadence_minutes"],
    "niveles": SOURCE_CONTRACTS["niveles_bos"]["expected_cadence_minutes"],
    "uv": SOURCE_CONTRACTS["uv_bos"]["expected_cadence_minutes"],
}

WASHERS = {
    "enabled": False,
    "status": "pending",
    "message": "Pendiente de datos operativos",
    "channels": ["LAVADORAS_0", "LAVADORAS_1", "LAVADORAS_2", "LAVADORAS_3"],
}

CONFIRMED_HYDRAULIC_MINUTE_SENSOR_IDS = sorted({
    int(WATER_ENTRY["primary_sensor_id"]),
    *[int(item["sensor_id"]) for item in WELLS if item.get("sensor_id") is not None],
    *[int(item["sensor_id"]) for item in LINES if item.get("sensor_id") is not None],
    *[int(item["sensor_id"]) for item in FLOWS if item.get("sensor_id") is not None],
})

# No se conservan canales auxiliares heredados sin correspondencia confirmada.
AUXILIARY_MINUTE_CHANNELS: list[dict[str, Any]] = []

READINGS_MINUTE_SENSOR_IDS = sorted({
    *CONFIRMED_HYDRAULIC_MINUTE_SENSOR_IDS,
    *[int(item["sensor_id"]) for item in AUXILIARY_MINUTE_CHANNELS],
})

# La evidencia de cada sensor se mantiene separada de las reglas hidraulicas.
for _item in [WATER_ENTRY, *WELLS, *LINES, *FLOWS]:
    _sensor_id = _item.get("primary_sensor_id", _item.get("sensor_id"))
    if _sensor_id is None:
        continue
    _evidence = SENSOR_AUDIT_EVIDENCE.get(int(_sensor_id))
    if _evidence is not None:
        _item["hydraulic_contract"]["audit_status"] = "sql_audited_partial_requires_hydraulic_review"
        _item["hydraulic_contract"]["audit_evidence"] = deepcopy(_evidence)


# Turnos provisionales habilitados para validación visual/operativa en Las Fuentes.
# Se usan 00–07, 07–15 y 15–24 mientras la planta confirma su matriz oficial.
# Los horarios viven aquí para poder sustituirlos sin tocar las pantallas.
SHIFT_CONTRACT_STATUS = "provisional_enabled_for_validation"
SHIFT_WINDOWS = [
    {"id": "turno-1", "label": "Turno 1", "start": "00:00", "end": "07:00"},
    {"id": "turno-2", "label": "Turno 2", "start": "07:00", "end": "15:00"},
    {"id": "turno-3", "label": "Turno 3", "start": "15:00", "end": "24:00"},
]


def get_source_contract(source_key: str) -> dict[str, Any]:
    """Return a defensive copy of a configured source contract."""
    if source_key not in SOURCE_CONTRACTS:
        raise KeyError(f"Fuente de Las Fuentes no configurada: {source_key}")
    return deepcopy(SOURCE_CONTRACTS[source_key])


def iter_hydraulic_elements() -> Iterable[dict[str, Any]]:
    """Yield all hydraulic elements without inventing missing sensor ids."""
    yield {
        "module": "entrada",
        "id": WATER_ENTRY["id"],
        "name": WATER_ENTRY["name"],
        "sensor_id": WATER_ENTRY.get("primary_sensor_id"),
        "hydraulic_contract": deepcopy(WATER_ENTRY["hydraulic_contract"]),
    }
    for module, items in (("pozos", WELLS), ("lineas", LINES), ("flujos", FLOWS)):
        for item in items:
            yield {
                "module": module,
                "id": item["id"],
                "name": item["name"],
                "sensor_id": item.get("sensor_id"),
                "hydraulic_contract": deepcopy(item["hydraulic_contract"]),
            }


def get_hydraulic_contract(sensor_id: int) -> dict[str, Any]:
    """Resolve the declared hydraulic contract for a confirmed minute sensor."""
    target = int(sensor_id)
    matches = [item for item in iter_hydraulic_elements() if item.get("sensor_id") == target]
    if not matches:
        raise KeyError(f"Sensor {target} no pertenece al contrato hidraulico confirmado de Las Fuentes.")
    # 1001 puede existir como referencia tecnica y como Pozo 1; el contrato es el mismo.
    return deepcopy(matches[0]["hydraulic_contract"])
