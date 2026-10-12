export const PLANT_CAPABILITIES = {
  plantKey: 'las-fuentes',
  modules: {
    dashboard: true,
    wells: true,
    tam: true,
    cistern: true,
    bottling: true,
    lines: false,
    levels: false,
    uv: false,
    hydricDiagram: false,
    dailyReview: true,
    reports: true,
  },
  features: {
    history: true,
    totalizer: true,
    fiveMinuteExport: true,
    shiftView: true,
    reportPdf: true,
    reportExcel: true,
    reportHtml: true,
    emailManual: true,
    emailSchedule: true,
    ownPasswordChange: true,
  },
} as const;

export const WATER_MENU_ITEMS = [
  { key: 'dashboard', label: 'Resumen', iconKey: 'pozos-dashboard', enabled: PLANT_CAPABILITIES.modules.dashboard },
  { key: 'pozos', label: 'Pozos', iconKey: 'pozos-pozos', enabled: PLANT_CAPABILITIES.modules.wells },
  { key: 'tam', label: 'Medidores de TAM', iconKey: 'pozos-flujos', enabled: PLANT_CAPABILITIES.modules.tam },
  { key: 'cisterna', label: 'Medidor de cisterna', iconKey: 'pozos-tanques', enabled: PLANT_CAPABILITIES.modules.cistern },
  { key: 'embotellado', label: 'Medidores de embotellado', iconKey: 'pozos-consumos', enabled: PLANT_CAPABILITIES.modules.bottling },
  { key: 'revision', label: 'Revisión diaria', iconKey: 'pozos-revision', enabled: PLANT_CAPABILITIES.modules.dailyReview },
  { key: 'reportes', label: 'Reportes', iconKey: 'pozos-reportes', enabled: PLANT_CAPABILITIES.modules.reports },
] as const;
