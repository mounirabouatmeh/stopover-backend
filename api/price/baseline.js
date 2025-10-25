// /api/price/baseline.js
// Returns baseline fare for origin <-> dest (dynamic), choosing earliest dates within provided windows.

import { flightOffersRoundTripWithToken } from "../_lib/amadeus.js";

function pickEarliest(dateRange) {
  // dateRange: ["YYYY-MM-DD","YYYY-MM-DD"] or single "YYYY-MM-DD"
  if (!dateRange) return null;
  if (Array.isArray(dateRange)) return dateRange[0];
  return dateRange;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const {
      origin,
      dest,                 // <-- NEW dynamic destination
      depart_window,        // ["YYYY-MM-DD","YYYY-MM-DD"] or "YYYY-MM-DD"
      return_window,        // ["YYYY-MM-DD","YYYY-MM-DD"] or "YYYY-MM-DD"
      adults = 1,
      currency = "CAD",
      cabin = "ECONOMY",
    } = await parseBody(req);

    assertIata(origin, "origin");
    assertIata(dest, "dest"); // ensure provided
    const departDate = pickEarliest(depart_window);
    const returnDate = pickEarliest(return_window);
    if (!departDate || !returnDate) {
      return res.status(400).json({ error: "depart_window and return_window are required" });
    }

    const json = await flightOffersRoundTripWithToken({
      origin,
      dest,
      departDate,
      returnDate,
      adults,
      currencyCode: currency,
      cabin,
    });

    const cheapest = extractCheapest(json);
    return res.status(200).json({
      currency,
      query: { origin, dest, departDate, returnDate, adults, cabin },
      baseline: cheapest,
      rawCount: Array.isArray(json?.data) ? json.data.length : 0,
      env: process.env.AMADEUS_ENV || "test",
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
}

async function parseBody(req) {
  try {
    return typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return {};
  }
}

function assertIata(code, label) {
  if (!code || typeof code !== "string" || code.length !== 3) {
    throw new Error(`${label} must be a 3-letter IATA code`);
  }
}

function extractCheapest(json) {
  const offers = Array.isArray(json?.data) ? json.data : [];
  if (offers.length === 0) return null;
  // price.total usually present
  offers.sort((a, b) => Number(a?.price?.total ?? Infinity) - Number(b?.price?.total ?? Infinity));
  const top = offers[0];
  return {
    total: top?.price?.total ?? null,
    currency: top?.price?.currency ?? null,
    validatingAirlineCodes: top?.validatingAirlineCodes ?? [],
  };
}
