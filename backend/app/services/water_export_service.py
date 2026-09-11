from __future__ import annotations

from datetime import datetime, timedelta

from app.schemas.dashboard import DashboardPayload, DistributionItem, HourlyPoint, KpiCard, TableRow, TransformerItem

NOW = datetime.utcnow().replace(minute=0, second=0, microsecond=0)

POZOS_KPIS = [
    KpiCard(label='Entrada total de agua', value='1,248', unit='m³/día', trend='Promedio consolidado de ingreso por pozo en las últimas 24 h', accent='red'),
    KpiCard(label='Agua tratada disponible', value='812', unit='m³/día', trend='Producción neta posterior a filtración y tratamiento', accent='crimson'),
    KpiCard(label='Concesiones activas', value='3', unit='vigentes', trend='1.25 Mm³/año autorizados · vigencia 2025–2027', accent='wine'),
    KpiCard(label='Balance entradas / salidas', value='+6.4', unit='%', trend='Margen positivo del día entre agua de entrada y suministro total', accent='brown'),
]

HOURLY_FLOW = [
    {'hour': '00:00', 'entrada': 42, 'tratada': 28, 'suave': 9, 'cruda': 5},
    {'hour': '04:00', 'entrada': 45, 'tratada': 29, 'suave': 10, 'cruda': 6},
    {'hour': '08:00', 'entrada': 56, 'tratada': 36, 'suave': 12, 'cruda': 8},
    {'hour': '12:00', 'entrada': 61, 'tratada': 39, 'suave': 14, 'cruda': 8},
    {'hour': '16:00', 'entrada': 58, 'tratada': 37, 'suave': 13, 'cruda': 8},
    {'hour': '20:00', 'entrada': 50, 'tratada': 31, 'suave': 11, 'cruda': 8},
]

POZOS_BREAKDOWN = [
    {'name': 'Pozo 1', 'value': 418},
    {'name': 'Pozo 2', 'value': 392},
    {'name': 'Pozo 3', 'value': 438},
]

TANQUES = [
    {'name': 'Tanque tratada norte', 'metros': 7.4, 'm3': 318, 'capacidad': 420, 'llenado': 75.7},
    {'name': 'Tanque suave proceso', 'metros': 5.9, 'm3': 214, 'capacidad': 300, 'llenado': 71.3},
    {'name': 'Tanque cruda reserva', 'metros': 6.8, 'm3': 289, 'capacidad': 390, 'llenado': 74.1},
]

MONTHLY_AVERAGES = [
    {'month': 'Ene', 'entrada': 1180, 'tratada': 760, 'cruda': 245, 'suave': 175},
    {'month': 'Feb', 'entrada': 1210, 'tratada': 778, 'cruda': 252, 'suave': 180},
    {'month': 'Mar', 'entrada': 1248, 'tratada': 812, 'cruda': 257, 'suave': 179},
    {'month': 'Abr', 'entrada': 1233, 'tratada': 801, 'cruda': 251, 'suave': 181},
    {'month': 'May', 'entrada': 1261, 'tratada': 823, 'cruda': 259, 'suave': 179},
    {'month': 'Jun', 'entrada': 1276, 'tratada': 838, 'cruda': 261, 'suave': 177},
]

CIP_HOURLY = [
    {'day': 'Lun', 'consumo': 12.4},
    {'day': 'Mar', 'consumo': 13.2},
    {'day': 'Mié', 'consumo': 11.8},
    {'day': 'Jue', 'consumo': 14.1},
    {'day': 'Vie', 'consumo': 13.5},
    {'day': 'Sáb', 'consumo': 10.7},
    {'day': 'Dom', 'consumo': 9.9},
]

CONCESIONES = [
    {'name': 'Concesión pozo norte', 'volumen': '420,000 m³/año', 'vigencia': 'ene 2025 - dic 2027', 'status': 'Activa'},
    {'name': 'Concesión pozo sur', 'volumen': '380,000 m³/año', 'vigencia': 'mar 2025 - feb 2027', 'status': 'Activa'},
    {'name': 'Concesión pozo respaldo', 'volumen': '450,000 m³/año', 'vigencia': 'jul 2025 - jun 2027', 'status': 'Activa'},
]

SECTION_TITLES = {
    'dashboard': ('Pozos · Dashboard base', 'Resumen hidráulico operativo consolidado'),
    'consumos': ('Pozos · Consumos', 'Consumos de agua por tipo y salida de filtros'),
    'tanques': ('Pozos · Tanques', 'Niveles, alturas y capacidad de tanques'),
    'balance': ('Pozos · Entradas vs salidas', 'Balance mensual entre entrada total y agua disponible'),
    'cip': ('Pozos · CIP', 'Consumo horario semanal del sistema CIP'),
    'uv': ('Pozos · Lámparas UV', 'Base operativa preparada para integración UV'),
    'reportes': ('Pozos · Reportes', 'Consolidado exportable del módulo de agua'),
}


