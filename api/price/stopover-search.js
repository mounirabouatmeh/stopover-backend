// api/price/stopover-search.js
import { flightOffersMultiCity, buildGFlightsDeeplink } from "../_lib/amadeus.js";

/* -------------------------- CORS & Preflight -------------------------- */
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/* -------------------------- Helpers -------------------------- */
function* tuples({ depart_window, return_window, z_range, x_range = [0, 0], y_range = [0, 0] }) {
  const [depStart, depEnd] = depart_window.map((d) => new Date(d));
  const [retStart, retEnd] = return_window.map((d) => new Date(d));

  // Iterate day by day inside windows, then compute Z from total - X - Y
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

const iso = (d) => new Date(d).toISOString().slice(0, 10);

/* -------------------------- Handler -------------------------- */
export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    // Default stopover is now Paris (CDG). Can be overridden by request body.
    const {
      origin,
      t1 = "CDG",
      z_range,
      x_range = [0, 0],
      y_range = [0, 0],
      depart_window,
      return_window,
      // optional constraints not yet wired: cabin, max_stops_per_leg, alliance_pref, max_results
    } = req.body || {};

    // Basic input validation
    if (!origin || !depart_window || !return_window || !z_range) {
      return res.status(400).json({
        error: "BAD_REQUEST",
        detail:
          "Required: origin, depart_window [start,end], return_window [start,end], z_range [min,max]. Optional: t1 (default CDG), x_range, y_range.",
      });
    }

    const results = [];
    let count = 0;
    const MAX_TUPLES = 20; // increase if you want to try more combinations

    for (const t of tuples({ depart_window, return_window, z_range, x_range, y_range })) {
      if (count >= MAX_TUPLES) break;

      // Dates per slice:
      const d0 = t.dep;                     // A -> T1
      const a1 = new Date(d0); a1.setDate(a1.getDate() + t.X);  // T1 -> BEY
      const b1 = new Date(a1); b1.setDate(b1.getDate() + t.Z);  // BEY -> T1
      const a2 = new Date(b1); a2.setDate(a2.getDate() + t.Y);  // T1 -> A

      const originDestinations = [
        { id: "1", originLocationCode: origin, destinationLocationCode: t1,   departureDateTimeRange: { date: iso(d0) } },
        { id: "2", originLocationCode: t1,     destinationLocationCode: "BEY", departureDateTimeRange: { date: iso(a1) } },
        { id: "3", originLocationCode: "BEY",  destinationLocationCode: t1,   departureDateTimeRange: { date: iso(b1) } },
        { id: "4", originLocationCode: t1,     destinationLocationCode: origin, departureDateTimeRange: { date: iso(a2) } },
      ];

      try {
        const data = await flightOffersMultiCity(originDestinations);
        const first = data?.data?.[0];
        if (first) {
          const totalFare = Number(first?.price?.grandTotal || first?.price?.total || 0);

          results.push({
            totalFare,
            deltaVsBaseline: null, // can be filled once baseline endpoint returns a value
            slices: [
              { from: origin, to: t1,   date: iso(d0) },
              { from: t1,     to: "BEY", date: iso(a1) },
              { from: "BEY",  to: t1,   date: iso(b1) },
              { from: t1,     to: origin, date: iso(a2) },
            ],
            durations: first?.itineraries?.map((i) => i.duration) ?? [],
            overnights: false, // can be derived if needed from segment times
            alliance: null,    // optional mapping from carrier codes
            bookingDeeplink: buildGFlightsDeeplink(origin, t1, "BEY", [d0, a1, b1, a2]),
            notes: "Stopover default set to Paris (CDG); values are sandbox/test if AMADEUS_ENV=test.",
          });

          count++;
        }
      } catch (e) {
        // swallow this tuple’s error and continue trying others
        // You can log the error if you want: console.error("tuple error", e?.message || e);
        continue;
      }
    }

    results.sort((a, b) => a.totalFare - b.totalFare);
    return res.status(200).json({ currency: "CAD", results });
  } catch (e) {
    return res.status(500).json({ error: "STOPOVER_FAILED", detail: String(e?.message || e) });
  }
}
