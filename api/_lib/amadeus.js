// /api/_lib/amadeus.js

// Select the correct Amadeus base URL from env
const AMADEUS_BASE =
  process.env.AMADEUS_ENV === "production"
    ? "https://api.amadeus.com"
    : "https://test.api.amadeus.com";

// In-memory token cache
let _token = null;
let _tokenExp = 0;

/**
 * Fetch and cache an Amadeus OAuth token.
 * Throws if AMADEUS_API_KEY/AMADEUS_API_SECRET are missing or token fetch fails.
 */
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
  _tokenExp = now + (data.expires_in || 1700);
  return _token;
}

/**
 * Direct round-trip pricing: origin <-> dest
 * (Used by baseline endpoint.)
 */
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

  const url = new URL(`${AMADEUS_BASE}/v2/shopping/flight-offers`);
  url.searchParams.set("originLocationCode", origin);
  url.searchParams.set("destinationLocationCode", dest);
  url.searchParams.set("departureDate", departDate);
  url.searchParams.set("returnDate", returnDate);
  url.searchParams.set("adults", String(adults));
  url.searchParams.set("travelClass", cabin);
  url.searchParams.set("currencyCode", currencyCode);
  url.searchParams.set("max", "50");

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Amadeus baseline error: ${resp.status} ${text}`);
  }

  return resp.json();
}

/**
 * Multi-city search (e.g., A -> T1 -> DEST -> T1 -> A).
 * Includes required originDestinationIds in cabinRestrictions (Amadeus 400 fix).
 */
export async function flightOffersMultiCityWithToken({
  slices, // Array<{origin, dest, date}> (YYYY-MM-DD)
  adults = 1,
  currencyCode = "CAD",
  cabin = "ECONOMY",
}) {
  const token = await getTokenOnce();

  // Amadeus multi-city requires originDestinations with stable IDs ("1","2",...)
  const originDestinations = slices.map((s, idx) => ({
    id: String(idx + 1),
    originLocationCode: s.origin,
    destinationLocationCode: s.dest,
    departureDateTimeRange: { date: s.date }, // YYYY-MM-DD
  }));

  // Cabin restrictions must reference the slice IDs we created above
  const cabinRestrictions = [
    {
      cabin, // "ECONOMY" | "PREMIUM_ECONOMY" | "BUSINESS" | "FIRST"
      coverage: "MOST_SEGMENTS", // or "ALL_SEGMENTS"
      originDestinationIds: originDestinations.map((od) => od.id),
    },
  ];

  const body = {
    currencyCode,
    travelers: [{ id: "1", travelerType: "ADULT" }],
    sources: ["GDS"],
    originDestinations,
    searchCriteria: {
      flightFilters: { cabinRestrictions },
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

/**
 * Google Flights deeplink (best-effort).
 * Example: https://www.google.com/flights?hl=en#flt=YUL.CDG.20251120/CDG.ATH.20251122/...
 */
export function buildGFlightsDeeplink({ slices }) {
  const parts = slices
    .map((s) => `${s.origin}.${s.dest}.${s.date.replace(/-/g, "")}`)
    .join("/");
  return `https://www.google.com/flights?hl=en#flt=${parts}`;
}

/**
 * Backward-compat export so existing imports still work:
 *   import { flightOffersRoundTripWithToken } from "../_lib/amadeus.js";
 */
export { flightOffersWithToken as flightOffersRoundTripWithToken };
