export async function flightOffersMultiCity({ legs, adults, cabin, currency }) {
  const token = await getToken();

  const body = {
    currencyCode: currency,
    sources: ["GDS"],
    travelers: Array.from({ length: adults }).map((_, i) => ({
      id: String(i + 1),
      travelerType: "ADULT"
    })),
    originDestinations: legs.map((leg, idx) => ({
      id: String(idx + 1),
      originLocationCode: leg.origin,
      destinationLocationCode: leg.destination,
      departureDateTimeRange: {
        // widen to handle feasibility and inventory variability
        date: leg.departureDate,
        time: "00:00:00-23:59:59"
      }
    })),
    searchCriteria: {
      flightFilters: {
        cabinRestrictions: [
          {
            cabin, // "ECONOMY" | "PREMIUM_ECONOMY" | "BUSINESS" | "FIRST"
            originDestinationIds: [] // apply to all if empty
          }
        ]
      },
      maxFlightOffers: 50
    }
  };

  const res = await fetchWithTimeout("https://api.amadeus.com/v2/shopping/flight-offers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  return data;
}
