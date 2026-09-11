const KEY = 'arca_dashboard_alert_settings';

export const defaultAlertSettings = {
  currentMaxA: 520,
  voltageMinV: 472,
  voltageMaxV: 486,
  demandMaxKw: 1200,
  enablePopup: true,
};

export function getAlertSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...defaultAlertSettings, ...saved };
  } catch {
    return { ...defaultAlertSettings };
  }
}

export function saveAlertSettings(next) {
  const value = { ...defaultAlertSettings, ...next };
  localStorage.setItem(KEY, JSON.stringify(value));
  return value;
}
