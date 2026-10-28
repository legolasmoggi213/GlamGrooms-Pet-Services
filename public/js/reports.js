(() => {
  const buttons = [...document.querySelectorAll('[data-report-type]')];
  const paymentFilter = document.getElementById('report-payment-method');
  const startDateFilter = document.getElementById('report-start-date');
  const endDateFilter = document.getElementById('report-end-date');
  const message = document.getElementById('report-message');
  const reportWidths = {
    grooming: [22, 30, 24, 50, 40, 20, 28, 25, 30],
    hotel: [24, 30, 25, 32, 31, 31, 20, 24, 28, 28],
    walkin: [24, 30, 23, 50, 24, 25, 25, 25, 20, 27],
  };
  const reportHeaders = {
    grooming: ['Appointment ID', 'CUSTOMER', 'PET', 'SERVICES APPLIED', 'CHECK IN TIME', 'STATUS', 'PAYMENT TYPE', 'PAYMENT STATUS', 'PAYMENT TOTAL'],
    hotel: ['Reservation ID', 'Customer', 'Pet(s)', 'Room(s)', 'Check-in', 'Check-out', 'Status', 'Payment', 'Payment status', 'Amount (PHP)'],
    walkin: ['Transaction ID', 'Customer', 'Pet', 'Sale/items', 'Payment', 'Payment status', 'Amount (PHP)', 'Cash tendered', 'Change', 'Date'],
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
    pdf.setFillColor(32, 45, 50);
    pdf.setDrawColor(207, 211, 205);
    const headerLines = widths.map((width, index) => pdf.splitTextToSize(String(headers[index]), width - 4));
    const headerHeight = Math.max(12, ...headerLines.map((lines) => lines.length * 3.5 + 5));
    let x = 12;
    headerLines.forEach((lines, index) => {
      pdf.setFillColor(32, 45, 50);
      pdf.rect(x, y, widths[index], headerHeight, 'FD');
      pdf.setTextColor(255, 255, 255);
      pdf.text(lines, x + 2, y + 3.5, { lineHeightFactor: 1.05 });
      x += widths[index];
    });
    return y + headerHeight;
  };

  const drawRows = (pdf, report, type, y, subtitle) => {
    const widths = reportWidths[type];
    const pageHeight = pdf.internal.pageSize.getHeight();
    let rows = report.rows;
    if (!rows.length) rows = [['No records match the selected filters.', ...Array(report.headers.length - 1).fill('')]];

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
    const startDate = startDateFilter ? startDateFilter.value : '';
    const endDate = endDateFilter ? endDateFilter.value : '';
    if (startDate && endDate && startDate > endDate) {
      setMessage('The From date must be on or before the To date.', true);
      endDateFilter.focus();
      return;
    }
    const paymentLabel = filter === 'gcash' ? 'GCash only' : filter === 'cash' ? 'Cash only' : 'All payment methods';
    const dateRangeLabel = startDate || endDate
      ? `${startDate || 'Any date'} to ${endDate || 'Any date'}`
      : 'All dates';
    button.disabled = true;
    setMessage(`Preparing the ${titles[type]} PDF...`);
    try {
      const query = new URLSearchParams({ type, paymentMethod: filter });
      if (startDate) query.set('startDate', startDate);
      if (endDate) query.set('endDate', endDate);
      const response = await fetch(`/api/v1/admin/reports?${query}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const report = await response.json();
      if (!response.ok) throw new Error(report.error || `Report request failed (${response.status}).`);
      const headers = reportHeaders[type].map((fallback, index) => String(report.headers?.[index] || fallback));

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF('l', 'mm', 'a4');
      const subtitle = `${dateRangeLabel} | ${paymentLabel} | Generated ${new Date().toLocaleString()}`;
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
      y = drawHeaderRow(pdf, headers, reportWidths[type], y);
      drawRows(pdf, { ...report, headers }, type, y, subtitle);
      addPageNumbers(pdf);

      const date = new Date().toISOString().slice(0, 10);
      const rangeSuffix = startDate || endDate ? `-${startDate || 'any'}-to-${endDate || 'any'}` : '';
      pdf.save(`${type}-report-${filter}-payments${rangeSuffix || `-${date}`}.pdf`);
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
    const startDate = params.get('startDate');
    const endDate = params.get('endDate');
    if (filter && paymentFilter && ['all', 'cash', 'gcash'].includes(filter)) paymentFilter.value = filter;
    if (startDate && startDateFilter) startDateFilter.value = startDate;
    if (endDate && endDateFilter) endDateFilter.value = endDate;
    if (params.get('download') !== '1' || !type) return;
    const button = buttons.find((item) => item.dataset.reportType === type);
    if (button) button.click();
  });
})();
