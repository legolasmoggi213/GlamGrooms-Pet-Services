// Hotel reservation page logic
(() => {
const ROOM_PRICES = {
  'staycation-standard': 500,
  'staycation-deluxe': 800,
};

  const ROOM_DETAILS = {
    'staycation-standard': { category: 'Staycation', size: 'Medium', occupancy: 2, amenities: ['WiFi', 'Air Conditioning', 'TV', 'Bathroom'], description: 'Standard overnight stay — weekday ₱500 / weekend ₱700 per night' },
    'staycation-deluxe': { category: 'Staycation', size: 'Large', occupancy: 2, amenities: ['WiFi', 'Air Conditioning', 'TV', 'Bathroom', 'Mini Fridge', 'Balcony'], description: 'Deluxe overnight stay — weekday ₱800 / weekend ₱1000 per night' },
  };
  

  const showRoomDetails = () => {
    const roomSelect = document.getElementById('roomType');
    const selectedRoom = roomSelect?.value;
    const detailsContainer = document.getElementById('room-details');
    
    if (selectedRoom && detailsContainer && ROOM_DETAILS[selectedRoom]) {
      const details = ROOM_DETAILS[selectedRoom];
      detailsContainer.innerHTML = `
        <div class="room-details">
          <h4>${details.category} Suite</h4>
          <p><strong>Size:</strong> ${details.size}</p>
          <p><strong>Occupancy:</strong> ${details.occupancy} guest(s)</p>
          <p><strong>Amenities:</strong></p>
          <ul>
            ${details.amenities.map(item => `<li>• ${item}</li>`).join('')}
          </ul>
          <p><strong>Description:</strong> ${details.description}</p>
        </div>
      `;
      detailsContainer.classList.remove('hidden');
    } else if (detailsContainer) {
      detailsContainer.classList.add('hidden');
    }
  };
  

  const roomDetails = document.getElementById('room-details');
  if (roomDetails) {
    roomDetails.className = 'room-details-container mt-2';
    roomDetails.innerHTML = `
      <div class="alert alert-info">
        <strong>Room Information:</strong> Select a suite type to see details about size, capacity, and amenities.
      </div>
    `;
  }
  

  const alertBox = document.getElementById('alert');
  const submitBtn = document.getElementById('submit-btn');
  const pricePreview = document.getElementById('price-preview');
  const roomSelect = document.getElementById('roomType');
  const checkInInput = document.getElementById('checkIn');
  const checkOutInput = document.getElementById('checkOut');
  const checkInTime = document.getElementById('checkInTime');
  const checkOutTime = document.getElementById('checkOutTime');
  const petCount = document.getElementById('pet-count');
  const petFields = document.getElementById('pet-fields');
  const form = document.getElementById('hotel-form');
  const getField = (name) => form?.elements?.namedItem?.(name) || document.querySelector(`[name="${name}"]`);
  let roomAvailable = false;
  let customerProfileLoaded = false;
  let availabilityRequest = 0;
  let slotRequest = 0;
  let quoteRequest = 0;
  let latestQuote = null;
  let latestQuoteKey = null;
  let latestQuoteMessage = 'Enter your stay dates to calculate the total.';
  let selectedHotelSlots = new Set();
  let savedPets = [];
  const hotelSlotPicker = document.getElementById('hotel-slot-picker');
  const hotelSlotDate = document.getElementById('hotel-slot-date');
  const hotelSlotInstructions = document.getElementById('hotel-slot-instructions');
  const hotelSlotGrid = document.getElementById('hotel-slot-grid');
  const hotelSlotStatus = document.getElementById('hotel-slot-status');
  const hotelSlotNumbersInput = document.getElementById('hotel-slot-numbers');
  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

  const populateTimeOptions = (select, date, selectedValue) => {
    const day = date ? new Date(`${date}T00:00:00.000Z`).getUTCDay() : -1;
    const openHour = day === 0 ? 6 : 9;
    const closeHour = 18;
    const previous = select.value;
    const options = Array.from({ length: closeHour - openHour }, (_, index) => {
      const hour = openHour + index;
      const value = `${String(hour).padStart(2, '0')}:00`;
      const labelHour = hour % 12 || 12;
      const period = hour >= 12 ? 'PM' : 'AM';
      return new Option(`${labelHour}:00 ${period}`, value);
    });
    select.replaceChildren(...options);
    const preferred = [previous, selectedValue].find((value) => options.some((option) => option.value === value));
    if (preferred) select.value = preferred;
  };

  const renderOrderSummary = () => {
    const summaryBox = document.getElementById('order-summary');
    if (!summaryBox || !form) return;

    const escapeSummary = (value) => String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
    const pets = collectPets();
    const nights = Math.round((new Date(checkOutInput.value) - new Date(checkInInput.value)) / 864e5);
    const quoteKey = JSON.stringify({ checkIn: checkInInput.value, checkOut: checkOutInput.value, roomTypes: pets.map((pet) => pet.roomType) });
    const quote = latestQuoteKey === quoteKey ? latestQuote : null;
    const notesValue = getField('notes')?.value || '';
    const slots = selectedSlots();
    const petCards = pets.map((pet, index) => {
      const roomField = petFields.querySelector(`[name="roomType-${index}"]`);
      const roomText = roomField?.options[roomField.selectedIndex]?.textContent?.trim() || pet.roomType;
      const petQuote = quote?.petQuotes?.[index];
      const slot = slots[index];
      return `
        <article class="booking-summary-pet">
          <div class="booking-summary-pet-heading">
            <div><span class="booking-summary-eyebrow">PET ${index + 1}</span><h4>${escapeSummary(pet.name || 'Pet name not entered')}</h4></div>
            <strong>${petQuote ? fmtMoney(petQuote.total) : 'Quote pending'}</strong>
          </div>
          <dl class="booking-summary-details">
            <div><dt>Pet</dt><dd>${escapeSummary([pet.species, pet.breed, pet.age == null ? '' : `${pet.age} yrs`].filter(Boolean).join(' · ') || 'Details not entered')}</dd></div>
            <div><dt>Medical history</dt><dd>${escapeSummary(pet.medicalHistory || 'Not provided')}</dd></div>
            <div><dt>Booked suite</dt><dd>${escapeSummary(roomText)}</dd></div>
            <div><dt>Reserved slot</dt><dd>${slot ? `Slot ${slot}` : 'Choose one available slot'}</dd></div>
            ${petQuote ? `<div><dt>Room subtotal</dt><dd>${fmtMoney(petQuote.baseAmount)}</dd></div>
              <div><dt>Average base rate per night</dt><dd>${fmtMoney(petQuote.baseAmount / quote.nights)}</dd></div>
              ${petQuote.multiPetDiscount ? `<div><dt>Multi-pet discount</dt><dd>−${fmtMoney(petQuote.multiPetDiscount)}</dd></div>` : ''}
              ${petQuote.longStayDiscount ? `<div><dt>Long-stay discount</dt><dd>−${fmtMoney(petQuote.longStayDiscount)}</dd></div>` : ''}` : ''}
          </dl>
        </article>`;
    });
    const paymentMethod = form.querySelector('input[name="paymentMethod"]:checked')?.value || 'cash';

    summaryBox.innerHTML = `
      <section class="booking-summary-card" aria-label="Pet hotel reservation summary">
        <header class="booking-summary-header">
          <div><span class="booking-summary-eyebrow">REVIEW YOUR STAY</span><h3>Pet hotel reservation</h3><p>Review the suite, assigned slot, dates, and estimated charges for each pet.</p></div>
          <span class="booking-summary-badge">${pets.length} pet${pets.length === 1 ? '' : 's'}</span>
        </header>
        <div class="booking-summary-pets">${petCards.join('')}</div>
        <div class="booking-summary-section">
          <h4>Stay schedule</h4>
          <dl class="booking-summary-details">
            <div><dt>Check-in</dt><dd>${escapeSummary(fmtDate(checkInInput.value))} · ${escapeSummary(checkInTime.value || 'Select time')}</dd></div>
            <div><dt>Check-out</dt><dd>${escapeSummary(fmtDate(checkOutInput.value))} · ${escapeSummary(checkOutTime.value || 'Select time')}</dd></div>
            <div><dt>Length of stay</dt><dd>${quote ? `${quote.nights} night${quote.nights === 1 ? '' : 's'}` : (nights > 0 ? `${nights} night${nights === 1 ? '' : 's'}` : 'Minimum 1 night')}</dd></div>
            <div><dt>Special care instructions</dt><dd>${escapeSummary(String(notesValue).trim() || 'None provided')}</dd></div>
          </dl>
        </div>
        ${quote ? `<div class="booking-summary-pricing">
          <div><span>Room subtotal</span><strong>${fmtMoney(quote.baseAmount)}</strong></div>
          ${quote.multiPetDiscount ? `<div><span>Multi-pet discount</span><strong>−${fmtMoney(quote.multiPetDiscount)}</strong></div>` : ''}
          ${quote.longStayDiscount ? `<div><span>5+ night discount</span><strong>−${fmtMoney(quote.longStayDiscount)}</strong></div>` : ''}
          ${quote.complimentaryBath ? '<div><span>Complimentary bath &amp; dry</span><strong>Included</strong></div>' : ''}
        </div>` : `<p class="booking-summary-payment">${escapeSummary(latestQuoteMessage)}</p>`}
        <div class="booking-summary-total"><span>Estimated total</span><strong>${quote ? fmtMoney(quote.total) : 'Quote pending'}</strong></div>
        <p class="booking-summary-payment">${paymentMethod === 'qrph' ? 'GCash QR payment selected. Your reservation will be confirmed after successful payment.' : 'Cash payment selected. Please pay at the counter.'}</p>
      </div>
    `;
  };

  const localDate = (date) => {
    const copy = new Date(date);
    copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
    return copy.toISOString().slice(0, 10);
  };
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const applyCheckInDates = () => {
    checkInInput.min = today;
    const checkIn = checkInInput.value;
    const minimumCheckOut = checkIn ? new Date(`${checkIn}T00:00:00`) : new Date(`${today}T00:00:00`);
    minimumCheckOut.setDate(minimumCheckOut.getDate() + 1);
    checkOutInput.min = localDate(minimumCheckOut);
    if (checkIn && checkOutInput.value && checkOutInput.value < checkOutInput.min) {
      checkOutInput.value = checkOutInput.min;
    }
  };
  const updateDateTimes = () => {
    populateTimeOptions(checkInTime, checkInInput.value, '14:00');
    populateTimeOptions(checkOutTime, checkOutInput.value, '12:00');
  };
  applyCheckInDates();
  updateDateTimes();

  const updateRoomPreview = (index) => {
    const roomField = petFields.querySelector(`[name="roomType-${index}"]`);
    const preview = petFields.querySelector(`[data-room-preview="${index}"]`);
    if (!roomField || !preview) return;

    const roomPreview = roomField.value === 'staycation-standard'
      ? { image: '/assets/pet-hotel-standard-shih-tzu.png', alt: 'Shih Tzu in the standard pet hotel room', title: 'Standard Room' }
      : { image: '/assets/pet-hotel-premium-bulldog.png', alt: 'Bulldog in the premium pet hotel room', title: 'Premium Deluxe Room' };
    preview.innerHTML = `
      <div class="hotel-room-preview-card">
        <img src="${roomPreview.image}" alt="${roomPreview.alt}" loading="lazy" />
        <p>${roomPreview.title}</p>
      </div>
    `;
    preview.classList.remove('hotel-room-preview-enter');
    void preview.offsetWidth;
    preview.classList.add('hotel-room-preview-enter');
  };

  const updatePrice = async () => {
    const pets = collectPets();
    const requestId = ++quoteRequest;
    const quoteKey = JSON.stringify({ checkIn: checkInInput.value, checkOut: checkOutInput.value, roomTypes: pets.map((pet) => pet.roomType) });
    latestQuoteKey = quoteKey;
    latestQuote = null;
    const nights = Math.round((new Date(checkOutInput.value) - new Date(checkInInput.value)) / 864e5);
    if (!checkInInput.value || !checkOutInput.value) {
      latestQuoteMessage = 'Enter your stay dates to calculate the total.';
      if (pricePreview) pricePreview.textContent = latestQuoteMessage;
      renderOrderSummary();
      return;
    }
    if (nights <= 0) {
      latestQuoteMessage = 'Check-out must be after check-in.';
      if (pricePreview) pricePreview.textContent = latestQuoteMessage;
      renderOrderSummary();
      return;
    }
    latestQuoteMessage = 'Calculating quote…';
    if (pricePreview) pricePreview.textContent = latestQuoteMessage;
    renderOrderSummary();
    const query = new URLSearchParams({ checkIn: checkInInput.value, checkOut: checkOutInput.value });
    pets.forEach((pet) => query.append('roomType', pet.roomType));
    try {
      const response = await fetch(`/api/v1/bookings/hotel/quote?${query}`, { credentials: 'include', cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to calculate the stay total.');
      if (result.ok === false) throw new Error(result.error || 'Unable to calculate the stay total.');
      if (requestId !== quoteRequest || quoteKey !== latestQuoteKey) return;
      latestQuote = result;
      latestQuoteMessage = '';
      if (pricePreview) {
        const discounts = result.multiPetDiscount + result.longStayDiscount;
        pricePreview.textContent = `${result.nights} nights · Total ${fmtMoney(result.total)}${discounts ? ` · Discounts ${fmtMoney(discounts)}` : ''}`;
      }
    } catch (error) {
      if (requestId !== quoteRequest || quoteKey !== latestQuoteKey) return;
      if (pricePreview) pricePreview.textContent = error.message;
      latestQuoteMessage = error.message;
    }
    renderOrderSummary();
  };
  const renderPetFields = () => {
    petFields.innerHTML = Array.from({ length: Math.max(1, Math.min(5, Number(petCount.value) || 1)) }, (_, index) => `
      <div class="field full"><strong>Pet ${index + 1}</strong></div>
      <div class="field full"><label for="pet-profile-${index}">Use a saved pet profile</label><select id="pet-profile-${index}" name="petProfile-${index}" data-saved-pet><option value="">Enter a new pet</option>${savedPets.map((pet) => `<option value="${escapeHtml(pet.id)}">${escapeHtml(pet.name)} — ${escapeHtml(pet.species)}, ${escapeHtml(pet.breed)}</option>`).join('')}</select></div>
      <div class="field"><label for="pet-name-${index}">Pet Name *</label><input id="pet-name-${index}" name="petName-${index}" required /></div>
      <div class="field"><label for="pet-species-${index}">Species *</label><select id="pet-species-${index}" name="species-${index}"><option value="dog">Dog</option><option value="cat">Cat</option></select></div>
      <div class="field"><label for="pet-breed-${index}">Breed *</label><input id="pet-breed-${index}" name="breed-${index}" required /></div>
      <div class="field"><label for="pet-age-${index}">Age (years) *</label><input id="pet-age-${index}" name="age-${index}" type="number" min="0" max="50" required /></div>
      <div class="field full"><label for="pet-medical-history-${index}">Medical History (Optional)</label><textarea id="pet-medical-history-${index}" name="medicalHistory-${index}" rows="3" maxlength="1000" placeholder="Share any allergies, ongoing conditions, or care needs."></textarea></div>
      <div class="field full"><label for="pet-room-${index}">Room for Pet ${index + 1} *</label><select id="pet-room-${index}" name="roomType-${index}" required>${roomSelect.innerHTML}</select><div class="hotel-room-preview" data-room-preview="${index}" aria-live="polite"></div></div>
    `).join('');
    Array.from({ length: Math.max(1, Math.min(5, Number(petCount.value) || 1)) }, (_, index) => updateRoomPreview(index));
  };
  const collectPets = () => Array.from({ length: Math.max(1, Math.min(5, Number(petCount.value) || 1)) }, (_, index) => {
    const petField = (fieldName) => petFields.querySelector(`[name="${fieldName}-${index}"]`);
    const profileId = petField('petProfile')?.value;
    return {
      ...(profileId ? { id: profileId } : {}),
      name: petField('petName')?.value.trim() || '',
      species: petField('species')?.value || 'dog',
      breed: petField('breed')?.value.trim() || null,
      age: petField('age')?.value ? Number(petField('age').value) : null,
      medicalHistory: petField('medicalHistory')?.value.trim() || null,
      roomType: petField('roomType')?.value || roomSelect.value,
    };
  });

  const selectedSlots = () => [...selectedHotelSlots].sort((a, b) => a - b);
  const syncReservationButton = () => {
    hotelSlotNumbersInput.value = selectedSlots().join(',');
    const hasRequiredSlots = selectedHotelSlots.size === collectPets().length;
    submitBtn.disabled = !roomAvailable || !customerProfileLoaded || !hasRequiredSlots;
  };

  const renderHotelSlots = (availableSlotNumbers = null, error = null, checkInOnly = false) => {
    const checkIn = checkInInput.value;
    hotelSlotPicker.hidden = false;
    hotelSlotNumbersInput.value = selectedSlots().join(',');
    if (!checkIn) {
      hotelSlotDate.textContent = 'Choose a check-in date';
      hotelSlotInstructions.textContent = 'Choose a check-in date to see which slots are available.';
      hotelSlotGrid.innerHTML = Array.from({ length: 35 }, (_, index) => {
        const slot = index + 1;
        return `<button type="button" class="hotel-slot" data-hotel-slot="${slot}" aria-label="Slot ${slot}, choose a check-in date to check availability" title="Choose a check-in date to check availability" disabled>${slot}</button>`;
      }).join('');
      hotelSlotStatus.textContent = 'Slots 1–35 are shown. Choose a check-in date to load availability.';
      syncReservationButton();
      return;
    }

    const dateLabel = new Date(`${checkIn}T00:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).replace(',', '').toUpperCase();
    hotelSlotDate.textContent = `Slots for ${dateLabel}`;
    hotelSlotInstructions.textContent = `Choose ${collectPets().length} slot${collectPets().length === 1 ? '' : 's'} (one per pet). Your selected slot${collectPets().length === 1 ? '' : 's'} ${collectPets().length === 1 ? 'stays' : 'stay'} reserved until check-out.`;

    const available = new Set(availableSlotNumbers || []);
    if (availableSlotNumbers) {
      for (const slot of selectedHotelSlots) {
        if (!available.has(slot)) selectedHotelSlots.delete(slot);
      }
    }
    hotelSlotGrid.innerHTML = Array.from({ length: 35 }, (_, index) => {
      const slot = index + 1;
      const isAvailable = available.has(slot);
      const isSelected = selectedHotelSlots.has(slot);
      const isUnavailable = availableSlotNumbers && !isAvailable;
      const atSelectionLimit = selectedHotelSlots.size >= collectPets().length && !isSelected;
      const label = isAvailable
        ? `Slot ${slot}${isSelected ? ', selected' : atSelectionLimit ? ', available, selection limit reached' : ', available'}`
        : error ? `Slot ${slot}, availability not loaded` : `Slot ${slot}, unavailable for these dates`;
      const content = isUnavailable ? `${slot} ×` : slot;
      return `<button type="button" class="hotel-slot${isSelected ? ' selected' : ''}${isUnavailable ? ' unavailable' : ''}" data-hotel-slot="${slot}" aria-label="${label}" title="${label}" ${!isAvailable || atSelectionLimit ? 'disabled' : ''}>${content}</button>`;
    }).join('');

    if (error) {
      hotelSlotStatus.textContent = error;
    } else if (!availableSlotNumbers) {
      hotelSlotStatus.textContent = 'Checking slot availability for your selected stay…';
    } else if (available.size < collectPets().length) {
      hotelSlotStatus.textContent = `Only ${available.size} slot${available.size === 1 ? '' : 's'} are available for the full stay; ${collectPets().length} required.`;
    } else if (checkInOnly) {
      hotelSlotStatus.textContent = `${available.size} slot${available.size === 1 ? '' : 's'} available on the check-in date. After choosing your checkout date, availability will be checked for the full stay.`;
    } else {
      hotelSlotStatus.textContent = `${available.size} slot${available.size === 1 ? '' : 's'} available for the full stay.`;
    }
    syncReservationButton();
  };

  const refreshHotelSlots = async () => {
    const requestId = ++slotRequest;
    const checkIn = checkInInput.value;
    if (!checkIn) {
      renderHotelSlots();
      return;
    }
    const roomTypes = [...new Set(collectPets().map((pet) => pet.roomType).filter(Boolean))];
    if (!roomTypes.length) {
      renderHotelSlots(null, 'Select a room type before checking slot availability.');
      return;
    }
    const checkOut = checkOutInput.value;
    const hasCheckoutDate = Boolean(checkOut && checkOut > checkIn);
    renderHotelSlots();
    try {
      const query = new URLSearchParams({
        roomType: roomTypes[0],
        checkIn,
        pets: String(collectPets().length),
      });
      if (hasCheckoutDate) query.set('checkOut', checkOut);
      const response = await fetch(`/api/v1/bookings/hotel/availability?${query}`, { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not check hotel slot availability.');
      if (requestId !== slotRequest) return;
      renderHotelSlots(data.availableSlotNumbers, null, data.checkInOnly === true);
    } catch (error) {
      if (requestId !== slotRequest) return;
      console.error('Could not load hotel slot availability:', error);
      renderHotelSlots(null, error.message || 'Could not check hotel slot availability. Please try again.');
    }
  };

  hotelSlotGrid.addEventListener('click', (event) => {
    const slotButton = event.target.closest('[data-hotel-slot]');
    if (!slotButton || slotButton.disabled) return;
    const slot = Number(slotButton.dataset.hotelSlot);
    if (selectedHotelSlots.has(slot)) selectedHotelSlots.delete(slot);
    else if (selectedHotelSlots.size < collectPets().length) selectedHotelSlots.add(slot);
    renderHotelSlots([...hotelSlotGrid.querySelectorAll('[data-hotel-slot]')]
      .filter((button) => !button.classList.contains('unavailable'))
      .map((button) => Number(button.dataset.hotelSlot)));
    renderOrderSummary();
  });


// Real-time room availability check
const checkAvailability = async () => {
  const roomTypes = [...new Set(collectPets().map((pet) => pet.roomType).filter(Boolean))];
  const checkIn = checkInInput.value;
  const checkOut = checkOutInput.value;
  const requestId = ++availabilityRequest;
  refreshHotelSlots();
  roomAvailable = false;
  syncReservationButton();
  if (!roomTypes.length || !checkIn || !checkOut) return;
  try {
    const results = await Promise.all(roomTypes.map(async (roomType) => {
      const query = new URLSearchParams({ roomType, checkIn, checkOut, pets: String(collectPets().length) });
      const res = await fetch(`/api/v1/bookings/hotel/availability?${query}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not check room availability');
      return data;
    }));
    if (requestId !== availabilityRequest) return;
    const badge = document.getElementById('availability-badge');
    roomAvailable = results.every((result) => result.available);
    syncReservationButton();
    if (!badge) return;
    if (roomAvailable) {
      const remainingSlots = Math.min(...results.map((result) => result.remainingSlots));
      badge.textContent = `${remainingSlots} of ${results[0].capacity} pet spaces available for these dates`;
      badge.style.color = '#1a6b4a';
    } else {
      badge.textContent = '✗ Not enough pet-hotel spaces are available for these dates';
      badge.style.color = '#c0392b';
    }
  } catch (err) {
    console.warn('Could not check availability:', err);
    if (requestId === availabilityRequest) {
      roomAvailable = false;
      syncReservationButton();
      const badge = document.getElementById('availability-badge');
      if (badge) {
        badge.textContent = err.message || 'Could not check room availability. Please try again shortly.';
        badge.style.color = '#c0392b';
      }
    }
  }
};

[checkInTime, checkOutTime].forEach((el) => el.addEventListener('change', renderOrderSummary));
  form.addEventListener('input', renderOrderSummary);
  petFields.addEventListener('change', (event) => {
    const roomSelect = event.target.closest('[name^="roomType-"]');
    if (roomSelect) {
      updateRoomPreview(Number(roomSelect.name.split('-').pop()));
    }
    const profileSelect = event.target.closest('[data-saved-pet]');
    if (profileSelect) {
      const index = Number(profileSelect.name.split('-').pop());
      const pet = savedPets.find((item) => String(item.id) === profileSelect.value);
      const setField = (name, value) => {
        const field = petFields.querySelector(`[name="${name}-${index}"]`);
        if (!field) return;
        field.value = value == null ? '' : value;
        if (field.tagName === 'SELECT') field.disabled = Boolean(pet);
        else field.readOnly = Boolean(pet);
      };
      setField('petName', pet?.name || '');
      setField('species', pet?.species || 'dog');
      setField('breed', pet?.breed || '');
      setField('age', pet?.age ?? '');
      const medicalHistoryField = petFields.querySelector(`[name="medicalHistory-${index}"]`);
      if (medicalHistoryField) {
        medicalHistoryField.value = pet?.medicalHistory || '';
        medicalHistoryField.readOnly = false;
      }
    }
    selectedHotelSlots.clear();
    updatePrice();
    checkAvailability();
    renderOrderSummary();
  });
  checkInInput.addEventListener('change', () => { selectedHotelSlots.clear(); updatePrice(); checkAvailability(); renderOrderSummary(); });
  checkOutInput.addEventListener('change', () => {
    if (checkInInput.value && checkOutInput.value && checkOutInput.value < checkOutInput.min) applyCheckInDates();
    updateDateTimes();
    updatePrice();
    checkAvailability();
    renderOrderSummary();
  });
  checkInInput.addEventListener('change', applyCheckInDates);
  form.addEventListener('input', renderOrderSummary);
  form.addEventListener('change', renderOrderSummary);
  petCount.addEventListener('change', () => { selectedHotelSlots.clear(); renderPetFields(); updatePrice(); checkAvailability(); renderOrderSummary(); });
  populateTimeOptions(checkInTime, '14:00');
  populateTimeOptions(checkOutTime, '12:00');
  renderPetFields();
  updatePrice();
  checkAvailability();
  renderOrderSummary();

  const showAlert = (type, message) => {
    alertBox.className = `alert alert-${type} show`;
    alertBox.textContent = message;
    alertBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    submitBtn.classList.toggle('btn-success', type === 'success');
    submitBtn.classList.toggle('btn-error', type === 'error');
  };

  const loadCustomerProfile = async () => {
    try {
      const response = await fetch('/customer/profile', { credentials: 'include', cache: 'no-store' });
      if (response.status === 401) {
        window.location.href = `/customer/login.html?return=${encodeURIComponent('/hotel.html')}`;
        return;
      }
      if (!response.ok) throw new Error('Unable to load your customer profile.');
      const data = await response.json();
      const customer = data.customer || {};
      for (const [field, value] of Object.entries({
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
      })) {
        if (form.elements[field] && value) form.elements[field].value = value;
      }
      savedPets = Array.isArray(data.pets) ? data.pets : [];
      customerProfileLoaded = true;
      renderPetFields();
      updatePrice();
      checkAvailability();
      renderOrderSummary();
    } catch (error) {
      showAlert('error', error.message);
    }
  };
  loadCustomerProfile();

  const checkAndCancelPendingPayMongo = async () => {
    const params = new URLSearchParams(window.location.search);
    const wasCancelled = params.get('payment') === 'cancelled';
    const raw = sessionStorage.getItem('pending_paymongo_booking');
    let cancelledAny = false;
    let cancellationFailed = false;

    if (raw) {
      sessionStorage.removeItem('pending_paymongo_booking');
      try {
        const pending = JSON.parse(raw);
        if (pending && pending.id) {
          const result = await apiPost('/payments/cancel', { bookingType: pending.type || 'hotel', bookingId: pending.id });
          if (result.paid) {
            window.location.replace(`/customer/account.html?payment_success=1&bookingType=${encodeURIComponent(pending.type || 'hotel')}&bookingId=${encodeURIComponent(pending.id)}`);
            return;
          }
          cancelledAny = Boolean(result.deleted);
        }
      } catch (e) {
        console.warn('Could not void pending reservation:', e);
        cancellationFailed = true;
      }

      if (cancellationFailed) {
        showAlert('error', 'We could not confirm that payment was cancelled. Your reservation was kept; check My Account before trying to pay again.');
        return;
      }
    }

    if (wasCancelled || cancelledAny) {
      showAlert('info', 'You backed out of the online payment stage. The reservation was not placed. You can select counter cash below to book your stay.');
      const cashRadio = form.querySelector('input[name="paymentMethod"][value="cash"]');
      if (cashRadio) cashRadio.checked = true;
      if (wasCancelled) {
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('payment');
        window.history.replaceState(null, '', cleanUrl.toString());
      }
    }
  };

  window.addEventListener('pageshow', () => {
    if (!window.performance || !window.performance.navigation || window.performance.navigation.type !== 2) {
      checkAndCancelPendingPayMongo();
    }
  });
  checkAndCancelPendingPayMongo();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    if (!checkInInput.value) {
      showAlert('error', 'Choose a check-in date to see available slots.');
      return;
    }
    if (!checkOutInput.value) {
      showAlert('error', 'Please provide a check-out date.');
      return;
    }
    if (selectedHotelSlots.size !== collectPets().length) {
      showAlert('error', `Pick ${collectPets().length} available hotel slot${collectPets().length === 1 ? '' : 's'} for the selected stay.`);
      hotelSlotPicker.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (checkOutInput.value <= checkInInput.value) {
      showAlert('error', 'Check-out must be after check-in.');
      applyCheckInDates();
      updatePrice();
      return;
    }
    if (!roomAvailable) {
      showAlert('error', 'That room is not available for the selected dates. Please choose different dates or another room.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Reserving...';

    const customerName = getField('name')?.value || '';
    const customerEmail = getField('email')?.value || '';
    const customerPhone = getField('phone')?.value || '';
    const customerAddress = getField('address')?.value || '';
    const notesValue = getField('notes')?.value || '';
    const paymentMethod = form.querySelector('input[name="paymentMethod"]:checked')?.value || 'cash';

    const payload = {
      customer: {
        name: customerName.trim(),
        email: customerEmail.trim(),
        phone: customerPhone.trim(),
        address: customerAddress.trim() || null,
      },
      pets: collectPets(),
      slotNumbers: selectedSlots(),
      roomType: collectPets()[0]?.roomType || roomSelect.value,
      checkIn: checkInInput.value,
      checkInTime: checkInTime.value,
      checkOut: checkOutInput.value,
      checkOutTime: checkOutTime.value,
      notes: notesValue.trim() || null,
      paymentMethod,
    };

    try {
      sessionStorage.removeItem('pending_paymongo_booking');
      const result = await apiPost('/bookings/hotel', payload);
      if (result.checkout?.checkoutUrl) {
        sessionStorage.setItem('pending_paymongo_booking', JSON.stringify({
          type: 'hotel',
          id: result.reservation.id,
          sessionId: result.checkout.id,
          time: Date.now(),
        }));
        window.location.href = result.checkout.checkoutUrl;
        return;
      }
      showAlert('success', `You completed a booking! ${result.message} for ${result.pets.map((pet) => pet.name).join(', ')}. Reference #${result.reservation.id}. ${fmtDate(result.reservation.checkIn)} → ${fmtDate(result.reservation.checkOut)}, total ${fmtMoney(result.reservation.totalPrice)}.`);
      form.reset();
      selectedHotelSlots.clear();
      petCount.value = '1';
      renderPetFields();
      applyCheckInDates();
      updatePrice();
      await loadCustomerProfile();
    } catch (error) {
      showAlert('error', `${error.message}`);
    } finally {
      syncReservationButton();
      submitBtn.textContent = 'Reserve Stay';
    }
  });
})();