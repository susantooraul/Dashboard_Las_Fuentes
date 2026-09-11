const BASE_GROUPS = [
  {
    key: 'linea1',
    title: 'Línea 1',
    summary: 'Cargas conectadas a producción de Línea 1',
    tone: 'tone-1',
    circuits: [
      { transformer: 'Transf 1', transformerKey: 'transformador1', code: 'Ct01', name: 'Transp L1', amps: '250A', description: 'Transportadores principales Línea 1' },
      { transformer: 'Transf 2', transformerKey: 'transformador2', code: 'Ct03', name: 'Lavadora #1 L1', amps: '250A', description: 'Lavadora principal de envase retornable' },
      { transformer: 'Transf 2', transformerKey: 'transformador2', code: 'Ct10', name: 'CCM L1 32 Motores', amps: '600A', description: 'Centro de control de motores Línea 1' },
      { transformer: 'Transf 4', transformerKey: 'transformador4', code: 'Ct09', name: 'Paletizador L1', amps: '225A', description: 'Paletizado y salida de producto terminado' },
    ],
  },
  {
    key: 'linea2',
    title: 'Línea 2',
    summary: 'Distribución de cargas de Línea 2',
    tone: 'tone-2',
    circuits: [
      { transformer: 'Transf 4', transformerKey: 'transformador4', code: 'Ct07', name: 'CCM L2 Tab 3', amps: '200A', description: 'Motores de transporte y enjuague Línea 2' },
      { transformer: 'Transf 2', transformerKey: 'transformador2', code: 'Ct13', name: 'Lavadora de Botellas #2', amps: '250A', description: 'Lavadora secundaria de envase' },
      { transformer: 'Transf 3', transformerKey: 'transformador3', code: 'Ct04', name: 'Extractor de Etiquetas', amps: '250A', description: 'Remoción de etiquetas en proceso' },
      { transformer: 'Transf 4', transformerKey: 'transformador4', code: 'Ct06', name: 'CCM L2 Tab 3 Aux', amps: '125A', description: 'Motores auxiliares Línea 2' },
    ],
  },
  {
    key: 'linea3',
    title: 'Línea 3',
    summary: 'Circuitos dedicados a Línea 3 y embalaje',
    tone: 'tone-3',
    circuits: [
      { transformer: 'Transf 4', transformerKey: 'transformador4', code: 'Ct08', name: 'Sala Osmosis', amps: '600A', description: 'Bombas y sistema de osmosis' },
      { transformer: 'Transf 4', transformerKey: 'transformador4', code: 'Ct03', name: 'Tab Control de Embalaje L3/L4', amps: '600A', description: 'Tablero de control de embalaje' },
    ],
  },
  {
    key: 'jarabes',
    title: 'Sala de Jarabes',
    summary: 'Preparación y laboratorios',
    tone: 'tone-4',
    circuits: [
      { transformer: 'Transf 2', transformerKey: 'transformador2', code: 'Ct09', name: 'Preparación de Jarabes', amps: '600A', description: 'Mezclado y preparación de jarabe base' },
      { transformer: 'Transf 2', transformerKey: 'transformador2', code: 'Ct12', name: 'CCM Laboratorios', amps: '250A', description: 'Laboratorios y equipos de control de calidad' },
    ],
  },
  {
    key: 'auxiliares',
    title: 'Eq Auxiliares',
    summary: 'Servicios y equipos auxiliares de planta',
    tone: 'tone-1',
    circuits: [
      { transformer: 'Transf 1', transformerKey: 'transformador1', code: 'Ct13', name: 'Extractores', amps: '100A', description: 'Extractores generales de nave' },
      { transformer: 'Transf 1', transformerKey: 'transformador1', code: 'Ct06', name: 'Bomba Vs Incendio', amps: '630A', description: 'Sistema principal contra incendio' },
      { transformer: 'Transf 2', transformerKey: 'transformador2', code: 'Ct01', name: 'Interruptor a Interlock', amps: '200A', description: 'Protecciones e interlocks' },
      { transformer: 'Transf 2', transformerKey: 'transformador2', code: 'Ct04', name: 'Aire Lavado L1 y L2', amps: '300A', description: 'Sistema de aire lavado de líneas 1 y 2' },
      { transformer: 'Transf 2', transformerKey: 'transformador2', code: 'Ct06', name: 'CCM Equipos Auxiliares (Calderas)', amps: '400A', description: 'Centro de control de motores de calderas' },
      { transformer: 'Transf 2', transformerKey: 'transformador2', code: 'Ct07', name: 'Planta Emergencia, 2 Ctos', amps: '600A', description: 'Alimentación planta de emergencia' },
      { transformer: 'Transf 2', transformerKey: 'transformador2', code: 'Ct10', name: 'Torre de Enfriamiento #3', amps: '300A', description: 'Torre de enfriamiento principal' },
      { transformer: 'Transf 2', transformerKey: 'transformador2', code: 'Ct02', name: 'CO2', amps: '200A', description: 'Sistema de CO2 industrial' },
      { transformer: 'Transf 3', transformerKey: 'transformador3', code: 'Ct02', name: 'Tanque CO2', amps: '300A', description: 'Tanque y bombeo de CO2' },
    ],
  },
  {
    key: 'refrigeracion',
    title: 'Refrigeración',
    summary: 'Compresores NH3 y condensadores',
    tone: 'tone-2',
    circuits: [
      { transformer: 'Transf 1', transformerKey: 'transformador1', code: 'Ct03', name: 'Comp. NH3 - 4', amps: '400A', description: 'Compresor principal de amoniaco 4' },
      { transformer: 'Transf 1', transformerKey: 'transformador1', code: 'Ct04', name: 'Comp. NH3 - 5', amps: '400A', description: 'Compresor principal de amoniaco 5' },
      { transformer: 'Transf 1', transformerKey: 'transformador1', code: 'Ct05', name: 'Comp. NH3 - 8 (Doble)', amps: '600A', description: 'Compresor doble de amoniaco 8' },
      { transformer: 'Transf 1', transformerKey: 'transformador1', code: 'Ct07', name: 'Comp. NH3 - 7 (Doble)', amps: '600A', description: 'Compresor doble de amoniaco 7' },
      { transformer: 'Transf 1', transformerKey: 'transformador1', code: 'Ct09', name: 'Comp. NH3 - 3', amps: '300A', description: 'Compresor de amoniaco 3' },
      { transformer: 'Transf 1', transformerKey: 'transformador1', code: 'Ct12', name: 'Control NH3 - 7/8', amps: '300A', description: 'Controles de compresores 7/8' },
      { transformer: 'Transf 2', transformerKey: 'transformador2', code: 'Ct14', name: 'Control de Compresores', amps: '200A', description: 'Control general de compresores' },
      { transformer: 'Transf 3', transformerKey: 'transformador3', code: 'Ct04', name: 'NH3 - 2', amps: '630A', description: 'Compresor NH3-2' },
      { transformer: 'Transf 3', transformerKey: 'transformador3', code: 'Ct05', name: 'NH3 - 4', amps: '400A', description: 'Compresor NH3-4 respaldo' },
      { transformer: 'Transf 4', transformerKey: 'transformador4', code: 'Ct01', name: 'Comp. NH3 - 5 (Doble)', amps: '400A', description: 'Compresor doble de amoniaco 5' },
      { transformer: 'Transf 4', transformerKey: 'transformador4', code: 'Ct05', name: 'Condensador #3', amps: '300A', description: 'Condensador principal 3' },
      { transformer: 'Transf 4', transformerKey: 'transformador4', code: 'Ct09', name: 'Condensador #2', amps: '300A', description: 'Condensador principal 2' },
      { transformer: 'Transf 4', transformerKey: 'transformador4', code: 'Ct13', name: 'Comp. NH3 - 1', amps: '300A', description: 'Compresor NH3-1' },
      { transformer: 'Transf 4', transformerKey: 'transformador4', code: 'Ct15', name: 'Comp. NH3 - 6 (Doble)', amps: '600A', description: 'Compresor doble NH3-6' },
    ],
  },
  {
    key: 'pozos',
    title: 'Pozos',
    summary: 'Pozos y bombeo principal',
    tone: 'tone-3',
    circuits: [
      { transformer: 'Transf 1', transformerKey: 'transformador1', code: 'Ct10', name: 'Pozo #1', amps: '400A', description: 'Bomba principal de pozo 1' },
      { transformer: 'Transf 5', transformerKey: 'transformador5', code: 'Ct04', name: 'Pozo #2', amps: '400A', description: 'Bomba principal de pozo 2' },
      { transformer: 'Transf 1', transformerKey: 'transformador1', code: 'Ct08', name: 'Pozo #3', amps: '400A', description: 'Bomba principal de pozo 3' },
    ],
  },
  {
    key: 'alumbrado',
    title: 'Alumbrado',
    summary: 'Circuito de alumbrado de planta',
    tone: 'tone-1',
    circuits: [
      { transformer: 'Transf 4', transformerKey: 'transformador4', code: 'Ct02', name: 'ML 2 Alumbrado (Doble)', amps: '600A', description: 'Alumbrado general de planta y exteriores' },
    ],
  },
  {
    key: 'transporte',
    title: 'Transporte',
    summary: 'Taller y estación de gasolina',
    tone: 'tone-2',
    circuits: [
      { transformer: 'Transf 4', transformerKey: 'transformador4', code: 'Ct08', name: 'Taller Transporte', amps: '400A', description: 'Taller de mantenimiento de transporte' },
      { transformer: 'Transf 4', transformerKey: 'transformador4', code: 'Ct04', name: 'Estación de Gasolina', amps: '300A', description: 'Suministro de estación de gasolina' },
    ],
  },
  {
    key: 'tag',
    title: 'TAG',
    summary: 'Tratamiento de agua y bombas',
    tone: 'tone-3',
    circuits: [
      { transformer: 'Transf 1', transformerKey: 'transformador1', code: 'Ct02', name: 'Bombas Hidro-Const', amps: '300A', description: 'Bombas hidro-neumáticas de proceso' },
      { transformer: 'Transf 2', transformerKey: 'transformador2', code: 'Ct05', name: 'CCM Tratamiento de Aguas', amps: '300A', description: 'Centro de control tratamiento de aguas' },
      { transformer: 'Transf 3', transformerKey: 'transformador3', code: 'Ct01', name: 'Bombas Mejoradas', amps: '300A', description: 'Bombas mejoradas de proceso' },
      { transformer: 'Transf 4', transformerKey: 'transformador4', code: 'Ct14', name: 'Filtro Carbon (Doble)', amps: '600A', description: 'Filtro principal de carbón activado' },
      { transformer: 'Transf 3', transformerKey: 'transformador3', code: 'Ct06', name: 'Lámpara UV', amps: '300A', description: 'Sistema de desinfección UV' },
    ],
  },
  {
    key: 'ptar',
    title: 'PTAR',
    summary: 'Planta de tratamiento y servicios relacionados',
    tone: 'tone-4',
    circuits: [
      { transformer: 'Transf 5', transformerKey: 'transformador5', code: 'Ct05-1', name: 'CCM Tratamiento de Aguas', amps: '500A', description: 'Centro de control de la PTAR' },
      { transformer: 'Transf 5', transformerKey: 'transformador5', code: 'Ct05-2', name: 'Planta Tratamiento de Aguas', amps: '200A', description: 'Planta de tratamiento de aguas' },
      { transformer: 'Transf 5', transformerKey: 'transformador5', code: 'Ct05-3', name: 'Refrigeración', amps: '200A', description: 'Servicios de refrigeración PTAR' },
      { transformer: 'Transf 5', transformerKey: 'transformador5', code: 'Ct05-5', name: 'Compresor de Aire', amps: '200A', description: 'Compresor de aire PTAR' },
      { transformer: 'Transf 5', transformerKey: 'transformador5', code: 'Ct05-6', name: 'Cto Interno', amps: '300A', description: 'Circuito interno de servicios' },
    ],
  },
];

