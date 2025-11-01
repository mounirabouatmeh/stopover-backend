// api/price/baseline.js

import { checkAuth } from "../_lib/auth.js";
import { flightOffersRoundTrip } from "../_lib/amadeus.js";

function parseDate(s) {
  return new Date(`${s}T00:00:00Z`);
}
function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Iterate through all departure/return date pairs in the given windows,
 * call Amadeus for each, and return the cheapest overall itinerary.
 */
export default async function handler(req, res) {
  if (!checkAuth(req, res)) return;

  const {
    origin,
    dest,
    depart_window,
    return_window,
    adults = 1,
    cabin = "ECONOMY",
    currency = "CAD"
  } = req.body || {};

  if (!origin || !dest || !depart_window?.length || !return_window?.length) {
    return res.status(400).json({
      error: "Missing required fields: origin, dest, depart_window, return_window"
    });
  }

  try {
    const departStart = parseDate(depart_window[0]);
    const departEnd = parseDate(depart_window[depart_window.length - 1]);
    const returnStart = parseDate(return_window[0]);
    const returnEnd = parseDate(return_window[return_window.length - 1]);

    let cheapest = null;

    // Iterate over all date pairs
    for (
      let d = new Date(departStart);
      d <= departEnd;
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      for (
        let r = new Date(returnStart);
        r <= returnEnd;
        r.setUTCDate(r.getUTCDate() + 1)
      ) {
        // Ensure return is after depart
        if (r <= d) continue;

        const departDate = fmtDate(d);
        const returnDate = fmtDate(r);

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
        if (!offers.length) continue;

        // Find cheapest in this batch
        const localCheapest = offers.reduce(
          (min, o) =>
            parseFloat(o.price.total) < parseFloat(min.price.total) ? o : min,
          offers[0]
        );

        if (
          !cheapest ||
          parseFloat(localCheapest.price.total) <
            parseFloat(cheapest.price.total)
        ) {
          cheapest = {
            ...localCheapest,
            departDate,
            returnDate
          };
        }
      }
    }

    if (!cheapest) {
      return res.json({
        currency,
        query: { origin, dest, depart_window, return_window, adults, cabin },
        baseline: null,
        info: "No offers found for any date combination in the given windows"
      });
    }

    // Return enriched baseline details
    return res.json({
      currency,
      query: {
        origin,
        dest,
        depart_window,
        return_window,
        adults,
        cabin
      },
      baseline: {
        total: cheapest.price.total,
        currency,
        validatingAirlineCodes: cheapest.validatingAirlineCodes || [],
        numberOfBookableSeats: cheapest.numberOfBookableSeats || null,
        itineraries: cheapest.itineraries || [],
        chosenDates: {
          departDate: cheapest.departDate,
          returnDate: cheapest.returnDate
        }
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
