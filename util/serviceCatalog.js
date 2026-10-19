// Glam Grooms official service catalog.
// Single source of truth for the four menus shown on the service flyers:
//   1. Grooming & Spa (Basic / Full / Premium + A La Carte)
//   2. Animal Ayurveda (herbs)
//   3. Animal Ayurveda (packages)
//   4. Hotel Services (Day Care + Staycation)
//
// Prices are in Philippine Pesos (₱). Size keys: S, M, L, XL and Cat.

const SIZES = ['S', 'M', 'L', 'XL'];

const GROOMING = {
  Basic: { S: 450, M: 550, L: 700, XL: 900, Cat: 550 },
  Full:  { S: 550, M: 650, L: 900, XL: 1100, Cat: 750 },
  Premium: { S: 700, M: 800, L: 1050, XL: 1250 },
};

const A_LA_CARTE = {
  'Face Trim': 250,
  'Paw Trim': 200,
  'Nail Clipping': 90,
  'Ear Cleaning': 90,
  'Anal Sac Expressing': 120,
  'De-matting': { min: 300, max: 500 },
};

const AYURVEDA_HERBS = {
  Beauty:   { S: 600, M: 650, L: 750, XL: 800 },
  "Doctor's": { S: 700, M: 750, L: 850, XL: 900 },
  Moisture:  { S: 600, M: 650, L: 750, XL: 800 },
};

const AYURVEDA_PACKAGES = {
  'Basic Beauty/Moisture': { S: 900, M: 1050, L: 1250, XL: 1500 },
  "Basic Doctor's": { S: 1000, M: 1150, L: 1350, XL: 1600 },
  'Full Beauty/Moisture': { S: 1000, M: 1050, L: 1400, XL: 1650 },
  "Full Doctor's": { S: 1100, M: 1250, L: 1450, XL: 1700 },
  'Premium Beauty/Moisture': { S: 1150, M: 1300, L: 1550, XL: 1800 },
  "Premium Doctor's": { S: 1250, M: 1400, L: 1650, XL: 1900 },
};

const HOTEL = {
  'Day Care': {
    Standard: { weekday: 55, weekend: 76 },
    Deluxe: { weekday: 80, weekend: 100 },
  },
  'Staycation': {
    Standard: { weekday: 500, weekend: 700 },
    Deluxe: { weekday: 800, weekend: 1000 },
  },
};

const HOTEL_POLICIES = [
  '3-night minimum stay includes one complimentary bath & dry grooming session.',
  '5-night stays receive a 10% discount on the total room rate.',
  'Multi-pet bookings: 2nd pet 15% off, 3rd+ pets 25% off per night.',
  'Vaccination records must be presented at check-in (DHIA-compliant).',
  'Owners must supply their own pet food and prescribed medication.',
  'Optional comfort items (familiar blanket, toy) are welcome at no extra charge.',
];

// ---- Helpers ---------------------------------------------------------------

const isWeekend = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  return day === 0 || day === 6; // Sunday or Saturday
};

// Resolve a flat price for a given service row.
// Returns { price, label, kind, detail } or null if not found.
const resolveService = (kind, category, size, date) => {
  const table = { Grooming: GROOMING, AyurvedaHerbs: AYURVEDA_HERBS, AyurvedaPackages: AYURVEDA_PACKAGES }[kind];
  if (!table || !table[category]) return null;
  const row = table[category];
  const price = row[size];
  if (price == null) return null;
  return { kind, category, size, price, label: `${category} (${size})`, date: date || null };
};

const resolveHotel = (stayType, roomType, date) => {
  const stay = HOTEL[stayType];
  if (!stay || !stay[roomType]) return null;
  const price = isWeekend(date) ? stay[roomType].weekend : stay[roomType].weekday;
  return {
    kind: 'Hotel',
    category: stayType,
    size: roomType,
    price,
    label: `${stayType} - ${roomType}`,
    per: stayType === 'Day Care' ? 'hour' : 'night',
    date: date || null,
  };
};

const resolveAlaCarte = (name) => {
  const item = A_LA_CARTE[name];
  if (item == null) return null;
  const price = typeof item === 'object' ? item.max : item;
  return { kind: 'Grooming', category: 'A La Carte', size: name, price, label: name, date: null };
};

module.exports = {
  SIZES,
  GROOMING,
  A_LA_CARTE,
  AYURVEDA_HERBS,
  AYURVEDA_PACKAGES,
  HOTEL,
  HOTEL_POLICIES,
  isWeekend,
  resolveService,
  resolveHotel,
  resolveAlaCarte,
};