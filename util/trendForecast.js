const forecastTrend = (values) => {
  const points = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  const nonZeroPoints = points.filter((value) => value > 0).length;
  if (points.length < 3 || nonZeroPoints < 2) {
    return { available: false, sampleCount: points.length };
  }

  const meanX = (points.length - 1) / 2;
  const meanY = points.reduce((total, value) => total + value, 0) / points.length;
  const numerator = points.reduce((total, value, index) => total + (index - meanX) * (value - meanY), 0);
  const denominator = points.reduce((total, _value, index) => total + (index - meanX) ** 2, 0);
  const slope = denominator ? numerator / denominator : 0;
  const predicted = Math.max(0, meanY + slope * (points.length - 1 - meanX));
  const changePercent = meanY ? ((predicted - meanY) / meanY) * 100 : 0;

  return {
    available: true,
    sampleCount: points.length,
    average: Math.round(meanY * 100) / 100,
    predicted: Math.round(predicted * 100) / 100,
    changePercent: Math.round(changePercent * 10) / 10,
    direction: Math.abs(changePercent) < 2 ? 'stable' : changePercent > 0 ? 'up' : 'down',
  };
};

module.exports = { forecastTrend };
