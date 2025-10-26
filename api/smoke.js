// /api/smoke.js
export default async function handler(req, res) {
  try {
    const authHeader = req.headers.authorization || "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const expected = process.env.TEST_BEARER || "gpt-stopover-secure-3z8hf92nsm39";

    const nowIso = new Date().toISOString();

    return res.status(200).json({
      ok: true,
      now: nowIso,
      method: req.method,
      env: process.env.AMADEUS_ENV || "test",
      amadeus_key_present: Boolean(process.env.AMADEUS_API_KEY && process.env.AMADEUS_API_KEY.length > 5),
      amadeus_secret_present: Boolean(process.env.AMADEUS_API_SECRET && process.env.AMADEUS_API_SECRET.length > 5),
      auth: {
        header_present: Boolean(authHeader),
        bearer_matches_expected: bearer === expected
      },
      note: "Basic smoke test: function reachable, env visible, bearer received."
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}
