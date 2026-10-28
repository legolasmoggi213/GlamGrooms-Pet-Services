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

  const formatPdfMoney = (value) => `PHP ${Number(value || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  window.exportRevenueSalesPdf = (data) => {
    if (!window.jspdf?.jsPDF) throw new Error('PDF export is unavailable.');

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('l', 'mm', 'a4');
    const period = data.period || 'monthly';
    const periodNames = {
      daily: 'Daily - last 7 days',
      weekly: 'Weekly - last 8 weeks',
      monthly: 'Monthly - last 6 months',
      yearly: 'Yearly - last 5 years',
    };
    const subtitle = `${periodNames[period] || period} - Generated ${new Date().toLocaleString()}`;
    const margin = 12;
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    let y = 34;

    const drawReportHeading = () => {
      pdf.setFillColor(32, 45, 50);
      pdf.rect(0, 0, pageWidth, 28, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(17);
      pdf.text('Revenue & Sales Report', margin, 12);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(238, 234, 220);
      pdf.text(subtitle, margin, 20);
      pdf.setTextColor(37, 50, 56);
    };

    const addReportPage = () => {
      pdf.addPage();
      drawReportHeading();
      y = 34;
    };

    const drawTable = ({ title, description, headers, widths, rows, total }) => {
      const fontSize = 8;
      const drawSectionHeading = () => {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(10);
        pdf.setTextColor(25, 30, 50);
        pdf.text(title, margin, y);
        y += 5;
        if (description) {
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(7.5);
          pdf.setTextColor(102, 115, 122);
          pdf.text(description, margin, y);
          y += 5;
        }
      };
      const drawTableHeader = () => {
        let x = margin;
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(fontSize);
        pdf.setFillColor(32, 45, 50);
        pdf.setDrawColor(207, 211, 205);
        headers.forEach((header, index) => {
          pdf.rect(x, y, widths[index], 9, 'FD');
          pdf.setTextColor(255, 255, 255);
          pdf.text(String(header), x + 2, y + 5.8, { maxWidth: widths[index] - 4 });
          x += widths[index];
        });
        y += 9;
      };
      const drawRow = (row, isTotal, rowIndex) => {
        const cellLines = row.map((value, index) => pdf.splitTextToSize(
          String(value == null || value === '' ? '-' : value),
          widths[index] - 4,
        ));
        const rowHeight = Math.max(8, ...cellLines.map((lines) => lines.length * (fontSize * 0.42) + 4));
        if (y + rowHeight > pageHeight - 14) {
          addReportPage();
          drawSectionHeading();
          drawTableHeader();
        }
        let x = margin;
        pdf.setDrawColor(220, 223, 218);
        pdf.setFont('helvetica', isTotal ? 'bold' : 'normal');
        pdf.setFontSize(fontSize);
        row.forEach((_, index) => {
          if (isTotal) pdf.setFillColor(234, 232, 220);
          else if (rowIndex % 2 === 0) pdf.setFillColor(250, 249, 245);
          if (isTotal || rowIndex % 2 === 0) pdf.rect(x, y, widths[index], rowHeight, 'F');
          pdf.rect(x, y, widths[index], rowHeight, 'S');
          pdf.setTextColor(37, 50, 56);
          pdf.text(cellLines[index], x + 2, y + 4.8, { lineHeightFactor: 1.15 });
          x += widths[index];
        });
        y += rowHeight;
      };

      if (y + 22 > pageHeight - 14) addReportPage();
      drawSectionHeading();
      drawTableHeader();
      rows.forEach((row, index) => drawRow(row, false, index));
      if (total) drawRow(total, true, rows.length);
      y += 6;
    };

    drawReportHeading();
    const grooming = data.grooming || [];
    const hotel = data.hotel || [];
    const groomingRevenue = grooming.reduce((sum, bucket) => sum + Number(bucket.revenue || 0), 0);
    const hotelRevenue = hotel.reduce((sum, bucket) => sum + Number(bucket.revenue || 0), 0);
    const groomingCount = grooming.reduce((sum, bucket) => sum + Number(bucket.count || 0), 0);
    const hotelCount = hotel.reduce((sum, bucket) => sum + Number(bucket.count || 0), 0);

    drawTable({
      title: 'Revenue by period',
      headers: ['Period', 'Grooming Bookings', 'Grooming Revenue', 'Hotel Bookings', 'Hotel Revenue', 'Combined Revenue'],
      widths: [36, 36, 47, 34, 47, 73],
      rows: grooming.map((bucket, index) => {
        const hotelBucket = hotel[index] || {};
        return [
          bucket.label,
          String(Number(bucket.count || 0)),
          formatPdfMoney(bucket.revenue),
          String(Number(hotelBucket.count || 0)),
          formatPdfMoney(hotelBucket.revenue),
          formatPdfMoney(Number(bucket.revenue || 0) + Number(hotelBucket.revenue || 0)),
        ];
      }),
      total: [
        'Total',
        String(groomingCount),
        formatPdfMoney(groomingRevenue),
        String(hotelCount),
        formatPdfMoney(hotelRevenue),
        formatPdfMoney(groomingRevenue + hotelRevenue),
      ],
    });

    const serviceTables = [
      { title: 'Grooming service sales', entries: data.groomingServices || [], totalRevenue: groomingRevenue },
      { title: 'Hotel room sales', entries: data.hotelServices || [], totalRevenue: hotelRevenue },
    ];
    serviceTables.forEach(({ title, entries, totalRevenue }) => {
      const count = entries.reduce((sum, entry) => sum + Number(entry.count || 0), 0);
      const revenue = entries.reduce((sum, entry) => sum + Number(entry.revenue || 0), 0);
      drawTable({
        title,
        description: 'Includes service-level totals and counts for the selected reporting period.',
        headers: ['Service', 'Qty', 'Revenue', 'Share'],
        widths: [115, 42, 55, 61],
        rows: entries
          .filter((entry) => Number(entry.count || 0) || Number(entry.revenue || 0))
          .map((entry) => [
            entry.label || 'Other',
            String(Number(entry.count || 0)),
            formatPdfMoney(entry.revenue),
            totalRevenue > 0 ? `${((Number(entry.revenue || 0) / totalRevenue) * 100).toFixed(1)}%` : '0.0%',
          ]),
        total: ['Total', String(count), formatPdfMoney(revenue), totalRevenue > 0 ? '100.0%' : '0.0%'],
      });
    });

    if (y + 38 > pageHeight - 14) addReportPage();
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(25, 30, 50);
    pdf.text('Summary of totals', margin, y);
    y += 9;
    const summary = [
      ['Grooming revenue', formatPdfMoney(groomingRevenue), [250, 247, 238]],
      ['Hotel revenue', formatPdfMoney(hotelRevenue), [237, 246, 244]],
      ['Combined revenue', formatPdfMoney(groomingRevenue + hotelRevenue), [234, 232, 220]],
    ];
    const gap = 3;
    const cardWidth = (pageWidth - margin * 2 - gap * 2) / 3;
    summary.forEach(([label, amount, color], index) => {
      const x = margin + index * (cardWidth + gap);
      pdf.setFillColor(...color);
      pdf.setDrawColor(220, 223, 218);
      pdf.rect(x, y, cardWidth, 21, 'FD');
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.5);
      pdf.setTextColor(102, 115, 122);
      pdf.text(label, x + 4, y + 7);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      pdf.setTextColor(25, 30, 50);
      pdf.text(amount, x + 4, y + 16);
    });

    const totalPages = pdf.getNumberOfPages();
    for (let page = 1; page <= totalPages; page += 1) {
      pdf.setPage(page);
      pdf.setDrawColor(220, 223, 218);
      pdf.line(margin, pageHeight - 9, pageWidth - margin, pageHeight - 9);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7);
      pdf.setTextColor(102, 115, 122);
      pdf.text(`Glam Grooms Pet Spa & Hotel - Page ${page} of ${totalPages}`, margin, pageHeight - 5);
    }
    pdf.save(`revenue-sales-report-${period}.pdf`);
  };
})();