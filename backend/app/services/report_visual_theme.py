"""Shared ARCA export presentation. Never changes cell values or report datasets."""
from html import escape

NAVY = '163344'
BLUE = '096D94'
PALE = 'F2F8FC'
BORDER = 'CFDEE6'
MUTED = '526B7A'
WHITE = 'FFFFFF'

REPORT_HTML_CSS = '''
*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#163344;background:#fff;margin:0;padding:32px;line-height:1.5;max-width:1280px;margin-inline:auto}
.brand{font-size:12px;font-weight:700;color:#096d94;letter-spacing:.04em;text-align:left}
h1{font-size:28px;line-height:1.2;text-align:left;margin:12px 0}h2{font-size:18px;margin:24px 0 12px;color:#163344}p{font-size:12px;color:#526b7a}
.rule{height:3px;background:#096d94;margin:20px 0}.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:20px 0}.kpi{border:1px solid #cfdee6;border-radius:8px;background:#f2f8fc;padding:16px;min-width:0}.kpi span{display:block;color:#526b7a;font-size:11px;font-weight:600}.kpi strong{display:block;margin-top:8px;font-size:23px;overflow-wrap:anywhere}
section{margin:24px 0;overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:11px}th{background:#163344;color:#fff;font-weight:700;text-align:left}th,td{border:1px solid #cfdee6;padding:9px 10px;vertical-align:top;overflow-wrap:anywhere}tbody tr:nth-child(even){background:#f2f8fc}thead{display:table-header-group}tr{break-inside:avoid}
@media(max-width:700px){body{padding:16px}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}table{min-width:760px}}
@media print{@page{size:A4 landscape;margin:12mm}body{padding:0;max-width:none}section{overflow:visible;break-inside:auto}h2{break-after:avoid}.kpis{break-inside:avoid}table{min-width:0}th{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
'''


def pdf_table(rows, widths=None, font_size=7.5, max_width=None):
    from reportlab.lib import colors
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import Paragraph, Table, TableStyle
    if widths and max_width and sum(widths) > max_width:
        widths = [width * max_width / sum(widths) for width in widths]
    formatted = []
    for index, row in enumerate(rows):
        style = ParagraphStyle('ArcaHeader' if index == 0 else 'ArcaCell',
            fontName='Helvetica-Bold' if index == 0 else 'Helvetica', fontSize=font_size,
            leading=font_size + 2.5, textColor=colors.HexColor('#' + (WHITE if index == 0 else NAVY)))
        formatted.append([Paragraph(cell.text if isinstance(cell, Paragraph) else escape(str(cell if cell is not None else '—')), style) for cell in row])
    table = Table(formatted, colWidths=widths, repeatRows=1, hAlign='LEFT')
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#' + NAVY)),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#' + PALE)]),
        ('LINEBELOW', (0, 0), (-1, 0), 1, colors.HexColor('#' + BLUE)),
        ('LINEBELOW', (0, 1), (-1, -1), .3, colors.HexColor('#' + BORDER)),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 5), ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    return table


def pdf_footer(canvas, doc):
    from reportlab.lib.colors import HexColor
    from reportlab.lib.units import mm
    canvas.saveState()
    canvas.setStrokeColor(HexColor('#' + BORDER))
    canvas.line(doc.leftMargin, 11 * mm, doc.pagesize[0] - doc.rightMargin, 11 * mm)
    canvas.setFillColor(HexColor('#' + MUTED))
    canvas.setFont('Helvetica', 7)
    canvas.drawString(doc.leftMargin, 7 * mm, 'Dashboard ARCA | Planta Las Fuentes')
    canvas.drawRightString(doc.pagesize[0] - doc.rightMargin, 7 * mm, f'Página {doc.page}')
    canvas.restoreState()


