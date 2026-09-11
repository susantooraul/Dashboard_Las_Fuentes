from sqlalchemy import Column, DateTime, Float, Integer, String

from app.database import Base


class Measurement(Base):
    __tablename__ = 'measurements'

    id = Column(Integer, primary_key=True, index=True)
    section = Column(String(80), index=True, nullable=False)
    system_name = Column(String(80), index=True, nullable=False)
    timestamp = Column(DateTime, index=True, nullable=False)
    kw = Column(Float, nullable=False)
    kwh = Column(Float, nullable=False)
    kvarh = Column(Float, nullable=False)
    voltage = Column(Float, nullable=False)
    current = Column(Float, nullable=False)
    power_factor = Column(Float, nullable=False)
    cost_mxn = Column(Float, nullable=False)
    status = Column(String(30), default='normal', nullable=False)
