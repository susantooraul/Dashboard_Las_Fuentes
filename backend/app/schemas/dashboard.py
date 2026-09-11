from datetime import datetime
from typing import List

from pydantic import BaseModel


class KpiCard(BaseModel):
    label: str
    value: float | str
    unit: str
    trend: str
    accent: str


class HourlyPoint(BaseModel):
    hour: str
    total: float
    l1: float
    l2: float
    l3: float


class DistributionItem(BaseModel):
    name: str
    value: float


class TransformerItem(BaseModel):
    name: str
    kwh: float
    kw: float
    current: float


class TableRow(BaseModel):
    timestamp: datetime
    section: str
    system_name: str
    kw: float
    kwh: float
    kvarh: float
    voltage: float
    current: float
    power_factor: float
    status: str


class DashboardPayload(BaseModel):
    title: str
    subtitle: str
    cards: List[KpiCard]
    hourly_data: List[HourlyPoint]
    systems_data: List[DistributionItem]
    transformer_data: List[TransformerItem]
    table_data: List[TableRow]
    updated_at: datetime
