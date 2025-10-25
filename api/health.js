// /api/health.js
export default function handler(req, res) {
  const hasKey = Boolean(process.env.AMADEUS_API_KEY && process.env.AMADEUS_API_KEY.length > 5);
  const hasSecret = Boolean(process.env.AMADEUS_API_SECRET && process.env.AMADEUS_API_SECRET.length > 5);
  return res.status(200).json({
    ok: true,
    env: process.env.AMADEUS_ENV || "test",
    amadeus_key_present: hasKey,
    amadeus_secret_present: hasSecret
  });
}
