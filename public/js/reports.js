(() => {
  const buttons = [...document.querySelectorAll('[data-report-type]')];
  const paymentFilter = document.getElementById('report-payment-method');
  const message = document.getElementById('report-message');
  const reportWidths = {
    grooming: [24, 32, 27, 47, 37, 24, 24, 30, 28],
    hotel: [24, 30, 25, 32, 31, 31, 20, 24, 28, 28],
    walkin: [24, 30, 23, 50, 24, 25, 25, 25, 20, 27],
  };
  const titles = { grooming: 'Grooming', hotel: 'Hotel', walkin: 'Walk-in' };
  const paymentIndexes = { grooming: 6, hotel: 7, walkin: 4 };
  const amountIndexes = { grooming: 8, hotel: 9, walkin: 6 };

  const setMessage = (text, isError = false) => {
    if (!message) return;
    message.textContent = text;
    message.className = `reports-note${isError ? ' text-error' : ''}`;
  };

  const addPageHeading = (pdf, title, subtitle) => {
    const pageWidth = pdf.internal.pageSize.getWidth();
    pdf.setFillColor(32, 45, 50);
    pdf.rect(0, 0, pageWidth, 28, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(17);
    pdf.text(title, 12, 12);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(238, 234, 220);
    pdf.text(subtitle, 12, 20);
    pdf.setTextColor(37, 50, 56);
    return 34;
  };

  const drawHeaderRow = (pdf, headers, widths, y) => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.setFillColor(235, 232, 223);
    pdf.setDrawColor(207, 211, 205);
    let x = 12;
    headers.forEach((header, index) => {
      pdf.rect(x, y, widths[index], 10, 'FD');
      pdf.setTextColor(37, 50, 56);
      pdf.text(pdf.splitTextToSize(String(header), widths[index] - 4), x + 2, y + 4);
      x += widths[index];
    });
    return y + 10;
  };

  const drawRows = (pdf, report, type, y, subtitle) => {
    const widths = reportWidths[type];
    const pageHeight = pdf.internal.pageSize.getHeight();
    let rows = report.rows;
    if (!rows.length) rows = [['No records for the selected payment method.', ...Array(report.headers.length - 1).fill('')]];

    rows.forEach((row, rowIndex) => {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7);
      const cellLines = row.map((value, index) => {
        const lines = pdf.splitTextToSize(String(value == null || value === '' ? '—' : value), widths[index] - 4);
        if (lines.length > 4) {
          lines.length = 4;
          lines[3] = `${String(lines[3]).slice(0, 3)}...`;
        }
        return lines;
      });
      const rowHeight = Math.max(8, ...cellLines.map((lines) => lines.length * 3.2 + 3));
      if (y + rowHeight > pageHeight - 14) {
        pdf.addPage();
        y = addPageHeading(pdf, report.title, subtitle);
        y = drawHeaderRow(pdf, report.headers, widths, y);
      }

      let x = 12;
      pdf.setDrawColor(220, 223, 218);
      row.forEach((_, index) => {
        if (rowIndex % 2 === 0) {
          pdf.setFillColor(250, 249, 245);
          pdf.rect(x, y, widths[index], rowHeight, 'F');
        }
        pdf.rect(x, y, widths[index], rowHeight, 'S');
        pdf.setTextColor(37, 50, 56);
        pdf.text(cellLines[index], x + 2, y + 4, { lineHeightFactor: 1.1 });
        x += widths[index];
      });
      y += rowHeight;
    });
    return y;
  };

  const addPageNumbers = (pdf) => {
    const totalPages = pdf.getNumberOfPages();
    for (let page = 1; page <= totalPages; page += 1) {
      pdf.setPage(page);
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      pdf.setDrawColor(220, 223, 218);
      pdf.line(12, pageHeight - 9, pageWidth - 12, pageHeight - 9);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7);
      pdf.setTextColor(102, 115, 122);
      pdf.text(`Glam Grooms Pet Spa & Hotel | Page ${page} of ${totalPages}`, 12, pageHeight - 5);
    }
  };

  const downloadReport = async (type, button) => {
    if (!Object.prototype.hasOwnProperty.call(reportWidths, type)) {
      setMessage('That report type is not available.', true);
      return;
    }
    if (!window.jspdf || !window.jspdf.jsPDF) {
      setMessage('PDF export is unavailable. Check your connection, refresh, and try again.', true);
      return;
    }

    const filter = paymentFilter ? paymentFilter.value : 'all';
    const paymentLabel = filter === 'gcash' ? 'GCash only' : filter === 'cash' ? 'Cash only' : 'All payment methods';
    button.disabled = true;
    setMessage(`Preparing the ${titles[type]} PDF...`);
    try {
      const query = new URLSearchParams({ type, paymentMethod: filter });
      const response = await fetch(`/api/v1/admin/reports?${query}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const report = await response.json();
      if (!response.ok) throw new Error(report.error || `Report request failed (${response.status}).`);

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF('l', 'mm', 'a4');
      const subtitle = `${paymentLabel} | Generated ${new Date().toLocaleString()}`;
      let y = addPageHeading(pdf, report.title, subtitle);

      const methodIndex = paymentIndexes[type];
      const amountIndex = amountIndexes[type];
      const totals = { Cash: 0, GCash: 0 };
      const counts = { Cash: 0, GCash: 0 };
      report.rows.forEach((row) => {
        const method = row[methodIndex];
        if (!Object.prototype.hasOwnProperty.call(totals, method)) return;
        totals[method] += Number(row[amountIndex]) || 0;
        counts[method] += 1;
      });
      const totalRecords = counts.Cash + counts.GCash;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      pdf.setTextColor(37, 50, 56);
      pdf.text(
        `Records: ${totalRecords} | Cash: ${counts.Cash} (PHP ${totals.Cash.toFixed(2)}) | GCash: ${counts.GCash} (PHP ${totals.GCash.toFixed(2)})`,
        12,
        y,
      );
      y += 7;
      y = drawHeaderRow(pdf, report.headers, reportWidths[type], y);
      drawRows(pdf, report, type, y, subtitle);
      addPageNumbers(pdf);

      const date = new Date().toISOString().slice(0, 10);
      pdf.save(`${type}-report-${filter}-payments-${date}.pdf`);
      setMessage(`${titles[type]} PDF downloaded (${report.rows.length} ${report.rows.length === 1 ? 'record' : 'records'}).`);
    } catch (error) {
      setMessage(error.message || `Unable to download the ${titles[type]} PDF.`, true);
    } finally {
      button.disabled = false;
    }
  };

  buttons.forEach((button) => {
    button.addEventListener('click', () => downloadReport(button.dataset.reportType, button));
  });

  document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const type = params.get('type');
    const filter = params.get('paymentMethod');
    if (filter && paymentFilter && ['all', 'cash', 'gcash'].includes(filter)) paymentFilter.value = filter;
    if (params.get('download') !== '1' || !type) return;
    const button = buttons.find((item) => item.dataset.reportType === type);
    if (button) button.click();
  });
})();
