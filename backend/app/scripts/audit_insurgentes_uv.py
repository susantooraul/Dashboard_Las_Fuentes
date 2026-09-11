"""Auditoria de solo lectura del contrato de LAMPARAS_UV en Planta Las Fuentes.

Uso desde ``backend``::

    python -m app.scripts.audit_insurgentes_uv
    python -m app.scripts.audit_insurgentes_uv --rows 30

El script no ejecuta INSERT/UPDATE/DELETE. Su objetivo es confirmar el mapeo
real de los campos mostrados por SCADA (ID, Age, UVT, Power, Flow, Dosis,
Ignition, State y Status) antes de enriquecer la interfaz del dashboard.
"""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.config import get_settings
from app.services.insurgentes_config import LOCAL_TIMEZONE, UV, UV_BOS_TABLE


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Auditoria LAMPARAS_UV Las Fuentes (solo lectura).")
    parser.add_argument("--rows", type=int, default=20, help="Cantidad de filas recientes a mostrar (5-100).")
    return parser.parse_args()


def _fmt(value: Any) -> str:
    if value is None:
        return "-"
    if isinstance(value, datetime):
        return value.isoformat(sep=" ", timespec="seconds")
    if isinstance(value, float):
        return f"{value:.6g}"
    return str(value)


def _md(value: Any) -> str:
    return _fmt(value).replace("|", "\\|").replace("\n", " ")


def _print_table(headers: list[str], rows: list[list[Any]]) -> None:
    rendered = [[_fmt(value) for value in row] for row in rows]
    widths = [len(header) for header in headers]
    for row in rendered:
        for index, value in enumerate(row):
            widths[index] = max(widths[index], len(value))
    print(" | ".join(header.ljust(widths[index]) for index, header in enumerate(headers)))
    print("-+-".join("-" * width for width in widths))
    for row in rendered:
        print(" | ".join(value.ljust(widths[index]) for index, value in enumerate(row)))


def _markdown_table(headers: list[str], rows: list[list[Any]]) -> str:
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    lines.extend("| " + " | ".join(_md(value) for value in row) + " |" for row in rows)
    return "\n".join(lines)


def _schema(session) -> list[dict[str, Any]]:
    query = text("""
        SELECT
            c.column_id,
            c.name AS column_name,
            TYPE_NAME(c.user_type_id) AS data_type,
            c.max_length,
            c.precision,
            c.scale,
            c.is_nullable
        FROM sys.columns AS c
        WHERE c.object_id = OBJECT_ID(:table_name)
        ORDER BY c.column_id
    """)
    return [dict(row) for row in session.execute(query, {"table_name": UV_BOS_TABLE}).mappings().all()]


def _summary(session) -> dict[str, Any]:
    query = text(f"""
        SELECT
            COUNT_BIG(*) AS row_count,
            MIN(Time_Stamp) AS first_record,
            MAX(Time_Stamp) AS last_record
        FROM {UV_BOS_TABLE}
    """)
    return dict(session.execute(query).mappings().first() or {})


def _recent_rows(session, columns: list[str], limit: int) -> list[dict[str, Any]]:
    # Los nombres provienen de sys.columns, no de entrada del usuario.
    select_columns = ", ".join(f"[{name}]" for name in columns)
    order_column = "[Time_Stamp]" if "Time_Stamp" in columns else f"[{columns[0]}]"
    query = text(f"SELECT TOP {int(limit)} {select_columns} FROM {UV_BOS_TABLE} ORDER BY {order_column} DESC")
    return [dict(row) for row in session.execute(query).mappings().all()]


def _distinct_values(session, column: str, limit: int = 20) -> list[dict[str, Any]]:
    query = text(f"""
        SELECT TOP {int(limit)}
            [{column}] AS value,
            COUNT_BIG(*) AS occurrences,
            MIN(Time_Stamp) AS first_seen,
            MAX(Time_Stamp) AS last_seen
        FROM {UV_BOS_TABLE}
        GROUP BY [{column}]
        ORDER BY COUNT_BIG(*) DESC, [{column}]
    """)
    return [dict(row) for row in session.execute(query).mappings().all()]


