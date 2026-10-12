function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function summarizeDetailHistory(points = []) {
  let weightedFlowSum = 0;
  let flowWeight = 0;
  let volumeSum = 0;
  let hasVolume = false;

  for (const point of points) {
    const flow = numeric(point?.flow_avg_lps);
    const explicitFlowSamples = numeric(point?.flow_samples);
    const samples = numeric(point?.samples);
    const weight = explicitFlowSamples !== null && explicitFlowSamples > 0
      ? explicitFlowSamples
      : samples !== null && samples > 0
        ? samples
        : 0;

    if (flow !== null && weight > 0) {
      weightedFlowSum += flow * weight;
      flowWeight += weight;
    }

    const volume = numeric(point?.volume_m3);
    if (volume !== null) {
      volumeSum += volume;
      hasVolume = true;
    }
  }

  return {
    flowAverageLps: flowWeight > 0 ? weightedFlowSum / flowWeight : null,
    volumeM3: hasVolume ? volumeSum : null,
    flowSamples: flowWeight,
    hasVolume,
  };
}
