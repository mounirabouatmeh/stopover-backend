// api/price/stopover-search.js

import { checkAuth } from "../_lib/auth.js";
import { flightOffersRoundTrip, flightOffersMultiCity } from "../_lib/amadeus.js";

function parseDate(s) {
  return new Date(`${s}T00:00:00Z`);
}
function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}
function addDays(s, n) {
  const d = parseDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmtDate(d);
}

export default async function handler(req, res) {
  if (!checkAuth(req, res)) return;

  const {
    origin,
    t1,
    dest,
    depart_window,
    return_window,
    x_range = [0, 1],
    y_range = [0, 1],
    z_range = [7, 21],
    adults = 1,
    cabin = "ECONOMY",
    currency = "CAD",
    max_tuples = 4
  } = req.body;

  const departBase = depart_window?.[0];
  const returnBase = return_window?.[0];

  if (!origin || !t1 || !dest || !departBase || !returnBase) {
    return res.status(400).json({
      error: "Missing required fields: origin, t1, dest, depart_window[0], return_window[0]"
    });
  }

  try {
    // Build feasible leg dates
    const leg1Date = addDays(departBase, x_range[0] || 0);
    const leg2Offset = Math.max(1, (x_range[1] ?? 1));
    const leg2Date = addDays(departBase, leg2Offset);

    const minNights = z_range?.[0] ?? 7;
    const leg3Date = addDays(leg2Date, Math.max(minNights, 1));
    const leg3DateClamped = fmtDate(
      new Date(Math.min(parseDate(leg3Date).getTime(), parseDate(returnBase).getTime()))
    );

    const leg4Offset = Math.max(1, (y_range?.[0] ?? 1));
    const leg4Date = addDays(leg3DateClamped, leg4Offset);

    const legs = [
      { origin, destination: t1, departureDate: leg1Date },
      { origin: t1, destination: dest, departureDate: leg2Date },
      { origin: dest, destination: t1, departureDate: leg3DateClamped },
      { origin: t1, destination: origin, departureDate: leg4Date }
    ];

    // Baseline
    const baselineData = await flightOffersRoundTrip({
      origin,
      dest,
      departDate: departBase,
      returnDate: returnBase,
      adults,
      cabin,
      currency
    });

    const baselineOffers = baselineData?.data ?? [];
    const baselineCheapest = baselineOffers.length
      ? baselineOffers.reduce(
          (min, o) =>
            parseFloat(o.price.total) < parseFloat(min.price.total) ? o : min,
          baselineOffers[0]
        )
      : null;

    // Multi-city
    const multiData = await flightOffersMultiCity({ legs, adults, cabin, currency });

    if (multiData?.errors?.length) {
      return res.status(502).json({
        error: "Amadeus returned errors for multi-city search",
        amadeus_errors: multiData.errors,
        request_legs: legs
      });
    }

    const offers = multiData?.data ?? [];
    if (!offers.length) {
      return res.json({
        env: process.env.AMADEUS_ENV,
        origin,
        t1,
        dest,
        request_legs: legs,
        info: "No multi-city offers returned by Amadeus",
        baseline: baselineCheapest
          ? { total: baselineCheapest.price.total, currency }
          : null
      });
    }

    const results = offers.map(o => ({
      price: o.price.total,
      currency,
      deeplink: "https://www.google.com/flights?hl=en",
      baseline: baselineCheapest
        ? { total: baselineCheapest.price.total, currency }
        : null,
      delta_vs_baseline: baselineCheapest
        ? parseFloat(o.price.total) - parseFloat(baselineCheapest.price.total)
        : null
    }));

    return res.json({
      env: process.env.AMADEUS_ENV,
      origin,
      t1,
      dest,
      request_legs: legs,
      results
    });
  } catch (err) {
    console.error("Stopover search error:", err);
    return res.status(502).json({
      error: "Failed to fetch stopover offers",
      details: err.message
    });
  }
}
