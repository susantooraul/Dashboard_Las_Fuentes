const statusCycle = ['normal', 'atencion', 'critico'];

const PLANT_CATALOG = [
  { cc: '2001', name: 'Guadalupe' },
  { cc: '2002', name: 'Insurgentes' },
  { cc: '2203', name: 'Saltillo' },
  { cc: '2101', name: 'Matamoros' },
  { cc: '2207', name: 'Piedras Negras' },
  { cc: '2301', name: 'Cd. Juárez' },
  { cc: '2308', name: 'Chihuahua' },
  { cc: '2931', name: 'Durango' },
  { cc: '2216', name: 'Torreon' },
  { cc: '2901', name: 'Aguascalientes' },
  { cc: '2907', name: 'Las Trojes' },
  { cc: '2801', name: 'Las Fuentes' },
  { cc: '2816', name: 'Zapopan' },
  { cc: '2916', name: 'San Luis' },
  { cc: '2501', name: 'Culiacán' },
  { cc: '2401', name: 'Hermosillo' },
  { cc: '2506', name: 'La Paz' },
  { cc: '2407', name: 'Mexicali' },
];

function buildHistory(index, baseLoad) {
  return Array.from({ length: 12 }, (_, hourIndex) => {
    const variation = Math.sin((hourIndex + 1) * 0.55 + index) * 14;
    const trend = ((hourIndex % 4) - 1.5) * 3;
    const value = Math.max(36, Math.round(baseLoad + variation + trend));
    return {
      label: `${String(hourIndex * 2).padStart(2, '0')}:00`,
      consumo: value,
    };
  });
}

function getStatusMeta(status) {
  if (status === 'critico') {
    return {
      statusLabel: 'Crítico',
      indicatorClass: 'critical',
      trendLabel: 'Carga alta',
      delta: '+8.4%',
    };
  }

  if (status === 'atencion') {
    return {
      statusLabel: 'Atención',
      indicatorClass: 'warning',
      trendLabel: 'Variación media',
      delta: '+3.2%',
    };
  }

  return {
    statusLabel: 'Normal',
    indicatorClass: 'normal',
    trendLabel: 'Operación estable',
    delta: '-1.1%',
  };
}

export function getMultiPlantMock() {
  return PLANT_CATALOG.map((plant, index) => {
    const status = statusCycle[index % statusCycle.length];
    const baseLoad = 72 + index * 6;
    const history = buildHistory(index, baseLoad);
    const currentLoad = history[history.length - 1]?.consumo ?? baseLoad;
    const peakLoad = Math.max(...history.map((point) => point.consumo));
    const averageLoad = Math.round(history.reduce((sum, point) => sum + point.consumo, 0) / history.length);
    const capacityTotal = peakLoad + 36 + (index % 4) * 10;
    const utilizationPct = Math.min(98, Math.round((currentLoad / capacityTotal) * 100));

    return {
      id: `planta-${plant.cc}`,
      cc: plant.cc,
      name: plant.name,
      currentLoad,
      peakLoad,
      averageLoad,
      capacityTotal,
      utilizationPct,
      availableCapacity: Math.max(0, capacityTotal - currentLoad),
      history,
      ...getStatusMeta(status),
    };
  });
}
