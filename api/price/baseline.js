function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    res.status(200).json({
      currency: "CAD",
      baselineFare: null,
      baselineItinerary: null,
      searchedDates: [...(req.body?.depart_window || []), ...(req.body?.return_window || [])]
    });
  } catch (e) {
    res.status(500).json({ error: "BASELINE_FAILED", detail: String(e?.message || e) });
  }
}
