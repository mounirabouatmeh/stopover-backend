// /api/smoke-multicity.js
import { flightOffersMultiCityWithToken, buildGFlightsDeeplink } from "./_lib/amadeus.js";

export default async function handler(req, res) {
  try {
    // A simple, fixed 4-leg itinerary to test multi-city search.
    // Adjust dates a little if needed, but keep it simple.
    const slices = [
      { origin: "YUL", dest: "CDG", date: "2025-11-20" },
      { origin: "CDG", dest: "ATH", date: "2025-11-22" },
      { origin: "ATH", dest: "CDG", date: "2025-11-29" },
      { origin: "CDG", dest: "YUL", date: "2025-11-30" }
    ];

    const json = await flightOffersMultiCityWithToken({
      slices,
      adults: 1,
      currencyCode: "CAD",
      cabin: "ECONOMY"
    });

    const offers = Array.isArray(json?.data) ? json.data : [];
    offers.sort((a, b) => Number(a?.price?.total ?? Infinity) - Number(b?.price?.total ?? Infinity));
    const cheapest = offers[0] || null;

    return res.status(200).json({
      ok: true,
      env: process.env.AMADEUS_ENV || "test",
      queried_slices: slices,
      count: offers.length,
      cheapest: cheapest
        ? {
            total: cheapest.price?.total ?? null,
            currency: cheapest.price?.currency ?? null,
            validatingAirlineCodes: cheapest.validatingAirlineCodes ?? [],
            deeplink: buildGFlightsDeeplink({ slices })
          }
        : null,
      raw_present: Boolean(json?.data),
      warnings: json?.warnings ?? null,
      meta: json?.meta ?? null
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      env: process.env.AMADEUS_ENV || "test",
      error: e.message || String(e)
    });
  }
}
