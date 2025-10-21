// api/price/stopover-search.js
import { getTokenOnce, flightOffersMultiCityWithToken, buildGFlightsDeeplink } from "../_lib/amadeus.js";

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

  // Iterate inside windows; compute Z = total - X - Y
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

  try {
    const {
      origin,
      t1 = "CDG",               // default stopover: Paris
      z_range,
      x_range = [0, 0],
      y_range = [0, 0],
      depart_window,
      return_window
    } = req.body || {};

    // Basic validation
    if (!origin || !Array.isArray(depart_window) || !Array.isArray(return_window) || !Array.isArray(z_range)) {
      return res.status(400).json({
        error: "BAD_REQUEST",
        detail: "Required: origin, depart_window [start,end], return_window [start,end], z_range [min,max]. Optional: t1 (default CDG), x_range, y_range."
      });
    }

    // Get OAuth token ONCE per request
    const { token, host } = await getTokenOnce();

    const results = [];
    let tried = 0;
    const MAX_TUPLES = 6;       // lower cap to ensure fast response
    const STOP_ON_FIRST = true; // return immediately after first valid offer

    for (const t of tuples({ depart_window, return_window, z_range, x_range, y_range })) {
      if (tried >= MAX_TUPLES) break;
      tried++;

      // Derive dates for the 4 legs
      const d0 = t.dep;                                    // A -> T1
      const a1 = new Date(d0); a1.setDate(a1.getDate() + t.X); // T1 -> BEY
      const b1 = new Date(a1); b1.setDate(b1.getDate() + t.Z); // BEY -> T1
      const a2 = new Date(b1); a2.setDate(a2.getDate() + t.Y); // T1 -> A

      const originDestinations = [
        { id: "1", originLocationCode: origin, destinationLocationCode: t1,   departureDateTimeRange: { date: iso(d0) } },
        { id: "2", originLocationCode: t1,     destinationLocationCode: "BEY", departureDateTimeRange: { date: iso(a1) } },
        { id: "3", originLocationCode: "BEY",  destinationLocationCode: t1,   departureDateTimeRange: { date: iso(b1) } },
        { id: "4", originLocationCode: t1,     destinationLocationCode: origin, departureDateTimeRange: { date: iso(a2) } },
      ];

      try {
        const data = await flightOffersMultiCityWithToken({ host, token, originDestinations, currency: "CAD" });
        const first = data?.data?.[0];
        if (first) {
          const totalFare = Number(first?.price?.grandTotal || first?.price?.total || 0);

          const record = {
            totalFare,
            deltaVsBaseline: null,
            slices: [
              { from: origin, to: t1,    date: iso(d0) },
              { from: t1,     to: "BEY", date: iso(a1) },
              { from: "BEY",  to: t1,    date: iso(b1) },
              { from: t1,     to: origin, date: iso(a2) },
            ],
            durations: first?.itineraries?.map(i => i.duration) ?? [],
            overnights: false,
            alliance: null,
            bookingDeeplink: buildGFlightsDeeplink(origin, t1, "BEY", [d0, a1, b1, a2]),
            notes: "Sandbox data if AMADEUS_ENV=test"
          };

          results.push(record);
          if (STOP_ON_FIRST) {
            return res.status(200).json({ currency: "CAD", results });
          }
        }
      } catch (e) {
        // Swallow tuple error and continue; timeouts or 4xx/5xx will fall through
        continue;
      }
    }

    // Sort (if we didn't stop on first) and return
    results.sort((a, b) => a.totalFare - b.totalFare);
    return res.status(200).json({ currency: "CAD", results });
  } catch (e) {
    return res.status(500).json({ error: "STOPOVER_FAILED", detail: String(e?.message || e) });
  }
}
