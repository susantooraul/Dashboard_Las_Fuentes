const KEY = 'arca_dashboard_alert_settings';

export interface AlertSettings {
  currentMaxA: number;
  voltageMinV: number;
  voltageMaxV: number;
  demandMaxKw: number;
  enablePopup: boolean;
}

export const defaultAlertSettings: AlertSettings = {
  currentMaxA: 520,
  voltageMinV: 472,
  voltageMaxV: 486,
  demandMaxKw: 1200,
  enablePopup: true,
};

export function getAlertSettings(): AlertSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<AlertSettings>;
    return { ...defaultAlertSettings, ...saved };
  } catch {
    return { ...defaultAlertSettings };
  }
}

export function saveAlertSettings(next: Partial<AlertSettings>): AlertSettings {
  const value = { ...defaultAlertSettings, ...next };
  localStorage.setItem(KEY, JSON.stringify(value));
  return value;
}
