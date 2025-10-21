// api/price/stopover-search.js
import {
  getTokenOnce,
  flightOffersMultiCityWithToken,
  flightOffersRoundTripWithToken,
  buildGFlightsDeeplink,
} from "../_lib/amadeus.js";

/* -------------------------- CORS & Preflight -------------------------- */
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/* -------------------------- Helpers -------------------------- */
const iso = (d) => new Date(d).toISOString().slice(0, 10);

function* tuples({ depart_window, return_window, z_range, x_range = [0, 0], y_range = [0, 0] }) {
  const [depStart, depEnd] = depart_window.map((d) => new Date(d));
  const [retStart, retEnd] = return_window.map((d) => new Date(d));
  for (let dep = new Date(depStart); dep <= depEnd; dep.setDate(dep.getDate() + 1)) {
    for (let ret = new Date(retStart); ret <= retEnd; ret.setDate(ret.getDate() + 1)) {
      const totalDays = Math.round((ret - dep) / 86400000);
      for (let X = x_range[0]; X <= x_range[1]; X++) {
        for (let Y = y_range[0]; Y <= y_range[1]; Y++) {
          const Z = totalDays - X - Y;
          if (Z >= z_range[0] && Z <= z_range[1]) {
            yield { dep: new Date(dep), ret: new Date(ret), X, Y, Z };
          }
        }
      }
    }
  }
}

/* -------------------------- Handler -------------------------- */
export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    const {
      origin,
      t1, // user-chosen stopover IATA (e.g., "ATH", "CDG"). If missing, fallback to CDG.
      z_range,
      x_range = [0, 0],
      y_range = [0, 0],
      depart_window,
      return_window,
    } = req.body || {};

    // Basic validation
    if (
      !origin ||
      !Array.isArray(depart_window) ||
      !Array.isArray(return_window) ||
      !Array.isArray(z_range)
    ) {
      return res.status(400).json({
        error: "BAD_REQUEST",
        detail:
          "Required: origin, depart_window [start,end], return_window [start,end], z_range [min,max]. Optional: t1 (stopover IATA), x_range, y_range.",
      });
    }

    const stopover = t1 || "CDG"; // default only if user didn’t provide
    const { token, host } = await getTokenOnce();

    const results = [];
    let tried = 0;
    const MAX_TUPLES = 10; // keep modest for speed
    const STOP_ON_FIRST = false;

    for (const t of tuples({ depart_window, return_window, z_range, x_range, y_range })) {
      if (tried >= MAX_TUPLES) break;
      tried++;

      // Derive the four slice dates
      const d0 = t.dep; // A -> T1
      const a1 = new Date(d0);
      a1.setDate(a1.getDate() + t.X); // T1 -> BEY
      const b1 = new Date(a1);
      b1.setDate(b1.getDate() + t.Z); // BEY -> T1
      const a2 = new Date(b1);
      a2.setDate(a2.getDate() + t.Y); // T1 -> A

      const originDestinations = [
        { id: "1", originLocationCode: origin, destinationLocationCode: stopover, departureDateTimeRange: { date: iso(d0) } },
        { id: "2", originLocationCode: stopover, destinationLocationCode: "BEY",  departureDateTimeRange: { date: iso(a1) } },
        { id: "3", originLocationCode: "BEY",  destinationLocationCode: stopover, departureDateTimeRange: { date: iso(b1) } },
        { id: "4", originLocationCode: stopover, destinationLocationCode: origin, departureDateTimeRange: { date: iso(a2) } },
      ];

      try {
        const data = await flightOffersMultiCityWithToken({
          host,
          token,
          originDestinations,
          currency: "CAD",
        });

        const first = data?.data?.[0];
        if (first) {
          const totalFare = Number(first?.price?.grandTotal || first?.price?.total || 0);

          results.push({
            totalFare,
            deltaVsBaseline: null, // filled later for the cheapest only
            slices: [
              { from: origin, to: stopover, date: iso(d0) },
              { from: stopover, to: "BEY", date: iso(a1) },
              { from: "BEY", to: stopover, date: iso(b1) },
              { from: stopover, to: origin, date: iso(a2) },
            ],
            durations: first?.itineraries?.map((i) => i.duration) ?? [],
            overnights: false,
            alliance: null,
            bookingDeeplink: buildGFlightsDeeplink(origin, stopover, "BEY", [d0, a1, b1, a2]),
            notes: "Sandbox data if AMADEUS_ENV=test",
          });

          if (STOP_ON_FIRST) break;
        }
      } catch {
        // Ignore this tuple on failure; continue with the next
      }
    }

    if (results.length === 0) {
      const env = process.env.AMADEUS_ENV || "test";
      return res.status(200).json({ currency: "CAD", env, baseline: { fare: null, dates: null }, results: [] });
    }

    // Sort cheapest first
    results.sort((a, b) => a.totalFare - b.totalFare);

    // Compute baseline ONLY for the CHEAPEST result to keep latency + cost low
    const cheapest = results[0];

    // Align baseline to the BEY legs (slice 1: T1->BEY = outbound; slice 2: BEY->T1 = inbound)
    const outDate = cheapest.slices[1].date;
    const inDate = cheapest.slices[2].date;

    let baseline = { fare: null, dates: { outbound: outDate, inbound: inDate } };

    try {
      const rtData = await flightOffersRoundTripWithToken({
        host,
        token,
        origin,
        destination: "BEY",
        outDate,
        inDate,
        currency: "CAD",
      });
      const rtFirst = rtData?.data?.[0];
      const baselineFare = rtFirst ? Number(rtFirst?.price?.grandTotal || rtFirst?.price?.total || 0) : null;

      baseline.fare = baselineFare;

      if (baselineFare != null) {
        cheapest.deltaVsBaseline = Number((cheapest.totalFare - baselineFare).toFixed(2));
      }
    } catch {
      // If baseline fails, we still return the stopover results without delta
    }

    const env = process.env.AMADEUS_ENV || "test";
    return res.status(200).json({ currency: "CAD", env, baseline, results });
  } catch (e) {
    return res.status(500).json({ error: "STOPOVER_FAILED", detail: String(e?.message || e) });
  }
}
