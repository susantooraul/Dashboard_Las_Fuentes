from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.services.export_service import EXCEL_MIME, export_csv, export_excel, export_html, export_pdf, export_png
from app.services.water_export_service import get_water_dashboard_payload

router = APIRouter(prefix='/water', tags=['water-export'])

MEDIA_TYPES = {
    'excel': EXCEL_MIME,
    'csv': 'text/csv',
    'html': 'text/html',
    'pdf': 'application/pdf',
    'png': 'image/png',
    'jpg': 'image/png',
}


@router.get('/export/{section}/{format_name}')
def export_water_section(section: str, format_name: str):
    exporters = {
        'excel': export_excel,
        'csv': export_csv,
        'html': export_html,
        'pdf': export_pdf,
        'png': export_png,
        'jpg': export_png,
    }
    if format_name not in exporters:
        raise HTTPException(status_code=400, detail='Formato no soportado')

    payload = get_water_dashboard_payload(section)
    file_path = exporters[format_name](payload)
    return FileResponse(path=file_path, filename=file_path.name, media_type=MEDIA_TYPES[format_name])