def _candidate_columns(columns: list[str]) -> list[str]:
    keywords = ("id", "ignit", "state", "status", "age", "agel")
    found: list[str] = []
    for column in columns:
        lowered = column.lower()
        if any(keyword in lowered for keyword in keywords):
            found.append(column)
    return found


def _current_mapping_rows() -> list[list[Any]]:
    rows: list[list[Any]] = []
    for lamp in UV.get("lamps", []):
        rows.append([
            lamp.get("id"),
            lamp.get("name"),
            lamp.get("agel_field"),
            lamp.get("state_field"),
            lamp.get("status_field"),
        ])
    return rows


def _requested_contract_rows(columns: list[str]) -> list[list[Any]]:
    lower_to_real = {name.lower(): name for name in columns}

    def exact(*names: str) -> str:
        for name in names:
            value = lower_to_real.get(name.lower())
            if value:
                return value
        return "No confirmado"

    return [
        ["ID", "Identificador de lámpara/equipo", exact("ID", "Lamp_ID", "LampID")],
        ["Age", "Edad/contador individual", "AGEL1 / AGEL2" if "AGEL1" in columns and "AGEL2" in columns else exact("Age")],
        ["UVT", "Lectura general del sistema", exact("UVT")],
        ["Power", "Lectura general del sistema", exact("Power")],
        ["Flow", "Lectura general del sistema", exact("Flow")],
        ["Dosis", "Lectura general del sistema", exact("Dosis", "Dose")],
        ["Ignition", "Pendiente confirmar semántica real", exact("Ignition", "IgnitionL1", "IgnitionL2")],
        ["State", "Actualmente el dashboard usa Lamp_StateL1/L2", "Lamp_StateL1 / Lamp_StateL2" if "Lamp_StateL1" in columns and "Lamp_StateL2" in columns else exact("State")],
        ["Status", "Lectura individual", "StatusL1 / StatusL2" if "StatusL1" in columns and "StatusL2" in columns else exact("Status")],
    ]


