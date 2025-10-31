// api/price/baseline.js

import { checkAuth } from "../_lib/auth.js";
import { flightOffersRoundTrip } from "../_lib/amadeus.js";

export default async function handler(req, res) {
  // Enforce bearer auth
  if (!checkAuth(req, res)) return;

  const {
    origin,
    dest,
    depart_window,
    return_window,
    adults = 1,
    cabin = "ECONOMY",
    currency = "CAD"
  } = req.body;

  const departDate = depart_window?.[0];
  const returnDate = return_window?.[0];

  if (!origin || !dest || !departDate || !returnDate) {
    return res.status(400).json({
      error: "Missing required fields: origin, dest, depart_window[0], return_window[0]"
    });
  }

  try {
    const data = await flightOffersRoundTrip({
      origin,
      dest,
      departDate,
      returnDate,
      adults,
      cabin,
      currency
    });

    const offers = data?.data ?? [];

    if (!offers.length) {
      return res.json({
        error: "No offers found",
        query: { origin, dest, departDate, returnDate, adults, cabin }
      });
    }

    // Pick the cheapest offer explicitly
    const cheapest = offers.reduce(
      (min, o) =>
        parseFloat(o.price.total) < parseFloat(min.price.total) ? o : min,
      offers[0]
    );

    return res.json({
      currency,
      query: { origin, dest, departDate, returnDate, adults, cabin },
      baseline: {
        total: cheapest.price.total,
        currency,
        validatingAirlineCodes: cheapest.validatingAirlineCodes
      }
    });
  } catch (err) {
    console.error("Baseline error:", err);
    return res.status(502).json({
      error: "Failed to fetch baseline offers",
      details: err.message
    });
  }
}
