(() => {
  const escapeXml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

  const splitLabel = (label) => {
    const text = String(label || '');
    const daily = text.match(/^([A-Za-z]{3}),\s*(.+)$/);
    if (daily) return [daily[1], daily[2]];
    const weekly = text.split('–');
    if (weekly.length === 2) return [weekly[0], weekly[1]];
    const monthly = text.match(/^([A-Za-z]{3})\s+(\d{4})$/);
    if (monthly) return [monthly[1], monthly[2]];
    return [text, ''];
  };

  const formatPointValue = (value) => {
    if (value >= 10000) return `PHP ${(value / 1000).toFixed(value >= 100000 ? 0 : 1)}k`;
    return `PHP ${Math.round(value).toLocaleString('en-PH')}`;
  };

  const formatExactValue = (value) => `PHP ${Number(value || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  window.renderRevenueLineChart = (buckets = []) => {
    if (!buckets.length) return '<div class="empty">No revenue for this period.</div>';

    const values = buckets.map((bucket) => Number(bucket.revenue) || 0);
    const maximum = Math.max(0, ...values);
    const chartWidth = Math.max(660, buckets.length * 78 + 110);
    const chartHeight = 300;
    const plot = { left: 78, right: chartWidth - 24, top: 28, bottom: 220 };
    const plotWidth = plot.right - plot.left;
    const plotHeight = plot.bottom - plot.top;
    const scaleMaximum = maximum || 1;
    const points = buckets.map((bucket, index) => {
      const value = values[index];
      const x = buckets.length === 1
        ? plot.left + plotWidth / 2
        : plot.left + (index * plotWidth) / (buckets.length - 1);
      const y = plot.bottom - (value / scaleMaximum) * plotHeight;
      return { bucket, value, x, y };
    });
    const grid = Array.from({ length: 5 }, (_, index) => {
      const ratio = index / 4;
      const y = plot.bottom - ratio * plotHeight;
      const value = maximum * ratio;
      const label = formatPointValue(value);
      return `<line class="revenue-line-grid" x1="${plot.left}" y1="${y}" x2="${plot.right}" y2="${y}" />
        <text class="revenue-line-axis-label" x="${plot.left - 10}" y="${y + 3}" text-anchor="end">${escapeXml(label)}</text>`;
    }).join('');
    const line = points.map((point) => `${point.x},${point.y}`).join(' ');
    const dots = points.map(({ bucket, value, x, y }) => {
      const count = Number(bucket.count) || 0;
      const label = splitLabel(bucket.label);
      const valueY = Math.max(16, y - 11);
      const valueLabel = value > 0 ? formatExactValue(value) : '';
      return `<g class="revenue-line-point">
        <title>${escapeXml(`${bucket.label}: ${formatExactValue(value)}, ${count} bookings`)}</title>
        <circle cx="${x}" cy="${y}" r="5" />
        ${valueLabel ? `<text class="revenue-line-value-label" x="${x}" y="${valueY}" text-anchor="middle">${escapeXml(valueLabel)}</text>` : ''}
        <text class="revenue-line-axis-label revenue-line-date-label" x="${x}" y="${plot.bottom + 22}" text-anchor="middle">
          <tspan x="${x}">${escapeXml(label[0])}</tspan>
          ${label[1] ? `<tspan x="${x}" dy="12">${escapeXml(label[1])}</tspan>` : ''}
          <tspan class="revenue-line-count-label" x="${x}" dy="12">${count}</tspan>
        </text>
      </g>`;
    }).join('');

    return `<div class="revenue-line-scroll">
      <svg class="revenue-line-chart" viewBox="0 0 ${chartWidth} ${chartHeight}" style="min-width:${chartWidth}px" role="img" aria-label="Revenue over time">
        <title>Revenue over time</title>
        ${grid}
        <polyline class="revenue-line" points="${line}" />
        ${dots}
      </svg>
    </div>`;
  };
})();