def excel_sheet_setup(sheet, header_row=1):
    sheet.sheet_view.showGridLines = False
    sheet.freeze_panes = f'A{header_row + 1}'
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.sheet_properties.outlinePr.summaryRight = False
    sheet.sheet_properties.tabColor = BLUE
    sheet.page_setup.orientation = 'landscape'
    sheet.page_setup.paperSize = '9'  # A4; also supported by WriteOnlyWorksheet
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.print_title_rows = f'{header_row}:{header_row}'
    sheet.oddFooter.center.text = 'ARCA | Las Fuentes'
    sheet.oddFooter.right.text = 'Página &P de &N'


def style_excel_table(sheet, start_row, end_row, end_col):
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter
    excel_sheet_setup(sheet, start_row)
    line = Side(style='hair', color=BORDER)
    for row in sheet.iter_rows(min_row=start_row, max_row=end_row, max_col=end_col):
        for cell in row:
            head = cell.row == start_row
            cell.font = Font(name='Calibri', size=11, bold=head, color=WHITE if head else NAVY)
            cell.fill = PatternFill('solid', fgColor=NAVY if head else (PALE if (cell.row-start_row)%2 == 0 else WHITE))
            cell.border = Border(bottom=line)
            cell.alignment = Alignment(vertical='top', wrap_text=True, horizontal='right' if not head and isinstance(cell.value, (float, int)) else 'left', indent=1)
            if isinstance(cell.value, float) and cell.number_format == 'General':
                cell.number_format = '#,##0.00'
    # Estimate wrapped height including explicit line breaks; no value/formula changes.
    for row in sheet.iter_rows(min_row=start_row, max_row=end_row, max_col=end_col):
        lines = 1
        for cell in row:
            merged = next((area for area in sheet.merged_cells.ranges if area.start_cell.coordinate == cell.coordinate), None)
            width = (sum(sheet.column_dimensions[get_column_letter(col)].width or 18 for col in range(merged.min_col, merged.max_col + 1))
                     if merged else sheet.column_dimensions[get_column_letter(cell.column)].width or 18)
            segments = str(cell.value or '').splitlines() or ['']
            lines = max(lines, sum(max(1, (len(part) + int(width)-1)//max(1,int(width)-2)) for part in segments))
        sheet.row_dimensions[row[0].row].height = max(30 if row[0].row == start_row else 22, 15*lines + 8)
    sheet.auto_filter.ref = f'A{start_row}:{get_column_letter(end_col)}{max(start_row,end_row)}'


def style_excel_workbook(workbook):
    """Style regular workbooks. Streaming historical exports use setup only."""
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter
    for sheet in workbook.worksheets:
        # Existing filled, bold table headers identify the established layout.
        header_rows = [row[0].row for row in sheet.iter_rows(max_row=min(sheet.max_row, 12))
                       if row[0].font.bold and row[0].fill.patternType == 'solid'
                       and sum(cell.value is not None for cell in row) > 1]
        if header_rows:
            start = header_rows[-1]
            style_excel_table(sheet, start, sheet.max_row, sheet.max_column)
        else:
            excel_sheet_setup(sheet, 1)
            for row in sheet.iter_rows():
                for cell in row:
                    cell.font = Font(name='Calibri', size=11, bold=cell.font.bold, color=NAVY)
                    cell.alignment = Alignment(vertical='top', wrap_text=True)
                sheet.row_dimensions[row[0].row].height = max(24, sheet.row_dimensions[row[0].row].height or 0)
        if sheet['A1'].value and sheet['A1'].coordinate in {r.start_cell.coordinate for r in sheet.merged_cells.ranges}:
            sheet['A1'].font = Font(name='Calibri', size=15, bold=True, color=WHITE)
            sheet['A1'].fill = PatternFill('solid', fgColor=NAVY)
            sheet['A1'].alignment = Alignment(vertical='center', wrap_text=True)
            sheet.row_dimensions[1].height = 34
        # Preserve original data precision, column order and existing widths.
        for col in range(1, sheet.max_column+1):
            key = get_column_letter(col)
            sheet.column_dimensions[key].width = max(14, sheet.column_dimensions[key].width or 14)
