const roundValue = (value, digits = 2) => Math.round((Number(value) + Number.EPSILON) * (10 ** digits)) / (10 ** digits);

const forecastTrend = (values, options = {}) => {
  const points = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  const nonZeroPoints = points.filter((value) => value > 0).length;
  if (points.length < 3 || nonZeroPoints < 2) {
    return {
      available: false,
      sampleCount: points.length,
      summary: 'Insufficient historical data for a reliable forecast.',
    };
  }

  const recentWindow = Math.min(3, points.length);
  const recent = points.slice(-recentWindow);
  const recentAverage = recent.reduce((total, value) => total + value, 0) / recent.length;
  const priorWindow = Math.max(1, points.length - recentWindow);
  const prior = points.slice(0, priorWindow);
  const priorAverage = prior.reduce((total, value) => total + value, 0) / prior.length;
  const changePercent = priorAverage ? ((recentAverage - priorAverage) / priorAverage) * 100 : 0;

  const weights = points.map((_, index) => points.length - index);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const weightedMeanX = points.reduce((sum, _value, index) => sum + index * weights[index], 0) / totalWeight;
  const weightedMeanY = points.reduce((sum, value, index) => sum + value * weights[index], 0) / totalWeight;
  const numerator = points.reduce((sum, value, index) => sum + (index - weightedMeanX) * (value - weightedMeanY) * weights[index], 0);
  const denominator = points.reduce((sum, _value, index) => sum + (index - weightedMeanX) ** 2 * weights[index], 0);
  const slope = denominator ? numerator / denominator : 0;

  const trendInfluence = (changePercent / 100) * 0.6;
  const projected = Math.max(0, recentAverage * (1 + trendInfluence + (slope / Math.max(1, recentAverage)) * 0.15));
  const meanY = points.reduce((sum, value) => sum + value, 0) / points.length;
  const variability = Math.sqrt(points.reduce((sum, value) => sum + (value - meanY) ** 2, 0) / points.length);
  const relativeVolatility = meanY ? (variability / meanY) * 100 : 0;
  const direction = Math.abs(changePercent) < 2 ? 'stable' : changePercent > 0 ? 'up' : 'down';
  const confidence = relativeVolatility < 25 ? 'high' : relativeVolatility < 60 ? 'medium' : 'low';

  const descriptor = options.period || 'period';
  const trendPhrase = direction === 'up' ? 'rising' : direction === 'down' ? 'falling' : 'steady';
  const changeText = `${Math.abs(changePercent).toFixed(1)}%`;

  return {
    available: true,
    sampleCount: points.length,
    average: roundValue(meanY),
    recentAverage: roundValue(recentAverage),
    previousAverage: roundValue(priorAverage),
    predicted: roundValue(projected),
    changePercent: roundValue(changePercent),
    direction,
    confidence,
    variability: roundValue(variability),
    model: 'weighted recent trend',
    summary: `${trendPhrase} ${changeText} versus the prior ${descriptor}. Forecast uses the most recent ${recentWindow} periods and a ${confidence}-confidence weighted trend model.`,
  };
};

module.exports = { forecastTrend };
