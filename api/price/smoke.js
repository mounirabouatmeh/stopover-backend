// api/price/smoke.js
// Minimal one-shot test against Amadeus sandbox: ONE request, FOUR dates.
// No loops. Quick response. CORS enabled. No other dependencies.

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const HOST = (env) => (env === "production" ? "https://api.amadeus.com" : "https://test.api.amadeus.com");

// fetch with timeout to avoid hanging requests
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED", detail: "Use POST with JSON body." });
  }

  try {
    const env = process.env.AMADEUS_ENV || "test";
    const host = HOST(env);

    // Expected body:
    // {
    //   "origin": "YUL",
    //   "t1": "CDG",
    //   "dates": {
    //     "a_t1": "2026-03-06",
    //     "t1_bey": "2026-03-08",
    //     "bey_t1": "2026-03-18",
    //     "t1_a": "2026-03-20"
    //   }
    // }
    const { origin, t1 = "CDG", dates } = req.body || {};
    const { a_t1, t1_bey, bey_t1, t1_a } = (dates || {});

    if (!origin || !a_t1 || !t1_bey || !bey_t1 || !t1_a) {
      return res.status(400).json({
        error: "BAD_REQUEST",
        detail:
          "Provide origin (IATA), optional t1 (default CDG), and dates { a_t1, t1_bey, bey_t1, t1_a } as YYYY-MM-DD.",
        example: {
          origin: "YUL",
          t1: "CDG",
          dates: { a_t1: "2026-03-06", t1_bey: "2026-03-08", bey_t1: "2026-03-18", t1_a: "2026-03-20" }
        }
      });
    }

    // 1) OAuth token
    const tokenResp = await fetchWithTimeout(`${host}/v1/security/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.AMADEUS_CLIENT_ID,
        client_secret: process.env.AMADEUS_CLIENT_SECRET
      })
    }, 8000);

    const tokenData = await tokenResp.json();
    if (!tokenResp.ok) {
      return res.status(502).json({ error: "TOKEN_ERROR", detail: tokenData });
    }
    const accessToken = tokenData.access_token;

    // 2) One multi-city search with the four explicit dates
    const originDestinations = [
      { id: "1", originLocationCode: origin, destinationLocationCode: t1,   departureDateTimeRange: { date: a_t1 } },
      { id: "2", originLocationCode: t1,     destinationLocationCode: "BEY", departureDateTimeRange: { date: t1_bey } },
      { id: "3", originLocationCode: "BEY",  destinationLocationCode: t1,   departureDateTimeRange: { date: bey_t1 } },
      { id: "4", originLocationCode: t1,     destinationLocationCode: origin, departureDateTimeRange: { date: t1_a } },
    ];

    const payload = {
      currencyCode: "CAD",
      travelers: [{ id: "1", travelerType: "ADULT" }],
      sources: ["GDS"],
      searchCriteria: { maxFlightOffers: 10 },
      originDestinations
    };

    const offersResp = await fetchWithTimeout(`${host}/v2/shopping/flight-offers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(payload)
    }, 8000);

    const offersData = await offersResp.json();

    // Shape a minimal, human-checkable response
    const offers = Array.isArray(offersData?.data) ? offersData.data : [];
    const first = offers[0];

    const summary = first ? {
      total: Number(first?.price?.grandTotal || first?.price?.total || 0),
      currency: first?.price?.currency || "CAD",
      itineraries: (first?.itineraries || []).map(i => ({ duration: i.duration })),
      carriers: Array.from(new Set(
        (first?.itineraries || []).flatMap(i =>
          (i?.segments || []).map(s => s.carrierCode)
        )
      ))
    } : null;

    return res.status(200).json({
      env,
      request: { origin, t1, dates },
      amadeusStatus: offersResp.status,
      offersCount: offers.length,
      firstOffer: summary
    });

  } catch (e) {
    return res.status(500).json({ error: "SMOKE_FAILED", detail: String(e?.message || e) });
  }
}
