// Hotel reservation page logic
const ROOM_PRICES = {
  'staycation-standard': 500,
  'staycation-deluxe': 800,
};

  const ROOM_DETAILS = {
    'day-care-standard': { category: 'Day Care', size: 'Small', occupancy: 1, amenities: ['Play area', 'Air Conditioning', 'Treats'], description: 'Standard hourly day care — weekday ₱55 / weekend ₱76 per hour' },
    'day-care-deluxe': { category: 'Day Care', size: 'Medium', occupancy: 1, amenities: ['Play area', 'Air Conditioning', 'Treats', 'Enrichment toys'], description: 'Deluxe hourly day care — weekday ₱80 / weekend ₱100 per hour' },
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
  let roomAvailable = false;
  let availabilityRequest = 0;

  const populateTimeOptions = (select, selectedValue) => {
    const openHour = 9;
    const closeHour = 18;
    select.innerHTML = Array.from({ length: closeHour - openHour }, (_, index) => {
      const hour = openHour + index;
      const value = `${String(hour).padStart(2, '0')}:00`;
      const labelHour = hour % 12 || 12;
      const period = hour >= 12 ? 'PM' : 'AM';
      return `<option value="${value}"${value === selectedValue ? ' selected' : ''}>${labelHour}:00 ${period}</option>`;
    }).join('');
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
    const totalPerNight = pets.reduce((sum, pet) => sum + (ROOM_PRICES[pet.roomType] || 0), 0);
    const total = nights > 0 ? totalPerNight * nights : 0;
    const petText = pets.map((pet) => `${pet.name || 'Unnamed pet'} (${pet.species}, age ${pet.age ?? 'not entered'}, ${pet.breed || 'breed not entered'})`).join(', ');
    const rows = [
      ...pets.map((pet, index) => {
        const roomField = petFields.querySelector(`[name="roomType-${index}"]`);
        const roomText = roomField?.options[roomField.selectedIndex]?.textContent || pet.roomType;
        return [`${pet.name || `Pet ${index + 1}`} room`, `${roomText} — ${fmtMoney(ROOM_PRICES[pet.roomType] || 0)} / night`];
      }),
      ['Pets', petText],
      ['Check-in', `${fmtDate(checkInInput.value)} at ${checkInTime.value}`],
      ['Check-out', `${fmtDate(checkOutInput.value)} at ${checkOutTime.value}`],
      ['Price per night', fmtMoney(totalPerNight)],
      ['Nights', String(nights > 0 ? nights : 0)],
      ['Special care', form.notes.value || 'Not entered'],
      ['Total', nights > 0 ? fmtMoney(total) : 'Check-out must be after check-in'],
    ];

    summaryBox.innerHTML = `
      <div class="form-section-label">Booking Summary</div>
      <div class="summary-card">
        ${rows.map(([label, value]) => `
          <div class="summary-row">
            <span>${escapeSummary(label)}</span>
            <strong>${escapeSummary(value)}</strong>
          </div>
        `).join('')}
      </div>
    `;
  };

  const localDate = (date) => {
    const copy = new Date(date);
    copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
    return copy.toISOString().slice(0, 10);
  };
  const today = localDate(new Date());

  const applyCheckInDates = () => {
    checkInInput.min = today;
    const checkIn = checkInInput.value;
    checkOutInput.min = checkIn || today;
    if (checkIn && checkOutInput.value && checkOutInput.value <= checkIn) {
      const nextNight = new Date(`${checkIn}T00:00:00`);
      nextNight.setDate(nextNight.getDate() + 1);
      checkOutInput.value = localDate(nextNight);
    }
  };
  applyCheckInDates();

  const updatePrice = () => {
    if (!pricePreview) return;
    const nights = Math.round((new Date(checkOutInput.value) - new Date(checkInInput.value)) / 864e5);
    if (nights > 0) {
      const pets = collectPets();
      const total = pets.reduce((sum, pet) => sum + (ROOM_PRICES[pet.roomType] || 0), 0) * nights;
      pricePreview.textContent = `${nights} night${nights > 1 ? 's' : ''} × selected room rates = ${fmtMoney(total)}`;
    } else {
      pricePreview.textContent = 'Check-out must be after check-in';
    }
  };
  const renderPetFields = () => {
    petFields.innerHTML = Array.from({ length: Math.max(1, Math.min(5, Number(petCount.value) || 1)) }, (_, index) => `
      <div class="field full"><strong>Pet ${index + 1}</strong></div>
      <div class="field"><label for="pet-name-${index}">Pet Name *</label><input id="pet-name-${index}" name="petName-${index}" required /></div>
      <div class="field"><label for="pet-species-${index}">Species *</label><select id="pet-species-${index}" name="species-${index}"><option value="dog">Dog</option><option value="cat">Cat</option></select></div>
      <div class="field"><label for="pet-breed-${index}">Breed *</label><input id="pet-breed-${index}" name="breed-${index}" required /></div>
      <div class="field"><label for="pet-age-${index}">Age (years) *</label><input id="pet-age-${index}" name="age-${index}" type="number" min="0" max="50" required /></div>
      <div class="field full"><label for="pet-room-${index}">Room for Pet ${index + 1} *</label><select id="pet-room-${index}" name="roomType-${index}" required>${roomSelect.innerHTML}</select></div>
    `).join('');
  };
  const collectPets = () => Array.from({ length: Math.max(1, Math.min(5, Number(petCount.value) || 1)) }, (_, index) => {
    const petField = (fieldName) => petFields.querySelector(`[name="${fieldName}-${index}"]`);
    return {
      name: petField('petName')?.value.trim() || '',
      species: petField('species')?.value || 'dog',
      breed: petField('breed')?.value.trim() || null,
      age: petField('age')?.value ? Number(petField('age').value) : null,
      roomType: petField('roomType')?.value || roomSelect.value,
    };
  });


// Real-time room availability check
const checkAvailability = async () => {
  const roomTypes = [...new Set(collectPets().map((pet) => pet.roomType).filter(Boolean))];
  const checkIn = checkInInput.value;
  const checkOut = checkOutInput.value;
  const requestId = ++availabilityRequest;
  roomAvailable = false;
  submitBtn.disabled = true;
  if (!roomTypes.length || !checkIn || !checkOut) return;
  try {
    const results = await Promise.all(roomTypes.map(async (roomType) => {
      const query = new URLSearchParams({ roomType, checkIn, checkOut });
      const res = await fetch(`/api/v1/bookings/hotel/availability?${query}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not check room availability');
      return data;
    }));
    if (requestId !== availabilityRequest) return;
    const badge = document.getElementById('availability-badge');
    roomAvailable = results.every((result) => result.available);
    submitBtn.disabled = !roomAvailable;
    if (!badge) return;
    if (roomAvailable) {
      badge.textContent = '✓ All selected rooms are available';
      badge.style.color = '#1a6b4a';
    } else {
      badge.textContent = '✗ One or more selected room types are unavailable for these dates';
      badge.style.color = '#c0392b';
    }
  } catch (err) {
    console.warn('Could not check availability:', err);
    if (requestId === availabilityRequest) submitBtn.disabled = true;
  }
};

[checkInTime, checkOutTime].forEach((el) => el.addEventListener('change', renderOrderSummary));
  form.addEventListener('input', renderOrderSummary);
  petFields.addEventListener('change', () => { updatePrice(); checkAvailability(); renderOrderSummary(); });
  checkInInput.addEventListener('change', () => { updatePrice(); checkAvailability(); renderOrderSummary(); });
  checkOutInput.addEventListener('change', () => {
    if (checkInInput.value && checkOutInput.value && checkOutInput.value <= checkInInput.value) applyCheckInDates();
    updatePrice();
    checkAvailability();
    renderOrderSummary();
  });
  checkInInput.addEventListener('change', applyCheckInDates);
  petCount.addEventListener('change', () => { renderPetFields(); updatePrice(); checkAvailability(); renderOrderSummary(); });
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

  const checkAndCancelPendingPayMongo = async () => {
    const params = new URLSearchParams(window.location.search);
    const wasCancelled = params.get('payment') === 'cancelled';
    const raw = sessionStorage.getItem('pending_paymongo_booking');
    let cancelledAny = false;

    if (raw) {
      sessionStorage.removeItem('pending_paymongo_booking');
      try {
        const pending = JSON.parse(raw);
        if (pending && pending.id) {
          await apiPost('/payments/cancel', { bookingType: pending.type || 'hotel', bookingId: pending.id });
          cancelledAny = true;
        }
      } catch (e) {
        console.warn('Could not void pending reservation:', e);
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
    if (!roomAvailable) {
      showAlert('error', 'That room is not available for the selected dates. Please choose different dates or another room.');
      return;
    }
    if (!checkInInput.value || !checkOutInput.value) {
      showAlert('error', 'Please provide both check-in and check-out dates.');
      return;
    }
    if (checkOutInput.value <= checkInInput.value) {
      showAlert('error', 'Check-out must be after check-in.');
      applyCheckInDates();
      updatePrice();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Reserving...';

    const payload = {
      customer: {
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        phone: form.phone.value.trim(),
        address: form.address.value.trim() || null,
      },
      pets: collectPets(),
      roomType: collectPets()[0]?.roomType || roomSelect.value,
      checkIn: checkInInput.value,
      checkInTime: checkInTime.value,
      checkOut: checkOutInput.value,
      checkOutTime: checkOutTime.value,
      notes: form.notes.value.trim() || null,
      paymentMethod: form.paymentMethod.value,
    };

    try {
      sessionStorage.removeItem('pending_paymongo_booking');
      const result = await apiPost('/bookings/hotel', payload);
      if (result.checkout?.checkoutUrl) {
        sessionStorage.setItem('pending_paymongo_booking', JSON.stringify({
          type: 'hotel',
          id: result.reservation.id,
          time: Date.now(),
        }));
        window.location.href = result.checkout.checkoutUrl;
        return;
      }
      showAlert('success', `You completed a booking! ${result.message} for ${result.pets.map((pet) => pet.name).join(', ')}. Reference #${result.reservation.id}. ${fmtDate(result.reservation.checkIn)} → ${fmtDate(result.reservation.checkOut)}, total ${fmtMoney(result.reservation.totalPrice)}.`);
      form.reset();
      petCount.value = '1';
      renderPetFields();
      applyCheckInDates();
      updatePrice();
    } catch (error) {
      showAlert('error', `${error.message}`);
    } finally {
      submitBtn.disabled = !roomAvailable;
      submitBtn.textContent = 'Reserve Stay';
    }
  });