def main() -> int:
    args = _parse_args()
    limit = max(5, min(int(args.rows), 100))
    settings = get_settings()

    print(f"Planta: Las Fuentes | timezone operativo: {LOCAL_TIMEZONE}")
    print(f"Tabla objetivo: {UV_BOS_TABLE}")
    print("Modo auditoria: SOLO LECTURA. No se ejecutan INSERT/UPDATE/DELETE.")
    print(f"DB_MODE detectado: {settings.db_mode}")
    if settings.db_mode.lower() != "sqlserver":
        print("ERROR: esta auditoria requiere DB_MODE=sqlserver para inspeccionar dbo.LAMPARAS_UV.")
        return 2

    from app.database import SessionLocal

    markdown: list[str] = [
        "# Auditoría de Lámparas UV - Planta Las Fuentes",
        "",
        f"Generada: {datetime.now().isoformat(sep=' ', timespec='seconds')}",
        f"Tabla: `{UV_BOS_TABLE}`",
        "",
        "> Diagnóstico de solo lectura. Este reporte no modifica la base de datos ni el contrato UV.",
        "",
    ]

    try:
        with SessionLocal() as session:
            database_name = session.execute(text("SELECT DB_NAME() AS database_name")).mappings().first()
            db_name = (database_name or {}).get("database_name", "-")
            print(f"Base conectada: {db_name}")
            markdown.append(f"Base: `{db_name}`")
            markdown.append("")

            schema = _schema(session)
            if not schema:
                print(f"ERROR: no se encontró el objeto {UV_BOS_TABLE} o no fue posible leer sus columnas.")
                return 3
            columns = [str(row["column_name"]) for row in schema]

            print("\n1) Esquema real de dbo.LAMPARAS_UV")
            schema_rows = [[
                row.get("column_id"), row.get("column_name"), row.get("data_type"), row.get("max_length"),
                row.get("precision"), row.get("scale"), bool(row.get("is_nullable")),
            ] for row in schema]
            _print_table(["#", "columna", "tipo", "max_len", "precision", "scale", "nullable"], schema_rows)
            markdown.extend(["## Esquema real", "", _markdown_table(["#", "Columna", "Tipo", "Max len", "Precisión", "Scale", "Nullable"], schema_rows), ""])

            summary = _summary(session)
            print("\n2) Rango físico")
            summary_rows = [[summary.get("row_count"), summary.get("first_record"), summary.get("last_record")]]
            _print_table(["filas", "primer registro", "último registro"], summary_rows)
            markdown.extend(["## Rango físico", "", _markdown_table(["Filas", "Primer registro", "Último registro"], summary_rows), ""])

            mapping_rows = _current_mapping_rows()
            print("\n3) Mapeo que usa actualmente el dashboard")
            _print_table(["id interno", "nombre", "Age", "State", "Status"], mapping_rows)
            markdown.extend(["## Mapeo actual del dashboard", "", _markdown_table(["ID interno", "Nombre", "Age", "State", "Status"], mapping_rows), ""])

            requested_rows = _requested_contract_rows(columns)
            print("\n4) Contrato solicitado por planta vs columnas detectadas")
            _print_table(["campo SCADA", "interpretación", "columna detectada"], requested_rows)
            markdown.extend(["## Contrato solicitado por planta", "", _markdown_table(["Campo SCADA", "Interpretación", "Columna detectada"], requested_rows), ""])

            candidates = _candidate_columns(columns)
            print("\n5) Columnas candidatas para ID / Ignition / State / Status / Age")
            candidate_rows = [[name] for name in candidates] or [["Ninguna"]]
            _print_table(["columna"], candidate_rows)
            markdown.extend(["## Columnas candidatas", "", _markdown_table(["Columna"], candidate_rows), ""])

            useful_recent_columns = [
                name for name in [
                    "Time_Stamp", "ID", "Lamp_ID", "LampID",
                    "AGEL1", "AGEL2", "UVT", "Power", "Flow", "Dosis",
                    "Ignition", "IgnitionL1", "IgnitionL2",
                    "Lamp_StateL1", "Lamp_StateL2", "State",
                    "StatusL1", "StatusL2", "Status",
                ] if name in columns
            ]
            # Añadir cualquier candidato no cubierto, manteniendo orden y evitando una tabla excesivamente ancha.
            for name in candidates:
                if name not in useful_recent_columns:
                    useful_recent_columns.append(name)
            if "Time_Stamp" not in useful_recent_columns and "Time_Stamp" in columns:
                useful_recent_columns.insert(0, "Time_Stamp")
            if not useful_recent_columns:
                useful_recent_columns = columns[:12]

            recent = _recent_rows(session, useful_recent_columns, limit)
            print(f"\n6) Últimas {limit} lecturas (columnas relevantes)")
            recent_rows = [[row.get(column) for column in useful_recent_columns] for row in recent]
            _print_table(useful_recent_columns, recent_rows)
            markdown.extend([f"## Últimas {limit} lecturas", "", _markdown_table(useful_recent_columns, recent_rows), ""])

            distinct_columns = [name for name in candidates if name != "Time_Stamp"]
            for fixed in ["Lamp_StateL1", "Lamp_StateL2", "StatusL1", "StatusL2", "AGEL1", "AGEL2"]:
                if fixed in columns and fixed not in distinct_columns:
                    distinct_columns.append(fixed)

            print("\n7) Valores distintos de campos individuales/candidatos")
            markdown.extend(["## Valores distintos por campo", ""])
            for column in distinct_columns:
                values = _distinct_values(session, column)
                rows = [[row.get("value"), row.get("occurrences"), row.get("first_seen"), row.get("last_seen")] for row in values]
                print(f"\n[{column}]")
                _print_table(["valor", "ocurrencias", "primero", "último"], rows or [[None, 0, None, None]])
                markdown.extend([f"### {column}", "", _markdown_table(["Valor", "Ocurrencias", "Primero", "Último"], rows or [[None, 0, None, None]]), ""])

    except SQLAlchemyError as exc:
        print(f"ERROR SQL: {type(exc).__name__}: {exc}")
        return 1

    exports_dir = Path(__file__).resolve().parents[2] / "exports"
    exports_dir.mkdir(parents=True, exist_ok=True)
    output = exports_dir / f"auditoria_lamparas_uv_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
    output.write_text("\n".join(markdown), encoding="utf-8")

    print(f"\nReporte Markdown generado: {output}")
    print("Auditoria terminada. Envíame ese Markdown para cerrar ID / Ignition / State / Status antes del 10O.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
