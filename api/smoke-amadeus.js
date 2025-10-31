// api/smoke-amadeus.js

import { getToken } from "./_lib/amadeus.js";

export default async function handler(req, res) {
  try {
    const token = await getToken();
    res.json({
      ok: true,
      env: process.env.AMADEUS_ENV,
      token_preview: token.slice(0, 8) + "...",
      token_length: token.length
    });
  } catch (err) {
    console.error("Smoke test error:", err);
    res.status(502).json({
      ok: false,
      error: "Failed to fetch Amadeus token",
      details: err.message
    });
  }
}
