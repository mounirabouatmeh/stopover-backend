// /api/_lib/amadeus.js
// Minimal, production-safe helper used by baseline/stopover-search.
// Assumes AMADEUS_ENV=test|production, AMADEUS_API_KEY/SECRET set in Vercel.

const AMADEUS_BASE = (process.env.AMADEUS_ENV || "test") === "production"
  ? "https://api.amadeus.com"
  : "https://test.api.amadeus.com";

let _token = null;
let _tokenExp = 0;

export async function getTokenOnce() {
  const now = Math.floor(Date.now() / 1000);
  if (_token && now < _tokenExp - 30) return _token;

  const client_id = process.env.AMADEUS_API_KEY;
  const client_secret = process.env.AMADEUS_API_SECRET;
  if (!client_id || !client_secret) {
    throw new Error("Amadeus credentials missing: AMADEUS_API_KEY/SECRET");
  }

  const resp = await fetch(`${AMADEUS_BASE}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id,
      client_secret,
    }).toString(),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Amadeus token error: ${resp.status} ${t}`);
  }
  const json = await resp.json();
  _token = json.access_token;
  _tokenExp = Math.floor(Date.now() / 1000) + (json.expires_in || 1700);
  return _token;
}

// Round trip baseline: origin <-> dest
export async function flightOffersRoundTripWithToken({
  origin,
  dest,
  departDate,
  returnDate,
  adults = 1,
  currencyCode = "CAD",
  cabin = "ECONOMY",
}) {
  const token = await getTokenOnce();
  const url = new URL(`${AMADEUS_BASE}/v2/shopping/flight-offers`);
  url.searchParams.set("originLocationCode", origin);
  url.searchParams.set("destinationLocationCode", dest);
  url.searchParams.set("departureDate", departDate);
  url.searchParams.set("returnDate", returnDate);
  url.searchParams.set("adults", String(adults));
  url.searchParams.set("currencyCode", currencyCode);
  url.searchParams.set("travelClass", cabin);
  url.searchParams.set("nonStop", "false");
  url.searchParams.set("max", "50");

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Amadeus round-trip error: ${resp.status} ${t}`);
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
  const body = {
    currencyCode,
    travelers: [{ id: "1", travelerType: "ADULT" }],
    sources: ["GDS"],
    searchCriteria: {
      flightFilters: {
        cabinRestrictions: [{ cabin, coverage: "MOST_SEGMENTS" }],
      },
    },
    // Amadeus "multi-city" uses an array of slices
    // Each slice = { originLocationCode, destinationLocationCode, departureDate }
    // We map our simplified {origin, dest, date} into Amadeus fields.
    originDestinations: slices.map((s, idx) => ({
      id: String(idx + 1),
      originLocationCode: s.origin,
      destinationLocationCode: s.dest,
      departureDateTimeRange: { date: s.date },
    })),
    travelersPricing: [{ travelerId: "1" }],
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
    const t = await resp.text();
    throw new Error(`Amadeus multi-city error: ${resp.status} ${t}`);
  }
  return resp.json();
}

// Simple Google Flights deeplink (best-effort).
export function buildGFlightsDeeplink({ slices }) {
  // Format: https://www.google.com/travel/flights?hl=en#flt=ORIG.DEST.DATE*...
  // We’ll chain the 4 legs with * separators.
  const parts = slices.map(s => `${s.origin}.${s.dest}.${s.date}`);
  return `https://www.google.com/travel/flights#flt=${parts.join("*")}`;
}
