// api/_lib/amadeus.js
// Serverless-friendly Amadeus helpers with per-invocation token reuse + fetch timeouts

const HOST = (env) => (env === "production" ? "https://api.amadeus.com" : "https://test.api.amadeus.com");

/** Fetch with timeout to avoid hanging requests */
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export async function getTokenOnce() {
  const env = process.env.AMADEUS_ENV || "test";
  const host = HOST(env);

  const r = await fetchWithTimeout(`${host}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.AMADEUS_CLIENT_ID,
      client_secret: process.env.AMADEUS_CLIENT_SECRET
    })
  }, 8000);

  const data = await r.json();
  if (!r.ok) throw new Error(`Amadeus token error: ${r.status} ${JSON.stringify(data)}`);
  return { token: data.access_token, host };
}

/** Multi-city (4 slices) with a provided token */
export async function flightOffersMultiCityWithToken({ host, token, originDestinations, currency = "CAD" }) {
  const payload = {
    currencyCode: currency,
    travelers: [{ id: "1", travelerType: "ADULT" }],
    sources: ["GDS"],
    searchCriteria: { maxFlightOffers: 10 },
    originDestinations
  };

  const r = await fetchWithTimeout(`${host}/v2/shopping/flight-offers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  }, 8000);

  const data = await r.json();
  if (!r.ok) throw new Error(`Amadeus multi error: ${r.status} ${JSON.stringify(data)}`);
  return data;
}

/** Round-trip (2 slices) with a provided token */
export async function flightOffersRoundTripWithToken({ host, token, origin, destination, outDate, inDate, currency = "CAD" }) {
  const originDestinations = [
    { id: "1", originLocationCode: origin, destinationLocationCode: destination, departureDateTimeRange: { date: outDate } },
    { id: "2", originLocationCode: destination, destinationLocationCode: origin, departureDateTimeRange: { date: inDate } }
  ];

  const payload = {
    currencyCode: currency,
    travelers: [{ id: "1", travelerType: "ADULT" }],
    sources: ["GDS"],
    searchCriteria: { maxFlightOffers: 10 },
    originDestinations
  };

  const r = await fetchWithTimeout(`${host}/v2/shopping/flight-offers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  }, 8000);

  const data = await r.json();
  if (!r.ok) throw new Error(`Amadeus rt error: ${r.status} ${JSON.stringify(data)}`);
  return data;
}

export function buildGFlightsDeeplink(A, T, B, [d0, a1, b1, a2]) {
  const fmt = (d) => new Date(d).toISOString().slice(0, 10);
  return `https://www.google.com/travel/flights?hl=en#flt=${A}.${T}.${fmt(d0)}*${T}.${B}.${fmt(a1)}*${B}.${T}.${fmt(b1)}*${T}.${A}.${fmt(a2)}`;
}