function deterministicSeed(value) {
  return Array.from(value).reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0);
}

function enrichCircuit(item, groupIndex, circuitIndex) {
  const seed = deterministicSeed(`${item.code}-${item.name}-${item.transformerKey}`);
  const kw = Math.round((42 + groupIndex * 7 + circuitIndex * 9 + (seed % 23)) * 10) / 10;
  const kwh = Math.round((kw * (8.2 + (seed % 4) * 0.6)) * 10) / 10;
  const capacityKw = Math.round((kw * (1.22 + ((seed % 5) * 0.08))) * 10) / 10;
  const startHour = 5 + (seed % 5);
  const startMinute = (seed % 2) * 30;
  const stopHour = 17 + (seed % 4);
  const stopMinute = ((seed + 1) % 2) * 30;
  const scheduleLabel = `${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')} - ${String(stopHour).padStart(2, '0')}:${String(stopMinute).padStart(2, '0')}`;
  return {
    ...item,
    kw,
    kwh,
    capacityKw,
    utilizationPct: Math.min(98, Math.round((kw / capacityKw) * 100)),
    startTime: `${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}`,
    stopTime: `${String(stopHour).padStart(2, '0')}:${String(stopMinute).padStart(2, '0')}`,
    scheduleLabel,
  };
}

const PLANT_GROUPS = BASE_GROUPS.map((group, groupIndex) => ({
  ...group,
  circuits: group.circuits.map((item, circuitIndex) => enrichCircuit(item, groupIndex, circuitIndex)),
}));

