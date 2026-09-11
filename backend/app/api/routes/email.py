from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.demo.catalog import DEFAULT_PLANT_ID
from app.schemas.export import EmailReportRequest
from app.services.dashboard_service import get_dashboard_payload
from app.services.email_service import send_email_with_attachment
from app.services.export_service import export_excel, export_html, export_pdf, export_png

router = APIRouter(prefix='/email', tags=['email'])


@router.post('/report')
def send_report(request: EmailReportRequest, db: Session = Depends(get_db)):
    plant_id = request.plant_id or DEFAULT_PLANT_ID
    payload = get_dashboard_payload(db, plant_id, request.section)
    exporter = {
        'excel': export_excel,
        'pdf': export_pdf,
        'html': export_html,
        'png': export_png,
        'jpg': export_png,
    }.get(request.format, export_pdf)
    attachment = exporter(payload)
    status = send_email_with_attachment(request.to, request.subject, request.message, attachment)
    return {'message': status, 'attachment': attachment.name}
