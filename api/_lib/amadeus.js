// api/_lib/amadeus.js
// Vercel serverless-friendly helpers with per-invocation token reuse + fetch timeout

const HOST = (env) => env === "production" ? "https://api.amadeus.com" : "https://test.api.amadeus.com";

/** Fetch with timeout (ms) to avoid hanging requests */
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

export async function getTokenOnce() {
  const host = HOST(process.env.AMADEUS_ENV || "test");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.AMADEUS_CLIENT_ID,
    client_secret: process.env.AMADEUS_CLIENT_SECRET,
  });

  const r = await fetchWithTimeout(`${host}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  }, 8000);

  const data = await r.json();
  if (!r.ok) throw new Error(`Amadeus token error: ${r.status} ${JSON.stringify(data)}`);
  return { token: data.access_token, host };
}

/** Multi-city search using a provided token and host (avoid re-auth per tuple) */
export async function flightOffersMultiCityWithToken({ host, token, originDestinations, currency = "CAD" }) {
  const payload = {
    currencyCode: currency,
    travelers: [{ id: "1", travelerType: "ADULT" }],
    sources: ["GDS"],
    searchCriteria: { maxFlightOffers: 10 }, // tighter for speed
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
  if (!r.ok) throw new Error(`Amadeus search error: ${r.status} ${JSON.stringify(data)}`);
  return data;
}

export function buildGFlightsDeeplink(A, T, B, [d0, a1, b1, a2]) {
  const fmt = (d) => new Date(d).toISOString().slice(0, 10);
  return `https://www.google.com/travel/flights?hl=en#flt=${A}.${T}.${fmt(d0)}*${T}.${B}.${fmt(a1)}*${B}.${T}.${fmt(b1)}*${T}.${A}.${fmt(a2)}`;
}
