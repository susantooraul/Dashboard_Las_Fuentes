from pydantic import BaseModel, EmailStr


class EmailReportRequest(BaseModel):
    to: EmailStr
    subject: str = 'Reporte de dashboard eléctrico'
    message: str = 'Se adjunta reporte generado desde el dashboard.'
    plant_id: str | None = 'gdl-demo'
    section: str = 'dashboard'
    format: str = 'pdf'


class DailyWaterReportEmailRequest(BaseModel):
    to: EmailStr
    cc: list[EmailStr] | None = None
    subject: str | None = None
    message: str | None = None
    date: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    formats: list[str] | None = None


class ReportEmailScheduleCreateRequest(BaseModel):
    name: str
    period_mode: str
    formats: list[str]
    recipients: list[EmailStr]
    enabled: bool = True
    send_delay_minutes: int = 10
    send_time_local: str | None = None
    send_time_local_2: str | None = None


class ReportEmailScheduleUpdateRequest(BaseModel):
    name: str | None = None
    period_mode: str | None = None
    formats: list[str] | None = None
    recipients: list[EmailStr] | None = None
    enabled: bool | None = None
    send_delay_minutes: int | None = None
    send_time_local: str | None = None
    send_time_local_2: str | None = None