def _base_cards(section: str) -> list[KpiCard]:
    if section == 'tanques':
        return [
            KpiCard(label=t['name'], value=str(t['m3']), unit='m³', trend=f"{t['metros']} m · {t['llenado']}% de llenado", accent='crimson' if i % 2 else 'red')
            for i, t in enumerate(TANQUES)
        ]
    if section == 'cip':
        avg = round(sum(item['consumo'] for item in CIP_HOURLY) / len(CIP_HOURLY), 1)
        return [
            KpiCard(label='Promedio CIP', value=str(avg), unit='m³/h', trend='Promedio semanal de consumo CIP', accent='red'),
            KpiCard(label='Pico semanal', value=str(max(item['consumo'] for item in CIP_HOURLY)), unit='m³/h', trend='Consumo máximo detectado', accent='crimson'),
            KpiCard(label='Mínimo semanal', value=str(min(item['consumo'] for item in CIP_HOURLY)), unit='m³/h', trend='Consumo mínimo detectado', accent='wine'),
            KpiCard(label='Eventos medidos', value=str(len(CIP_HOURLY)), unit='días', trend='Ventana actual de seguimiento', accent='brown'),
        ]
    return POZOS_KPIS


def _hourly_points(section: str) -> list[HourlyPoint]:
    if section == 'cip':
        return [HourlyPoint(hour=item['day'], total=item['consumo'], l1=0, l2=0, l3=0) for item in CIP_HOURLY]
    if section == 'balance':
        return [HourlyPoint(hour=item['month'], total=item['entrada'], l1=item['tratada'], l2=item['cruda'], l3=item['suave']) for item in MONTHLY_AVERAGES]
    return [HourlyPoint(hour=item['hour'], total=item['entrada'], l1=item['tratada'], l2=item['suave'], l3=item['cruda']) for item in HOURLY_FLOW]


def _distribution(section: str) -> list[DistributionItem]:
    if section == 'tanques':
        return [DistributionItem(name=item['name'], value=item['m3']) for item in TANQUES]
    if section == 'reportes':
        return [DistributionItem(name=item['name'], value=float(item['volumen'].split(' ')[0].replace(',', ''))) for item in CONCESIONES]
    return [DistributionItem(name=item['name'], value=item['value']) for item in POZOS_BREAKDOWN]


def _transformers_placeholder(section: str) -> list[TransformerItem]:
    if section == 'tanques':
        return [TransformerItem(name=item['name'], kwh=item['m3'], kw=item['llenado'], current=item['metros']) for item in TANQUES]
    if section == 'reportes':
        return [TransformerItem(name=item['name'], kwh=float(item['volumen'].split(' ')[0].replace(',', '')), kw=100, current=1) for item in CONCESIONES]
    return [
        TransformerItem(name='Pozo 1', kwh=418, kw=56, current=18.2),
        TransformerItem(name='Pozo 2', kwh=392, kw=53, current=17.6),
        TransformerItem(name='Pozo 3', kwh=438, kw=61, current=18.9),
    ]


def _table_rows(section: str) -> list[TableRow]:
    rows: list[TableRow] = []
    if section == 'tanques':
        for index, tank in enumerate(TANQUES):
            rows.append(TableRow(
                timestamp=NOW - timedelta(hours=index),
                section='pozos',
                system_name=tank['name'],
                kw=tank['m3'],
                kwh=tank['capacidad'],
                kvarh=tank['llenado'],
                voltage=tank['metros'],
                current=tank['m3'] / 10,
                power_factor=0.99,
                status='NORMAL',
            ))
        return rows

    if section == 'reportes':
        for index, item in enumerate(CONCESIONES):
            rows.append(TableRow(
                timestamp=NOW - timedelta(days=index),
                section='pozos',
                system_name=item['name'],
                kw=0,
                kwh=float(item['volumen'].split(' ')[0].replace(',', '')),
                kvarh=0,
                voltage=0,
                current=0,
                power_factor=1,
                status=item['status'].upper(),
            ))
        return rows

    source = HOURLY_FLOW if section != 'cip' else [{'hour': item['day'], 'entrada': item['consumo'], 'tratada': item['consumo'], 'suave': 0, 'cruda': 0} for item in CIP_HOURLY]
    for index, item in enumerate(source):
        rows.append(TableRow(
            timestamp=NOW - timedelta(hours=index * 4),
            section='pozos',
            system_name=f"Pozo {index % 3 + 1}",
            kw=item['entrada'],
            kwh=item['tratada'],
            kvarh=item['suave'],
            voltage=item['cruda'],
            current=item['entrada'] / 3,
            power_factor=0.98,
            status='NORMAL',
        ))
    return rows


def get_water_dashboard_payload(section: str) -> DashboardPayload:
    title, subtitle = SECTION_TITLES.get(section, SECTION_TITLES['dashboard'])
    return DashboardPayload(
        title=title,
        subtitle=subtitle,
        cards=_base_cards(section),
        hourly_data=_hourly_points(section),
        systems_data=_distribution(section),
        transformer_data=_transformers_placeholder(section),
        table_data=_table_rows(section),
        updated_at=NOW,
    )
