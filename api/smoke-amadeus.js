// /api/smoke-amadeus.js
import { getTokenOnce } from "./_lib/amadeus.js";

export default async function handler(req, res) {
  try {
    const token = await getTokenOnce(); // fetch OAuth token from Amadeus
    return res.status(200).json({
      ok: true,
      env: process.env.AMADEUS_ENV || "test",
      token_preview: token ? `...${String(token).slice(-8)}` : null,
      token_length: token ? String(token).length : 0,
      note: "Amadeus OAuth succeeded"
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      env: process.env.AMADEUS_ENV || "test",
      error: e.message || String(e)
    });
  }
}
