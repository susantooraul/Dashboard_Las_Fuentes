from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.dashboard import KpiCard


class WaterMetricItem(BaseModel):
    name: str
    value: float
    unit: str = ''
    detail: str = ''


class TankLevelItem(BaseModel):
    name: str
    volume_m3: float
    height_m: float
    capacity_m3: float
    fill_pct: float
    status: str


class CipPoint(BaseModel):
    day: str
    hours: float


class BalancePoint(BaseModel):
    label: str
    entrada: float
    salida: float


class MonthlyAveragePoint(BaseModel):
    month: str
    entrada: float = 0
    tratada: float = 0
    cruda: float = 0
    suave: float = 0


class HourlyFlowPoint(BaseModel):
    hour: str
    entrada: float = 0
    tratada: float = 0
    suave: float = 0
    cruda: float = 0


class FilterTreatedPoint(BaseModel):
    day: str
    filtros: float = 0
    tratada: float = 0


class WaterSensorItem(BaseModel):
    model_config = ConfigDict(extra='allow')

    id: str
    name: str
    type: str = 'sensor'
    unit: str = ''
    value: float = 0
    well_id: Optional[str] = None


class WaterWellItem(BaseModel):
    model_config = ConfigDict(extra='allow')

    id: str
    name: str
    entry_m3: float = 0
    supply_hours: float = 0
    active: bool = True
    sensors: List[WaterSensorItem] = Field(default_factory=list)
    well_id: Optional[str] = None
    numero: Optional[int] = None
    nombre: Optional[str] = None
    ubicacion: Optional[str] = None
    status: Optional[str] = None
    statusType: Optional[str] = None
    estado_comunicacion: Optional[str] = None
    communicationType: Optional[str] = None
    kwh: Optional[float] = None
    dailyKwh: Optional[float] = None
    totalizador_m3: Optional[float] = None
    flujo_entrada: Optional[float] = None
    flujo_salida: Optional[float] = None
    flow: Optional[float] = None
    updated: Optional[str] = None
    ultima_lectura: Optional[str] = None


class WaterSourceInfo(BaseModel):
    id: str
    name: str
    description: str = ''
    status: str = 'registered'
    active: bool = False
    created_at: datetime
    updated_at: datetime
    production_lines: List[dict[str, Any]] = Field(default_factory=list)
    tank_inputs: List[dict[str, Any]] = Field(default_factory=list)
    distribution_flows: List[dict[str, Any]] = Field(default_factory=list)
    wells_count: int = 0
    sensors_count: int = 0
    file_name: str = ''


class WaterSourceValidation(BaseModel):
    valid: bool
    errors: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    wells_count: int = 0
    sensors_count: int = 0
    normalized_preview: Optional[dict[str, Any]] = None


class WaterSourceActivateResponse(BaseModel):
    active_source: Optional[WaterSourceInfo] = None
    message: str


class WaterDashboardPayload(BaseModel):
    model_config = ConfigDict(extra='allow')

    title: str
    subtitle: str
    cards: List[KpiCard]
    water_entry_by_well: List[WaterMetricItem]
    water_consumption: List[WaterMetricItem]
    tank_levels: List[TankLevelItem]
    supply_hours: List[WaterMetricItem]
    filters_vs_treated: List[FilterTreatedPoint]
    cip_weekly: List[CipPoint]
    entry_vs_exit: List[BalancePoint]
    monthly_averages: List[MonthlyAveragePoint]
    daily_indicators: List[WaterMetricItem]
    report_modules: List[str]
    hourly_flow: List[HourlyFlowPoint] = Field(default_factory=list)
    wells: List[WaterWellItem] = Field(default_factory=list)
    sensors: List[WaterSensorItem] = Field(default_factory=list)
    source_status: str = 'empty'
    source: Optional[WaterSourceInfo] = None
    updated_at: datetime
    production_lines: List[dict[str, Any]] = Field(default_factory=list)
    tank_inputs: List[dict[str, Any]] = Field(default_factory=list)
    distribution_flows: List[dict[str, Any]] = Field(default_factory=list)
