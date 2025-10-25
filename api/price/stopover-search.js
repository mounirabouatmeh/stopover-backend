// /api/price/stopover-search.js
// Builds multi-city tuples A -> T1 -> DEST -> T1 -> A with dynamic dest,
// compares vs baseline, returns sorted cheapest itineraries with deeplinks.

import {
  flightOffersMultiCityWithToken,
  flightOffersRoundTripWithToken,
  buildGFlightsDeeplink,
} from "../_lib/amadeus.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const {
      origin,          // e.g., "YUL"
      t1,              // stopover hub, e.g., "CDG" or "ATH"
      dest,            // <-- NEW dynamic destination, e.g., "BEY" (no longer hard-coded)
      depart_window,   // ["YYYY-MM-DD","YYYY-MM-DD"]
      return_window,   // ["YYYY-MM-DD","YYYY-MM-DD"]
      z_range,         // [minDaysInDest, maxDaysInDest]
      x_range = [0, 2],// [min pre-stopover days at T1]
      y_range = [0, 2],// [min post-stopover days at T1]
      adults = 1,
      currency = "CAD",
      cabin = "ECONOMY",
      max_tuples = 30, // safety cap
    } = await parseBody(req);

    // Validate
    assertIata(origin, "origin");
    assertIata(t1, "t1");
    assertIata(dest, "dest"); // required now
    assertDateRange(depart_window, "depart_window");
    assertDateRange(return_window, "return_window");
    assertNumRange(z_range, "z_range");

    // Generate candidate tuples
    const tuples = buildTuples({
      departRange: depart_window,
      returnRange: return_window,
      xRange: x_range,
      zRange: z_range,
      yRange: y_range,
      maxTuples: max_tuples,
    });

    // Query multi-city offers per tuple
    const results = [];
    for (const t of tuples) {
      // slices: [A->T1, T1->DEST, DEST->T1, T1->A]
      const slices = [
        { origin, dest: t1,  date: t.a_to_t1 },
        { origin: t1, dest,  date: t.t1_to_dest },
        { origin: dest, dest: t1, date: t.dest_to_t1 },
        { origin: t1, dest: origin, date: t.t1_to_a },
      ];

      try {
        const multi = await flightOffersMultiCityWithToken({
          slices,
          adults,
          currencyCode: currency,
          cabin,
        });
        const cheapest = pickCheapest(multi);
        if (!cheapest) continue;

        // Align baseline to the DEST leg arrival/departure (best-effort)
        const baselineJson = await flightOffersRoundTripWithToken({
          origin,
          dest,
          departDate: t.t1_to_dest,  // first arrival into DEST date baseline approx
          returnDate: t.dest_to_t1,  // first departure out of DEST date baseline approx
          adults,
          currencyCode: currency,
          cabin,
        });
        const baseline = extractCheapest(baselineJson);

        results.push({
          tuple: t,
          price: cheapest?.total ?? null,
          currency,
          deeplink: buildGFlightsDeeplink({ slices }),
          baseline,
          delta_vs_baseline:
            baseline?.total ? (Number(cheapest?.total ?? 0) - Number(baseline.total)) : null,
          validatingAirlineCodes: cheapest?.validatingAirlineCodes ?? [],
        });
      } catch (e) {
        // Skip tuple on failure, continue
        // (You can log e.message to an observability sink if desired)
      }
    }

    // Sort by cheapest total
    results.sort((a, b) => Number(a.price ?? Infinity) - Number(b.price ?? Infinity));

    return res.status(200).json({
      env: process.env.AMADEUS_ENV || "test",
      currency,
      origin,
      t1,
      dest, // echo back
      constraints: { depart_window, return_window, x_range, z_range, y_range, cabin, adults },
      baseline_hint: "Baseline computed per-tuple using DEST segment dates.",
      results,
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
function assertDateRange(r, label) {
  if (!Array.isArray(r) || r.length !== 2) {
    throw new Error(`${label} must be ["YYYY-MM-DD","YYYY-MM-DD"]`);
  }
}
function assertNumRange(r, label) {
  if (!Array.isArray(r) || r.length !== 2) {
    throw new Error(`${label} must be [min,max]`);
  }
}

// Naive date helpers (YYYY-MM-DD only)
function addDays(iso, d) {
  const dt = new Date(iso + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + d);
  return dt.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  const A = new Date(a + "T00:00:00Z");
  const B = new Date(b + "T00:00:00Z");
  return Math.round((B - A) / 86400000);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// Build tuples ensuring chronological order across windows and x/z/y constraints.
function buildTuples({ departRange, returnRange, xRange, zRange, yRange, maxTuples }) {
  const [departStart, departEnd] = departRange;
  const [returnStart, returnEnd] = returnRange;

  const tuples = [];
  const maxPerStart = Math.max(1, Math.floor(maxTuples / 5));

  // Iterate possible outbound start days within depart window
  const totalDepartDays = clamp(daysBetween(departStart, departEnd) + 1, 1, 31);
  for (let d = 0; d < totalDepartDays; d++) {
    const a_to_t1 = addDays(departStart, d);

    // Try a few x (pre-stopover days at T1)
    for (let x = xRange[0]; x <= xRange[1]; x++) {
      const t1_to_dest = addDays(a_to_t1, Math.max(0, x));

      // Try z (days in DEST)
      for (let z = zRange[0]; z <= zRange[1]; z++) {
        const dest_to_t1 = addDays(t1_to_dest, Math.max(1, z));

        // Try y (post-stopover days at T1)
        for (let y = yRange[0]; y <= yRange[1]; y++) {
          const t1_to_a = addDays(dest_to_t1, Math.max(0, y));

          // Must fit inside return window
          if (t1_to_a < returnStart || t1_to_a > returnEnd) continue;

          tuples.push({ a_to_t1, t1_to_dest, dest_to_t1, t1_to_a, x, z, y });
          if (tuples.length >= maxTuples) return tuples;
        }
      }
    }

    if (tuples.length >= maxPerStart) continue; // limit fan-out per start day
  }
  return tuples.slice(0, maxTuples);
}

function pickCheapest(json) {
  const offers = Array.isArray(json?.data) ? json.data : [];
  if (!offers.length) return null;
  offers.sort((a, b) => Number(a?.price?.total ?? Infinity) - Number(b?.price?.total ?? Infinity));
  const top = offers[0];
  return {
    total: top?.price?.total ?? null,
    currency: top?.price?.currency ?? null,
    validatingAirlineCodes: top?.validatingAirlineCodes ?? [],
  };
}
function extractCheapest(json) {
  const offers = Array.isArray(json?.data) ? json.data : [];
  if (!offers.length) return null;
  offers.sort((a, b) => Number(a?.price?.total ?? Infinity) - Number(b?.price?.total ?? Infinity));
  const top = offers[0];
  return {
    total: top?.price?.total ?? null,
    currency: top?.price?.currency ?? null,
    validatingAirlineCodes: top?.validatingAirlineCodes ?? [],
  };
}
