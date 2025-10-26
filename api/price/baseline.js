// /api/price/baseline.js
// Returns a direct round-trip baseline fare between origin and dest
// Uses earliest dates if ranges are provided.

import { flightOffersRoundTripWithToken } from "../_lib/amadeus.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const {
      origin,
      dest,
      depart_window,
      return_window,
      adults = 1,
      cabin = "ECONOMY",
      currency = "CAD"
    } = body;

    // --- basic validation ---
    if (!origin || origin.length !== 3) throw new Error("origin required");
    if (!dest || dest.length !== 3) throw new Error("dest required");
    if (!depart_window || !return_window)
      throw new Error("depart_window and return_window required");

    // normalize single date or window array
    const departDate = Array.isArray(depart_window)
      ? depart_window[0]
      : depart_window;
    const returnDate = Array.isArray(return_window)
      ? return_window[1]
      : return_window;

    // call Amadeus for direct round-trip
    const baselineJson = await flightOffersRoundTripWithToken({
      origin,
      dest,
      departDate,
      returnDate,
      adults,
      currencyCode: currency,
      cabin
    });

    const offers = Array.isArray(baselineJson?.data)
      ? baselineJson.data
      : [];
    if (!offers.length)
      return res.status(200).json({
        env: process.env.AMADEUS_ENV || "test",
        origin,
        dest,
        departDate,
        returnDate,
        message: "No baseline offers found",
        results: []
      });

    // sort by cheapest
    offers.sort(
      (a, b) =>
        Number(a?.price?.total ?? Infinity) -
        Number(b?.price?.total ?? Infinity)
    );

    const cheapest = offers[0];
    const response = {
      env: process.env.AMADEUS_ENV || "test",
      currency,
      query: { origin, dest, departDate, returnDate, adults, cabin },
      baseline: {
        total: cheapest?.price?.total,
        currency: cheapest?.price?.currency,
        validatingAirlineCodes: cheapest?.validatingAirlineCodes ?? []
      },
      rawCount: offers.length
    };

    return res.status(200).json(response);
  } catch (err) {
    return res
      .status(500)
      .json({ error: err.message || String(err), env: process.env.AMADEUS_ENV });
  }
}
