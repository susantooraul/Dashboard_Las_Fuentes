import type { FlexibleRecord } from './types';

// Dashboard cards use operational slugs; the history API uses physical sensor IDs.
// Keep both identities so module filtering works with either response contract.
export function historyElementIds(items: FlexibleRecord[]): string[] {
  return [...new Set(items.flatMap((item) => {
    const sensorId = Number(item.sensor_id);
    return [
      item.id == null ? '' : String(item.id),
      item.operational_key == null ? '' : String(item.operational_key),
      Number.isInteger(sensorId) && sensorId > 0 ? String(sensorId) : '',
    ].filter(Boolean);
  }))];
}
