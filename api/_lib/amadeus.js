// api/_lib/amadeus.js

import fetch from "node-fetch";
import { fetchWithTimeout } from "./http.js";

let cachedToken = null;
let tokenExpiry = 0;

/**
 * Retrieve and cache Amadeus OAuth2 token
 */
export async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await fetch("https://api.amadeus.com/v1/security/oauth2/token", {
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

/**
 * Get round-trip baseline offers
 */
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

  const url = `https://api.amadeus.com/v2/shopping/flight-offers?originLocationCode=${origin}&destinationLocationCode=${dest}&departureDate=${departDate}&returnDate=${returnDate}&adults=${adults}&travelClass=${cabin}&currencyCode=${currency}&max=50`;

  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  return res.json();
}

/**
 * Get multi-city stopover offers
 * legs = [{ origin, destination, departureDate }, ...]
 */
export async function flightOffersMultiCity({
  legs,
  adults,
  cabin,
  currency
}) {
  const token = await getToken();

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
        date: leg.departureDate,
        time: "00:00:00-23:59:59"
      }
    })),
    searchCriteria: {
      flightFilters: {
        cabinRestrictions: [
          {
            cabin, // ECONOMY, BUSINESS, etc.
            originDestinationIds: [] // apply to all legs
          }
        ]
      },
      maxFlightOffers: 50
    }
  };

  const res = await fetchWithTimeout(
    "https://api.amadeus.com/v2/shopping/flight-offers",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  return res.json();
}
