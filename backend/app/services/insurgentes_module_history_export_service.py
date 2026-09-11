from __future__ import annotations

from io import BytesIO
from datetime import datetime, timedelta
from typing import Any

from app.services.insurgentes_history_service import get_insurgentes_water_history_module


MODULE_LABELS = {
    'well': 'Pozos',
    'line': 'Lineas',
    'flow': 'Flujos',
}
METRIC_LABELS = {
    'flow': 'Flujo',
    'totalizer': 'Totalizador',
    'both': 'Flujo + totalizador',
}
AGGREGATION_LABELS = {
    'minute': '1 minuto',
    'quarter_hour': '15 minutos',
    'hourly': '1 hora',
    'daily': '1 dia',
}


def _number(value: Any) -> float | None:
    if value in (None, ''):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


def _series_identities(series: dict[str, Any]) -> set[str]:
    identities: set[str] = set()
    for value in (series.get('operational_key'), series.get('sensor_id'), series.get('name')):
        if value not in (None, ''):
            identities.add(str(value).strip())
    return identities


def _filter_series(series: list[dict[str, Any]], selected: list[str] | None) -> list[dict[str, Any]]:
    if not selected:
        return series
    allowed = {str(item).strip() for item in selected if str(item).strip()}
    return [item for item in series if _series_identities(item) & allowed]


def _last_value(points: list[dict[str, Any]], *keys: str) -> float | None:
    for point in reversed(points):
        for key in keys:
            value = _number(point.get(key))
            if value is not None:
                return value
    return None