const SECTION_ALIASES = {
  dashboard: ['linea1', 'linea2', 'linea3', 'pozos', 'refrigeracion', 'jarabes', 'auxiliares', 'alumbrado', 'transporte', 'tag', 'ptar'],
  subestacion: ['linea1', 'linea2', 'linea3', 'refrigeracion', 'ptar'],
  linea1: ['linea1'],
  linea2: ['linea2'],
  linea3: ['linea3'],
  alumbrado: ['alumbrado'],
  auxiliares: ['auxiliares'],
  transporte: ['transporte'],
  tag: ['tag'],
  ptar: ['ptar'],
  refrigeracion: ['refrigeracion'],
  pozos: ['pozos'],
  jarabes: ['jarabes'],
};

export function getCircuitGroupsForSection(section) {
  const keys = SECTION_ALIASES[section] ?? [];
  return PLANT_GROUPS.filter((group) => keys.includes(group.key));
}

export function getCircuitsForTransformer(transformerKey) {
  return PLANT_GROUPS
    .map((group) => ({ ...group, circuits: group.circuits.filter((item) => item.transformerKey === transformerKey) }))
    .filter((group) => group.circuits.length > 0);
}


export function getLineGroups() {
  return PLANT_GROUPS.filter((group) => ['linea1', 'linea2', 'linea3'].includes(group.key));
}
