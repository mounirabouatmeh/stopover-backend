// api/_lib/amadeus.js

import { fetchWithTimeout } from "./http.js";

let cachedToken = null;
let tokenExpiry = 0;

function getBaseUrl() {
  const env = (process.env.AMADEUS_ENV || "production").toLowerCase();
  return env === "test"
    ? "https://test.api.amadeus.com"
    : "https://api.amadeus.com";
}

export async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const baseUrl = getBaseUrl();
  const res = await fetch(`${baseUrl}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.AMADEUS_API_KEY,
      client_secret: process.env.AMADEUS_API_SECRET
    })
  });

  const data = await res.json();
  if (!res.ok || !data?.access_token) {
    throw new Error(
      `Amadeus token error: ${res.status} ${JSON.stringify(data)}`
    );
  }

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + ((data.expires_in ?? 1800) - 60) * 1000;
  return cachedToken;
}

export async function flightOffersRoundTrip({
  origin,
  dest,
  departDate,
  returnDate,
  adults,
  cabin,
  currency
}) {
  const token = await getToken();
  const baseUrl = getBaseUrl();

  const url = `${baseUrl}/v2/shopping/flight-offers?originLocationCode=${origin}&destinationLocationCode=${dest}&departureDate=${departDate}&returnDate=${returnDate}&adults=${adults}&travelClass=${cabin}&currencyCode=${currency}&max=50`;

  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  return res.json();
}

export async function flightOffersMultiCity({ legs, adults, cabin, currency }) {
  const token = await getToken();
  const baseUrl = getBaseUrl();

  const body = {
    currencyCode: currency,
    sources: ["GDS"],
    travelers: Array.from({ length: adults }).map((_, i) => ({
      id: String(i + 1),
      travelerType: "ADULT"
    })),
    originDestinations: legs.map((leg, idx) => ({
      id: String(idx + 1),
      originLocationCode: leg.origin,
      destinationLocationCode: leg.destination,
      departureDateTimeRange: {
        date: leg.departureDate // ✅ only date, no time
      }
    })),
    searchCriteria: {
      flightFilters: {
        cabinRestrictions: [
          {
            cabin,
            originDestinationIds: legs.map((_, idx) => String(idx + 1)) // ✅ ["1","2","3","4"]
          }
        ]
      },
      maxFlightOffers: 50
    }
  };

  const res = await fetchWithTimeout(`${baseUrl}/v2/shopping/flight-offers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  return res.json();
}
