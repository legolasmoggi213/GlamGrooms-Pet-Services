(() => {
  const PRICES = {
    'grooming-basic-s': 450,
    'grooming-basic-m': 550,
    'grooming-basic-l': 700,
    'grooming-basic-xl': 900,
    'grooming-basic-cat': 550,
    'grooming-full-s': 550,
    'grooming-full-m': 650,
    'grooming-full-l': 900,
    'grooming-full-xl': 1100,
    'grooming-full-cat': 750,
    'grooming-premium-s': 700,
    'grooming-premium-m': 800,
    'grooming-premium-l': 1050,
    'grooming-premium-xl': 1250,
    'grooming-a-la-carte-face-trim': 250,
    'grooming-a-la-carte-paw-trim': 200,
    'grooming-a-la-carte-nail-clipping': 90,
    'grooming-a-la-carte-ear-cleaning': 90,
    'grooming-a-la-carte-anal-sac-expressing': 120,
    'grooming-a-la-carte-de-matting': 500,
    'ayurveda-herb-beauty-s': 600,
    'ayurveda-herb-beauty-m': 650,
    'ayurveda-herb-beauty-l': 750,
    'ayurveda-herb-beauty-xl': 800,
    'ayurveda-herb-doctors-s': 700,
    'ayurveda-herb-doctors-m': 750,
    'ayurveda-herb-doctors-l': 850,
    'ayurveda-herb-doctors-xl': 900,
    'ayurveda-herb-moisture-s': 600,
    'ayurveda-herb-moisture-m': 650,
    'ayurveda-herb-moisture-l': 750,
    'ayurveda-herb-moisture-xl': 800,
    'ayurveda-pkg-basic-beauty-moisture-s': 900,
    'ayurveda-pkg-basic-beauty-moisture-m': 1050,
    'ayurveda-pkg-basic-beauty-moisture-l': 1250,
    'ayurveda-pkg-basic-beauty-moisture-xl': 1500,
    'ayurveda-pkg-basic-doctors-s': 1000,
    'ayurveda-pkg-basic-doctors-m': 1150,
    'ayurveda-pkg-basic-doctors-l': 1350,
    'ayurveda-pkg-basic-doctors-xl': 1600,
    'ayurveda-pkg-full-beauty-moisture-s': 1000,
    'ayurveda-pkg-full-beauty-moisture-m': 1050,
    'ayurveda-pkg-full-beauty-moisture-l': 1400,
    'ayurveda-pkg-full-beauty-moisture-xl': 1650,
    'ayurveda-pkg-full-doctors-s': 1100,
    'ayurveda-pkg-full-doctors-m': 1250,
    'ayurveda-pkg-full-doctors-l': 1450,
    'ayurveda-pkg-full-doctors-xl': 1700,
    'ayurveda-pkg-premium-beauty-moisture-s': 1150,
    'ayurveda-pkg-premium-beauty-moisture-m': 1300,
    'ayurveda-pkg-premium-beauty-moisture-l': 1550,
    'ayurveda-pkg-premium-beauty-moisture-xl': 1800,
    'ayurveda-pkg-premium-doctors-s': 1250,
    'ayurveda-pkg-premium-doctors-m': 1400,
    'ayurveda-pkg-premium-doctors-l': 1650,
    'ayurveda-pkg-premium-doctors-xl': 1900,
  };

  const serviceDetails = {
    'grooming-basic-s': { category: 'Basic', duration: 60, includes: ['Bath', 'Breed-specific haircut', 'Nail trim', 'Ear cleaning'], suitable: ['All sizes'] },
    'grooming-basic-m': { category: 'Basic', duration: 60, includes: ['Bath', 'Breed-specific haircut', 'Nail trim', 'Ear cleaning'], suitable: ['All sizes'] },
    'grooming-basic-l': { category: 'Basic', duration: 60, includes: ['Bath', 'Breed-specific haircut', 'Nail trim', 'Ear cleaning'], suitable: ['All sizes'] },
    'grooming-basic-xl': { category: 'Basic', duration: 60, includes: ['Bath', 'Breed-specific haircut', 'Nail trim', 'Ear cleaning'], suitable: ['All sizes'] },
    'grooming-basic-cat': { category: 'Basic', duration: 60, includes: ['Bath', 'Breed-specific haircut', 'Nail trim', 'Ear cleaning'], suitable: ['Cats'] },
    'grooming-full-s': { category: 'Full', duration: 90, includes: ['Full bath', 'Haircut', 'Nail trim', 'Ear cleaning', 'Massage', 'Bandana'], suitable: ['All sizes'] },
    'grooming-full-m': { category: 'Full', duration: 90, includes: ['Full bath', 'Haircut', 'Nail trim', 'Ear cleaning', 'Massage', 'Bandana'], suitable: ['All sizes'] },
    'grooming-full-l': { category: 'Full', duration: 90, includes: ['Full bath', 'Haircut', 'Nail trim', 'Ear cleaning', 'Massage', 'Bandana'], suitable: ['All sizes'] },
    'grooming-full-xl': { category: 'Full', duration: 90, includes: ['Full bath', 'Haircut', 'Nail trim', 'Ear cleaning', 'Massage', 'Bandana'], suitable: ['All sizes'] },
    'grooming-full-cat': { category: 'Full', duration: 90, includes: ['Full bath', 'Haircut', 'Nail trim', 'Ear cleaning', 'Massage', 'Bandana'], suitable: ['Cats'] },
    'grooming-premium-s': { category: 'Premium', duration: 120, includes: ['Complete spa day', 'Multiple treatments', 'Premium products', 'Photo session'], suitable: ['All sizes'] },
    'grooming-premium-m': { category: 'Premium', duration: 120, includes: ['Complete spa day', 'Multiple treatments', 'Premium products', 'Photo session'], suitable: ['All sizes'] },
    'grooming-premium-l': { category: 'Premium', duration: 120, includes: ['Complete spa day', 'Multiple treatments', 'Premium products', 'Photo session'], suitable: ['All sizes'] },
    'grooming-premium-xl': { category: 'Premium', duration: 120, includes: ['Complete spa day', 'Multiple treatments', 'Premium products', 'Photo session'], suitable: ['All sizes'] },
    'grooming-a-la-carte-face-trim': { category: 'A La Carte', duration: 15, includes: ['Facial treatment', 'Gentle trimming'], suitable: ['All sizes'] },
    'grooming-a-la-carte-paw-trim': { category: 'A La Carte', duration: 15, includes: ['Paw trimming', 'Padding care'], suitable: ['All sizes'] },
    'grooming-a-la-carte-nail-clipping': { category: 'A La Carte', duration: 10, includes: ['Professional nail clipping'], suitable: ['All sizes'] },
    'grooming-a-la-carte-ear-cleaning': { category: 'A La Carte', duration: 15, includes: ['Ear cleaning and inspection'], suitable: ['All sizes'] },
    'grooming-a-la-carte-anal-sac-expressing': { category: 'A La Carte', duration: 20, includes: ['Anal sac expressing'], suitable: ['All sizes'] },
    'grooming-a-la-carte-de-matting': { category: 'A La Carte', duration: 45, includes: ['De-matting treatment', 'Brush-out'], suitable: ['All sizes'] },
    'ayurveda-herb-beauty-s': { category: 'Ayurveda Herbs', duration: 60, includes: ['Herbal bath', 'Aromatherapy', 'Massage therapy'], suitable: ['All sizes'] },
    'ayurveda-herb-beauty-m': { category: 'Ayurveda Herbs', duration: 60, includes: ['Herbal bath', 'Aromatherapy', 'Massage therapy'], suitable: ['All sizes'] },
    'ayurveda-herb-beauty-l': { category: 'Ayurveda Herbs', duration: 60, includes: ['Herbal bath', 'Aromatherapy', 'Massage therapy'], suitable: ['All sizes'] },
    'ayurveda-herb-beauty-xl': { category: 'Ayurveda Herbs', duration: 60, includes: ['Herbal bath', 'Aromatherapy', 'Massage therapy'], suitable: ['All sizes'] },
    'ayurveda-herb-doctors-s': { category: 'Ayurveda Herbs', duration: 90, includes: ['Complete Ayurvedic treatment', 'Herbal products', 'Therapeutic massage'], suitable: ['All sizes'] },
    'ayurveda-herb-doctors-m': { category: 'Ayurveda Herbs', duration: 90, includes: ['Complete Ayurvedic treatment', 'Herbal products', 'Therapeutic massage'], suitable: ['All sizes'] },
    'ayurveda-herb-doctors-l': { category: 'Ayurveda Herbs', duration: 90, includes: ['Complete Ayurvedic treatment', 'Herbal products', 'Therapeutic massage'], suitable: ['All sizes'] },
    'ayurveda-herb-doctors-xl': { category: 'Ayurveda Herbs', duration: 90, includes: ['Complete Ayurvedic treatment', 'Herbal products', 'Therapeutic massage'], suitable: ['All sizes'] },
    'ayurveda-herb-moisture-s': { category: 'Ayurveda Herbs', duration: 60, includes: ['Natural oil treatment', 'Deep conditioning'], suitable: ['All sizes'] },
    'ayurveda-herb-moisture-m': { category: 'Ayurveda Herbs', duration: 60, includes: ['Natural oil treatment', 'Deep conditioning'], suitable: ['All sizes'] },
    'ayurveda-herb-moisture-l': { category: 'Ayurveda Herbs', duration: 60, includes: ['Natural oil treatment', 'Deep conditioning'], suitable: ['All sizes'] },
    'ayurveda-herb-moisture-xl': { category: 'Ayurveda Herbs', duration: 60, includes: ['Natural oil treatment', 'Deep conditioning'], suitable: ['All sizes'] },
    'ayurveda-pkg-basic-beauty-moisture-s': { category: 'Ayurveda Packages', duration: 120, includes: ['Combined herbal treatments'], suitable: ['All sizes'] },
    'ayurveda-pkg-basic-beauty-moisture-m': { category: 'Ayurveda Packages', duration: 120, includes: ['Combined herbal treatments'], suitable: ['All sizes'] },
    'ayurveda-pkg-basic-beauty-moisture-l': { category: 'Ayurveda Packages', duration: 120, includes: ['Combined herbal treatments'], suitable: ['All sizes'] },
    'ayurveda-pkg-basic-beauty-moisture-xl': { category: 'Ayurveda Packages', duration: 120, includes: ['Combined herbal treatments'], suitable: ['All sizes'] },
    'ayurveda-pkg-basic-doctors-s': { category: 'Ayurveda Packages', duration: 150, includes: ['Complete Ayurvedic therapy'], suitable: ['All sizes'] },
    'ayurveda-pkg-basic-doctors-m': { category: 'Ayurveda Packages', duration: 150, includes: ['Complete Ayurvedic therapy'], suitable: ['All sizes'] },
    'ayurveda-pkg-basic-doctors-l': { category: 'Ayurveda Packages', duration: 150, includes: ['Complete Ayurvedic therapy'], suitable: ['All sizes'] },
    'ayurveda-pkg-basic-doctors-xl': { category: 'Ayurveda Packages', duration: 150, includes: ['Complete Ayurvedic therapy'], suitable: ['All sizes'] },
    'ayurveda-pkg-full-beauty-moisture-s': { category: 'Ayurveda Packages', duration: 180, includes: ['Advanced combined treatments'], suitable: ['All sizes'] },
    'ayurveda-pkg-full-beauty-moisture-m': { category: 'Ayurveda Packages', duration: 180, includes: ['Advanced combined treatments'], suitable: ['All sizes'] },
    'ayurveda-pkg-full-beauty-moisture-l': { category: 'Ayurveda Packages', duration: 180, includes: ['Advanced combined treatments'], suitable: ['All sizes'] },
    'ayurveda-pkg-full-beauty-moisture-xl': { category: 'Ayurveda Packages', duration: 180, includes: ['Advanced combined treatments'], suitable: ['All sizes'] },
    'ayurveda-pkg-full-doctors-s': { category: 'Ayurveda Packages', duration: 210, includes: ['Premium Ayurvedic therapy'], suitable: ['All sizes'] },
    'ayurveda-pkg-full-doctors-m': { category: 'Ayurveda Packages', duration: 210, includes: ['Premium Ayurvedic therapy'], suitable: ['All sizes'] },
    'ayurveda-pkg-full-doctors-l': { category: 'Ayurveda Packages', duration: 210, includes: ['Premium Ayurvedic therapy'], suitable: ['All sizes'] },
    'ayurveda-pkg-full-doctors-xl': { category: 'Ayurveda Packages', duration: 210, includes: ['Premium Ayurvedic therapy'], suitable: ['All sizes'] },
    'ayurveda-pkg-premium-beauty-moisture-s': { category: 'Ayurveda Packages', duration: 240, includes: ['Ultimate combined treatments'], suitable: ['All sizes'] },
    'ayurveda-pkg-premium-beauty-moisture-m': { category: 'Ayurveda Packages', duration: 240, includes: ['Ultimate combined treatments'], suitable: ['All sizes'] },
    'ayurveda-pkg-premium-beauty-moisture-l': { category: 'Ayurveda Packages', duration: 240, includes: ['Ultimate combined treatments'], suitable: ['All sizes'] },
    'ayurveda-pkg-premium-beauty-moisture-xl': { category: 'Ayurveda Packages', duration: 240, includes: ['Ultimate combined treatments'], suitable: ['All sizes'] },
    'ayurveda-pkg-premium-doctors-s': { category: 'Ayurveda Packages', duration: 270, includes: ['Ultimate Ayurvedic therapy'], suitable: ['All sizes'] },
    'ayurveda-pkg-premium-doctors-m': { category: 'Ayurveda Packages', duration: 270, includes: ['Ultimate Ayurvedic therapy'], suitable: ['All sizes'] },
    'ayurveda-pkg-premium-doctors-l': { category: 'Ayurveda Packages', duration: 270, includes: ['Ultimate Ayurvedic therapy'], suitable: ['All sizes'] },
    'ayurveda-pkg-premium-doctors-xl': { category: 'Ayurveda Packages', duration: 270, includes: ['Ultimate Ayurvedic therapy'], suitable: ['All sizes'] },
  };

  const form = document.getElementById('grooming-form');
  if (!form) return;

  const alertBox = document.getElementById('alert');
  const submitBtn = document.getElementById('submit-btn');
  const pricePreview = document.getElementById('price-preview');
  const serviceSelect = document.getElementById('service');
  const dateInput = document.getElementById('date');
  const timeSelect = document.getElementById('time');
  const pickupTimeInput = document.getElementById('pickupTime');
  const petCountSelect = document.getElementById('pet-count');
  const petFields = document.getElementById('pet-fields');
  const summaryBox = document.getElementById('order-summary');

  let submitting = false;
  let slotRequest = 0;
  let availableSlotsCache = [];
  let lastSuccessfulBookingKey = null;

  const field = (name) => form.querySelector(`[name="${name}"]`);

  const renderPetFields = () => {
    petFields.innerHTML = Array.from({ length: Math.max(1, Math.min(5, Number(petCountSelect.value) || 1)) }, (_, index) => `
      <div class="field full"><strong>Pet ${index + 1}</strong></div>
      <div class="field"><label for="pet-name-${index}">Pet Name *</label><input id="pet-name-${index}" name="petName-${index}" required /></div>
      <div class="field"><label for="pet-species-${index}">Species *</label><select id="pet-species-${index}" name="species-${index}"><option value="dog">Dog</option><option value="cat">Cat</option></select></div>
      <div class="field"><label for="pet-breed-${index}">Breed *</label><input id="pet-breed-${index}" name="breed-${index}" required /></div>
      <div class="field"><label for="pet-age-${index}">Age (years) *</label><input id="pet-age-${index}" name="age-${index}" type="number" min="0" max="50" required /></div>
      <div class="field full"><label for="pet-medical-history-${index}">Medical history (optional)</label><textarea id="pet-medical-history-${index}" name="medicalHistory-${index}" rows="2" placeholder="Allergies, conditions, or medications"></textarea></div>
      <div class="field full"><label for="pet-service-${index}">Service for Pet ${index + 1} *</label><select id="pet-service-${index}" name="service-${index}" required>${serviceSelect.innerHTML}</select></div>
    `).join('');
    updatePrice();
  };

  const collectPets = () => Array.from({ length: Math.max(1, Math.min(5, Number(petCountSelect.value) || 1)) }, (_, index) => ({
    name: String(field(`petName-${index}`)?.value || '').trim(),
    species: String(field(`species-${index}`)?.value || 'dog').trim().toLowerCase(),
    breed: String(field(`breed-${index}`)?.value || '').trim() || null,
    age: field(`age-${index}`)?.value ? Number(field(`age-${index}`).value) : null,
    medicalHistory: String(field(`medicalHistory-${index}`)?.value || '').trim() || null,
    service: String(field(`service-${index}`)?.value || ''),
  }));

  const formatDate = (value) => {
    if (!value) return 'Not selected';
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatMoney = (value) => `₱${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

  const showAlert = (type, message) => {
    alertBox.hidden = false;
    alertBox.className = `alert alert-${type} show`;
    alertBox.textContent = message;
    alertBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    submitBtn.classList.toggle('btn-success', type === 'success');
    submitBtn.classList.toggle('btn-error', type === 'error');
  };

  const clearAlert = () => {
    alertBox.hidden = true;
    alertBox.className = 'alert';
    alertBox.textContent = '';
    submitBtn.classList.remove('btn-success', 'btn-error');
  };

  const setBusy = (busy, label) => {
    submitting = busy;
    submitBtn.disabled = busy;
    submitBtn.textContent = label;
  };

  const updatePrice = () => {
    if (!pricePreview) return;
    const total = collectPets().reduce((sum, pet) => sum + (PRICES[pet.service] || 0), 0);
    pricePreview.textContent = `Total: ${formatMoney(total)}`;
  };

  const formatTimeLabel = (time) => {
    const [hour, minute] = time.split(':').map(Number);
    return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
  };

  const formatSlotLabel = (time, endTime) => `${formatTimeLabel(time)} – ${formatTimeLabel(endTime || time)}`;

  const updatePickupTimeBounds = (slots) => {
    const selectedSlot = slots.find((slot) => slot.time === timeSelect.value && slot.available);
    pickupTimeInput.value = '';
    pickupTimeInput.disabled = !selectedSlot;
    if (!selectedSlot) {
      pickupTimeInput.removeAttribute('min');
      pickupTimeInput.removeAttribute('max');
      return;
    }
    pickupTimeInput.min = selectedSlot.pickupEarliest;
    pickupTimeInput.max = '18:00';
    pickupTimeInput.step = '3600';
  };

  const loadAvailability = async () => {
    const requestId = ++slotRequest;
    if (!dateInput.value) {
      availableSlotsCache = [];
      timeSelect.replaceChildren(new Option('Select a date first', ''));
      timeSelect.disabled = true;
      pickupTimeInput.value = '';
      pickupTimeInput.disabled = true;
      pickupTimeInput.removeAttribute('min');
      pickupTimeInput.removeAttribute('max');
      return;
    }

    timeSelect.disabled = true;
    pickupTimeInput.disabled = true;
    try {
      const query = new URLSearchParams({ date: dateInput.value });
      collectPets().forEach((pet) => {
        if (pet.service) query.append('service', pet.service);
      });
      const response = await fetch(`/api/v1/bookings/grooming/availability?${query}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`Availability request failed (${response.status})`);
      const data = await response.json();
      if (requestId !== slotRequest) return;

      const slots = Array.isArray(data.slots) ? data.slots : [];
      availableSlotsCache = slots;
      const availableSlots = slots.filter((slot) => slot.available);
      const previousTime = timeSelect.value;
      const slotOptions = slots.map((slot) => {
        const option = new Option(
          `${formatSlotLabel(slot.time, slot.endTime)}${slot.available ? '' : ' — Unavailable'}`,
          slot.time,
          false,
          false,
        );
        option.disabled = !slot.available;
        return option;
      });
      timeSelect.replaceChildren(new Option('Select an available time', ''), ...slotOptions);
      timeSelect.value = availableSlots.some((slot) => slot.time === previousTime)
        ? previousTime
        : (availableSlots[0]?.time || '');
      timeSelect.disabled = availableSlots.length === 0;
      updatePickupTimeBounds(slots);
      renderSummary();
    } catch (error) {
      console.warn('Unable to load grooming availability:', error);
      if (requestId === slotRequest) {
        timeSelect.replaceChildren(new Option('Unable to load times; change the date to retry', ''));
        timeSelect.disabled = true;
        pickupTimeInput.value = '';
        pickupTimeInput.disabled = true;
      }
    }
  };

  const renderSummary = () => {
    if (!summaryBox) return;
    const pets = collectPets();
    const rows = pets.map((pet, index) => {
      const selectedService = field(`service-${index}`);
      const serviceText = selectedService?.options[selectedService.selectedIndex]?.textContent || pet.service;
      return [`Pet ${index + 1}: ${pet.name || 'Pet'}`, `${serviceText} · ${formatMoney(PRICES[pet.service] || 0)}`];
    });
    rows.push(['Date', formatDate(dateInput.value)]);
    if (pickupTimeInput.value) rows.push(['Pickup time', pickupTimeInput.value]);
    rows.push(['Total', formatMoney(pets.reduce((sum, pet) => sum + (PRICES[pet.service] || 0), 0))]);

    summaryBox.innerHTML = `
      <div class="form-section-label">Order Summary</div>
      <div class="summary-card">
        ${rows.map(([label, value]) => `
          <div class="summary-row">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
          </div>
        `).join('')}
      </div>
    `;
  };

  const submitBooking = async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (submitting || !form.reportValidity()) return;

    try {
      const payload = {
        customer: {
          name: String(field('name')?.value || '').trim(),
          email: String(field('email')?.value || '').trim(),
          phone: String(field('phone')?.value || '').trim(),
          address: String(field('address')?.value || '').trim() || null,
        },
        pets: collectPets(),
        service: field('service-0')?.value,
        date: dateInput.value,
        time: timeSelect.value,
        pickupTime: pickupTimeInput.value.trim() || null,
        notes: String(field('notes')?.value || '').trim() || null,
        paymentMethod: String(form.querySelector('input[name="paymentMethod"]:checked')?.value || 'cash'),
      };
      const bookingKey = JSON.stringify({
        services: payload.pets.map((pet) => pet.service),
        date: payload.date,
        time: payload.time,
        pets: payload.pets.map((pet) => `${pet.name.toLowerCase()}:${pet.service}`),
      });
      if (bookingKey === lastSuccessfulBookingKey) {
        const confirmed = window.confirm(`You already booked these services for ${formatDate(payload.date)} at ${payload.time}. Are you sure you want to book them again?`);
        if (!confirmed) return;
      }

      setBusy(true, 'Booking...');
      clearAlert();
      const response = await fetch('/api/v1/bookings/grooming', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const details = Array.isArray(result.details) ? result.details.join(', ') : '';
        throw new Error(details || result.error || `Booking failed (${response.status})`);
      }

      if (payload.paymentMethod === 'qrph') {
        const checkoutUrl = result.checkout?.checkoutUrl;
        if (!checkoutUrl) {
          throw new Error('Unable to start PayMongo checkout. Your appointment was not confirmed. Please try again or choose pay at counter.');
        }
        try {
          sessionStorage.setItem('pending_paymongo_booking', JSON.stringify({
            type: 'grooming',
            id: result.appointment?.id,
            createdAt: Date.now(),
          }));
        } catch (error) {
          console.warn('Unable to save pending payment details:', error);
        }
        window.location.assign(checkoutUrl);
        return;
      }

      const appointment = result.appointment || {};
      const pets = Array.isArray(result.pets) ? result.pets : payload.pets;
      const petNames = pets.map((pet) => pet.name).filter(Boolean).join(', ') || 'your pet';
      const pickup = appointment.pickupTime ? `, pickup ${appointment.pickupTime}` : '';
      showAlert(
        'success',
        `You completed a booking! ${result.message || 'Grooming appointment booked'} for ${petNames}. Reference #${appointment.id || 'N/A'}. See you on ${formatDate(appointment.date || payload.date)} at ${appointment.time || payload.time}${pickup}.`,
      );
      lastSuccessfulBookingKey = bookingKey;
      form.dataset.bookingId = appointment.id || '';
    } catch (error) {
      showAlert('error', error.message || 'Unable to book this appointment. Please try again.');
    } finally {
      setBusy(false, 'Book Appointment');
    }
  };

  form.addEventListener('submit', submitBooking, { capture: true });
  petFields.addEventListener('change', () => {
    updatePrice();
    renderSummary();
    loadAvailability();
  });
  petFields.addEventListener('input', renderSummary);
  petCountSelect.addEventListener('change', () => {
    renderPetFields();
    renderSummary();
    loadAvailability();
  });
  dateInput.addEventListener('change', () => {
    renderSummary();
    loadAvailability();
  });
  timeSelect.addEventListener('change', () => {
    updatePickupTimeBounds(availableSlotsCache);
    renderSummary();
  });
  pickupTimeInput.addEventListener('change', renderSummary);

  renderPetFields();
  updatePrice();
  renderSummary();
  loadAvailability();
})();