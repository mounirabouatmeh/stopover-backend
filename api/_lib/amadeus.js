// /api/_lib/amadeus.js

const AMADEUS_BASE =
  process.env.AMADEUS_ENV === "production"
    ? "https://api.amadeus.com"
    : "https://test.api.amadeus.com";

let _token = null;
let _tokenExp = 0;

// Get OAuth token and cache it
export async function getTokenOnce() {
  const now = Math.floor(Date.now() / 1000);
  if (_token && now < _tokenExp - 30) return _token;

  const client_id = process.env.AMADEUS_API_KEY;
  const client_secret = process.env.AMADEUS_API_SECRET;

  if (!client_id || !client_secret) {
    throw new Error("Missing Amadeus credentials (AMADEUS_API_KEY/SECRET)");
  }

  const resp = await fetch(`${AMADEUS_BASE}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id,
      client_secret,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Amadeus token error: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  _token = data.access_token;
  _tokenExp = now + data.expires_in;
  return _token;
}

// Baseline (round-trip) flight offers
export async function flightOffersWithToken({
  origin,
  dest,
  departDate,
  returnDate,
  adults = 1,
  currencyCode = "CAD",
  cabin = "ECONOMY",
}) {
  const token = await getTokenOnce();
  const url = `${AMADEUS_BASE}/v2/shopping/flight-offers?originLocationCode=${origin}&destinationLocationCode=${dest}&departureDate=${departDate}&returnDate=${returnDate}&adults=${adults}&travelClass=${cabin}&currencyCode=${currencyCode}&max=50`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Amadeus baseline error: ${resp.status} ${text}`);
  }

  return resp.json();
}

// Multi-city (A -> T1 -> DEST -> T1 -> A)
export async function flightOffersMultiCityWithToken({
  slices, // [{origin, dest, date}], exactly 4 for our pattern
  adults = 1,
  currencyCode = "CAD",
  cabin = "ECONOMY",
}) {
  const token = await getTokenOnce();

  // Build originDestinations with stable string IDs "1","2","3","4"
  const originDestinations = slices.map((s, idx) => ({
    id: String(idx + 1),
    originLocationCode: s.origin,
    destinationLocationCode: s.dest,
    departureDateTimeRange: { date: s.date }, // YYYY-MM-DD
  }));

  // Cabin restrictions must reference the slice IDs we just created
  const cabinRestrictions = [
    {
      cabin, // e.g., "ECONOMY"
      coverage: "MOST_SEGMENTS",
      originDestinationIds: originDestinations.map((od) => od.id),
    },
  ];

  const body = {
    currencyCode,
    travelers: [{ id: "1", travelerType: "ADULT" }],
    sources: ["GDS"],
    originDestinations,
    searchCriteria: {
      flightFilters: {
        cabinRestrictions,
      },
    },
  };

  const resp = await fetch(`${AMADEUS_BASE}/v2/shopping/flight-offers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Amadeus multi-city error: ${resp.status} ${text}`);
  }

  return resp.json();
}

// Build Google Flights deeplink
export function buildGFlightsDeeplink({ slices }) {
  const parts = slices
    .map((s) => `${s.origin}.${s.dest}.${s.date.replace(/-/g, "")}`)
    .join("/");
  return `https://www.google.com/flights?hl=en#flt=${parts}`;
}
