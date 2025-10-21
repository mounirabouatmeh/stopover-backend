// api/price/baseline.js
import { getTokenOnce, flightOffersRoundTripWithToken } from "../_lib/amadeus.js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const iso = (d) => new Date(d).toISOString().slice(0, 10);

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    // Accept either exact dates or windows
    // Prefer explicit dates: { dates: { outbound, inbound } }
    // Or windows: depart_window [start,end], return_window [start,end] -> we use the earliest date in each window.
    const { origin, destination = "BEY", dates, depart_window, return_window } = req.body || {};

    if (!origin) {
      return res.status(400).json({ error: "BAD_REQUEST", detail: "Required: origin. Provide dates {outbound,inbound} or depart/return windows." });
    }

    let outbound, inbound;
    if (dates?.outbound && dates?.inbound) {
      outbound = dates.outbound;
      inbound = dates.inbound;
    } else if (Array.isArray(depart_window) && Array.isArray(return_window)) {
      outbound = depart_window[0];
      inbound = return_window[0];
    } else {
      return res.status(400).json({ error: "BAD_REQUEST", detail: "Missing dates. Provide dates or windows." });
    }

    const { token, host } = await getTokenOnce();
    const data = await flightOffersRoundTripWithToken({
      host, token, origin, destination, outDate: iso(outbound), inDate: iso(inbound), currency: "CAD"
    });

    const first = data?.data?.[0];
    const baselineFare = first ? Number(first?.price?.grandTotal || first?.price?.total || 0) : null;

    return res.status(200).json({
      currency: "CAD",
      baselineFare,
      baselineItinerary: first ? { durations: first.itineraries?.map(i => i.duration) ?? [] } : null,
      usedDates: { outbound: iso(outbound), inbound: iso(inbound) }
    });
  } catch (e) {
    return res.status(500).json({ error: "BASELINE_FAILED", detail: String(e?.message || e) });
  }
}
