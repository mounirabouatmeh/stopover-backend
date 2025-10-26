// /api/price/stopover-search.js
// Multi-city: A -> T1 -> DEST -> T1 -> A
// Now includes automatic fallback hubs if the primary T1 yields no results.

import {
  flightOffersMultiCityWithToken,
  flightOffersRoundTripWithToken,
  buildGFlightsDeeplink,
} from "../_lib/amadeus.js";

const DEFAULT_FALLBACK_HUBS = ["CDG", "ATH", "FRA", "AMS", "IST"]; // try in order

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const {
      origin,                 // e.g., "YUL"
      t1,                     // primary stopover hub (IATA)
      dest,                   // destination IATA
      depart_window,          // ["YYYY-MM-DD","YYYY-MM-DD"]
      return_window,          // ["YYYY-MM-DD","YYYY-MM-DD"]
      z_range,                // [minDaysInDest, maxDaysInDest]
      x_range = [0, 2],       // [min pre-stopover days at T1]
      y_range = [0, 2],       // [min post-stopover days at T1]
      adults = 1,
      currency = "CAD",
      cabin = "ECONOMY",
      max_tuples = 30,        // safety cap on tuple generation
      allow_fallback_hubs = true, // NEW: try other hubs automatically if empty
      max_results = 5,        // NEW: stop after we collect this many itineraries
    } = await parseBody(req);

    // Validate basics
    assertIata(origin, "origin");
    assertIata(dest, "dest");
    assertDateRange(depart_window, "depart_window");
    assertDateRange(return_window, "return_window");
    assertNumRange(z_range, "z_range");
    assertNumRange(x_range, "x_range");
    assertNumRange(y_range, "y_range");

    // Build the hub list (primary first, unique, then defaults)
    const hubsToTry = uniqueDefined([
      (t1 || "").toUpperCase(),
      ...(allow_fallback_hubs ? DEFAULT_FALLBACK_HUBS : []),
    ]).slice(0, 8); // guardrail

    const tried = [];
    const results = [];

    for (const hub of hubsToTry) {
      if (!hub) continue;
      tried.push(hub);

      // Generate candidate tuples for this hub
      const tuples = buildTuples({
        departRange: depart_window,
        returnRange: return_window,
        xRange: x_range,
        zRange: z_range,
        yRange: y_range,
        maxTuples: max_tuples,
      });

      for (const t of tuples) {
        // Slices: [A->T1, T1->DEST, DEST->T1, T1->A]
        const slices = [
          { origin, dest: hub, date: t.a_to_t1 },
          { origin: hub, dest, date: t.t1_to_dest },
          { origin: dest, dest: hub, date: t.dest_to_t1 },
          { origin: hub, dest: origin, date: t.t1_to_a },
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

          // Align baseline to DEST dates in this tuple (best-effort)
          const baselineJson = await flightOffersRoundTripWithToken({
            origin,
            dest,
            departDate: t.t1_to_dest,
            returnDate: t.dest_to_t1,
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
            hub, // NEW: which hub produced this result
          });

          // Stop early if we’ve accumulated enough
          if (results.length >= max_results) break;
        } catch {
          // Ignore tuple/HUB failures, keep iterating
        }
      }

      // If we found anything with this hub, stop trying more hubs
      if (results.length > 0) break;
    }

    // Sort by cheapest total
    results.sort((a, b) => Number(a.price ?? Infinity) - Number(b.price ?? Infinity));

    return res.status(200).json({
      env: process.env.AMADEUS_ENV || "test",
      currency,
      origin,
      t1: t1 || null,
      dest,
      constraints: { depart_window, return_window, x_range, z_range, y_range, cabin, adults },
      baseline_hint: "Baseline computed per-tuple using DEST segment dates.",
      tried_hubs: tried,        // NEW: visibility into fallback sequence
      results,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
}

/* -------------------- helpers -------------------- */

async function parseBody(req) {
  try {
    return typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
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
function uniqueDefined(arr) {
  const out = [];
  const seen = new Set();
  for (const v of arr) {
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

// Build tuples ensuring chronological order across windows and x/z/y constraints.
function buildTuples({ departRange, returnRange, xRange, zRange, yRange, maxTuples }) {
  const [departStart, departEnd] = departRange;
  const [returnStart, returnEnd] = returnRange;

  const tuples = [];
  const maxPerStart = Math.max(1, Math.floor(maxTuples / 5));

  const totalDepartDays = clamp(daysBetween(departStart, departEnd) + 1, 1, 31);
  for (let d = 0; d < totalDepartDays; d++) {
    const a_to_t1 = addDays(departStart, d);

    for (let x = xRange[0]; x <= xRange[1]; x++) {
      const t1_to_dest = addDays(a_to_t1, Math.max(0, x));

      for (let z = zRange[0]; z <= zRange[1]; z++) {
        const dest_to_t1 = addDays(t1_to_dest, Math.max(1, z));

        for (let y = yRange[0]; y <= yRange[1]; y++) {
          const t1_to_a = addDays(dest_to_t1, Math.max(0, y));

          if (t1_to_a < returnStart || t1_to_a > returnEnd) continue;

          tuples.push({ a_to_t1, t1_to_dest, dest_to_t1, t1_to_a, x, z, y });
          if (tuples.length >= maxTuples) return tuples;
        }
      }
    }

    if (tuples.length >= maxPerStart) continue;
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