def _summary_rows(series: list[dict[str, Any]], totalizer_display: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for item in series:
        points = list(item.get('points') or [])
        samples = sum(int(point.get('samples') or 0) for point in points)
        coverage = [_number(point.get('coverage_pct')) for point in points]
        coverage_values = [value for value in coverage if value is not None]
        flows = [_number(point.get('flow_avg_lps')) for point in points]
        flow_values = [value for value in flows if value is not None]
        reliable_volumes = [
            _number(point.get('volume_m3'))
            for point in points
            if point.get('volume_reliable') is True
        ]
        volume_values = [value for value in reliable_volumes if value is not None]
        close = _last_value(points, 'effective_totalizer_close_m3', 'totalizer_close_m3')
        totalizer_summary = _totalizer_delta(points) if totalizer_display == 'delta' else close
        rows.append([
            str(item.get('name') or 'Elemento'),
            f'{samples:,}',
            f'{(sum(coverage_values) / len(coverage_values)):.1f} %' if coverage_values else '-',
            f'{(sum(flow_values) / len(flow_values)):.2f}' if flow_values else '-',
            f'{sum(volume_values):.2f}' if volume_values else '-',
            f'{totalizer_summary:.2f}' if totalizer_summary is not None else '-',
            str(item.get('status') or 'Sin datos'),
        ])
    return rows


def _totalizer_value(point: dict[str, Any]) -> float | None:
    value = _number(point.get('effective_totalizer_close_m3'))
    if value is not None:
        return value
    return _number(point.get('totalizer_close_m3'))


def _totalizer_delta(points: list[dict[str, Any]]) -> float | None:
    values = [_totalizer_value(point) for point in points]
    valid = [value for value in values if value is not None]
    if len(valid) < 2:
        return 0.0 if len(valid) == 1 else None
    return valid[-1] - valid[0]


def _chart_image(series: list[dict[str, Any]], metric: str, totalizer_display: str) -> BytesIO | None:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.dates as mdates
    import matplotlib.pyplot as plt

    if not series:
        return None

    fig, axis = plt.subplots(figsize=(10.6, 4.6), dpi=120)
    secondary = axis.twinx() if metric == 'both' else None
    has_values = False
    plotted_timestamps: list[datetime] = []

    for item in series:
        points = list(item.get('points') or [])
        timestamps: list[datetime] = []
        flows: list[float] = []
        totals: list[float] = []
        for point in points:
            raw_ts = point.get('bucket_start')
            try:
                ts = datetime.fromisoformat(str(raw_ts))
            except (TypeError, ValueError):
                continue
            timestamps.append(ts)
            flow = _number(point.get('flow_avg_lps'))
            total = _totalizer_value(point)
            flows.append(float('nan') if flow is None else flow)
            totals.append(float('nan') if total is None else total)

        if not timestamps:
            continue
        plotted_timestamps.extend(timestamps)
        name = str(item.get('name') or 'Elemento')
        if metric in {'flow', 'both'}:
            axis.plot(timestamps, flows, linewidth=1.7, label=f'{name} - Flujo')
            if any(value == value for value in flows):
                has_values = True
        if metric in {'totalizer', 'both'}:
            target = secondary if secondary is not None else axis
            display_totals = totals
            totalizer_label = 'Totalizador'
            if totalizer_display == 'delta':
                base = next((value for value in totals if value == value), None)
                display_totals = [float('nan') if value != value or base is None else value - base for value in totals]
                totalizer_label = 'Variacion totalizador'
            target.plot(
                timestamps,
                display_totals,
                linewidth=1.5,
                linestyle='--' if metric == 'both' else '-',
                label=f'{name} - {totalizer_label}',
            )
            if any(value == value for value in display_totals):
                has_values = True

    if not has_values:
        plt.close(fig)
        return None

    axis.grid(True, alpha=0.22, linestyle='--')
    axis.set_xlabel('Fecha / hora')
    if metric in {'flow', 'both'}:
        axis.set_ylabel('Flujo')
    else:
        axis.set_ylabel('Variacion del totalizador (m3)' if totalizer_display == 'delta' else 'Totalizador (m3)')
    if secondary is not None:
        secondary.set_ylabel('Variacion del totalizador (m3)' if totalizer_display == 'delta' else 'Totalizador (m3)')

    # Matplotlib agrega margen automatico y puede redondear el ultimo tick al
    # inicio del dia siguiente (por ejemplo 11/09 00:00 para un rango 09-10).
    # El historico ya trae exactamente los buckets solicitados, asi que fijamos
    # el eje X al primer y ultimo bucket realmente graficados: lo que ves en la
    # web es lo que debe verse en el PDF, sin aparentar un dia extra.
    if plotted_timestamps:
        first_ts = min(plotted_timestamps)
        last_ts = max(plotted_timestamps)
        if first_ts < last_ts:
            axis.set_xlim(first_ts, last_ts)
        else:
            axis.set_xlim(first_ts - timedelta(minutes=30), last_ts + timedelta(minutes=30))
        axis.margins(x=0)

    axis.xaxis.set_major_formatter(mdates.DateFormatter('%d/%m %H:%M'))
    fig.autofmt_xdate(rotation=30, ha='right')

    handles, labels = axis.get_legend_handles_labels()
    if secondary is not None:
        other_handles, other_labels = secondary.get_legend_handles_labels()
        handles += other_handles
        labels += other_labels
    if handles:
        fig.legend(handles, labels, loc='upper center', bbox_to_anchor=(0.5, 0.995), ncol=min(4, max(1, len(labels))), fontsize=7.5, frameon=False)
    fig.tight_layout(rect=(0, 0, 1, 0.91))

    buffer = BytesIO()
    fig.savefig(buffer, format='png', dpi=120, bbox_inches='tight', facecolor='white')
    plt.close(fig)
    buffer.seek(0)
    return buffer


def export_insurgentes_module_history_pdf(
    *,
    module: str,
    start_date: str,
    end_date: str,
    aggregation: str,
    metric: str = 'flow',
    totalizer_display: str = 'delta',
    selected: list[str] | None = None,
    force_refresh: bool = False,
) -> tuple[bytes, str]:
    normalized_metric = str(metric or 'flow').strip().lower()
    if normalized_metric not in {'flow', 'totalizer', 'both'}:
        raise ValueError('La metrica PDF debe ser flow, totalizer o both.')
    normalized_totalizer_display = str(totalizer_display or 'delta').strip().lower()
    if normalized_totalizer_display not in {'delta', 'absolute'}:
        raise ValueError('El modo de totalizador PDF debe ser delta o absolute.')
    if normalized_metric == 'both':
        normalized_totalizer_display = 'delta'

    payload = get_insurgentes_water_history_module(
        module=module,
        start_date=start_date,
        end_date=end_date,
        aggregation=aggregation,
        force_refresh=force_refresh,
    )
    series = _filter_series(list(payload.get('series') or []), selected)

    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    output = BytesIO()
    doc = SimpleDocTemplate(
        output,
        pagesize=landscape(A4),
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        topMargin=11 * mm,
        bottomMargin=11 * mm,
        title='Historico operativo ARCA Las Fuentes',
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'HistoryTitle',
        parent=styles['Title'],
        fontName='Helvetica-Bold',
        fontSize=17,
        leading=20,
        textColor=colors.HexColor('#0B3555'),
        alignment=TA_LEFT,
        spaceAfter=3 * mm,
    )
    meta_style = ParagraphStyle(
        'HistoryMeta',
        parent=styles['BodyText'],
        fontName='Helvetica',
        fontSize=8.8,
        leading=12,
        textColor=colors.HexColor('#45657C'),
        spaceAfter=2 * mm,
    )

    module_label = MODULE_LABELS.get(str(module), str(module))
    metric_label = METRIC_LABELS.get(normalized_metric, normalized_metric)
    if normalized_metric == 'totalizer':
        metric_label += ' - Variacion del periodo' if normalized_totalizer_display == 'delta' else ' - Valor absoluto'
    elif normalized_metric == 'both':
        metric_label += ' - totalizador como variacion del periodo'
    aggregation_label = AGGREGATION_LABELS.get(str(aggregation), str(aggregation))
    story = [
        Paragraph(f'ARCA Las Fuentes - Historico operativo - {module_label}', title_style),
        Paragraph(
            f'<b>Periodo:</b> {start_date} a {end_date} &nbsp;&nbsp; '
            f'<b>Agrupacion:</b> {aggregation_label} &nbsp;&nbsp; '
            f'<b>Metrica:</b> {metric_label} &nbsp;&nbsp; '
            f'<b>Elementos:</b> {len(series)}',
            meta_style,
        ),
    ]

    chart = _chart_image(series, normalized_metric, normalized_totalizer_display)
    if chart is not None:
        story.append(Image(chart, width=270 * mm, height=112 * mm))
        story.append(Spacer(1, 4 * mm))

    table_totalizer_display = (
        normalized_totalizer_display if normalized_metric in {'totalizer', 'both'} else 'absolute'
    )
    table_data = [[
        'Elemento', 'Muestras', 'Cobertura prom.', 'Flujo prom.',
        'Volumen validado m3',
        ('Variacion totalizador m3' if table_totalizer_display == 'delta' else 'Totalizador cierre m3'),
        'Estado',
    ], *_summary_rows(series, table_totalizer_display)]
    table = Table(table_data, colWidths=[48 * mm, 24 * mm, 31 * mm, 27 * mm, 37 * mm, 39 * mm, 30 * mm], repeatRows=1)
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0B5F8F')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 7.8),
        ('ALIGN', (1, 1), (-2, -1), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 7.6),
        ('TEXTCOLOR', (0, 1), (-1, -1), colors.HexColor('#17334A')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F2F8FC')]),
        ('GRID', (0, 0), (-1, -1), 0.35, colors.HexColor('#B8D7E8')),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(table)
    story.append(Spacer(1, 3 * mm))
    story.append(Paragraph(
        'Los huecos permanecen como ausencia de registro. Cero se conserva como lectura valida. '
        'Los volumenes mostrados en la tabla suman unicamente intervalos marcados como confiables por la conciliacion comun.',
        meta_style,
    ))

    doc.build(story)
    content = output.getvalue()
    safe_module = str(module).replace('/', '-').replace('\\', '-')
    filename = f'las_fuentes_historico_{safe_module}_{start_date}_{end_date}.pdf'
    return content, filename
