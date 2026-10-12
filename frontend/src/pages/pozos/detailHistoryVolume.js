/**
 * Construye el volumen progresivo del rango sin convertir huecos en cero.
 * Los buckets sin volumen validado permanecen como null; los buckets válidos
 * siguientes continúan acumulando únicamente el volumen físicamente conciliado.
 */
export function buildProgressiveVolume(points = []) {
  let accumulated = 0;

  return [...points]
    .sort((left, right) => new Date(left?.bucket_start || 0).getTime() - new Date(right?.bucket_start || 0).getTime())
    .map((point) => {
      const rawVolume = point?.volume_m3;
      const parsedVolume = rawVolume === null || rawVolume === undefined || rawVolume === ''
        ? null
        : Number(rawVolume);
      const intervalVolume = Number.isFinite(parsedVolume) ? parsedVolume : null;

      if (intervalVolume === null) {
        return {
          point,
          intervalVolume: null,
          cumulativeVolume: null,
        };
      }

      accumulated += intervalVolume;
      return {
        point,
        intervalVolume,
        cumulativeVolume: accumulated,
      };
    });
}
