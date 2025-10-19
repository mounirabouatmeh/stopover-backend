// Serverless-safe Amadeus OAuth + search
export async function getToken() {
  const host = process.env.AMADEUS_ENV === "production"
    ? "https://api.amadeus.com"
    : "https://test.api.amadeus.com";

  const r = await fetch(`${host}/v1/security/oauth2/token`, {
    method: "POST",
    headers: {"Content-Type":"application/x-www-form-urlencoded"},
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.AMADEUS_CLIENT_ID,
      client_secret: process.env.AMADEUS_CLIENT_SECRET
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

export async function flightOffersMultiCity(originDestinations) {
  const host = process.env.AMADEUS_ENV === "production"
    ? "https://api.amadeus.com"
    : "https://test.api.amadeus.com";
  const token = await getToken();
  const r = await fetch(`${host}/v2/shopping/flight-offers`, {
    method: "POST",
    headers: {
      "Content-Type":"application/json",
      "Authorization":`Bearer ${token}`
    },
    body: JSON.stringify({
      currencyCode: "CAD",
      travelers: [{ id:"1", travelerType:"ADULT" }],
      sources: ["GDS"],
      searchCriteria: { maxFlightOffers: 20 },
      originDestinations
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Search error: ${JSON.stringify(data)}`);
  return data;
}

export function buildGFlightsDeeplink(A,T,B,[d0,a1,b1,a2]) {
  const fmt = d=>new Date(d).toISOString().slice(0,10);
  return `https://www.google.com/travel/flights?hl=en#flt=${A}.${T}.${fmt(d0)}*${T}.${B}.${fmt(a1)}*${B}.${T}.${fmt(b1)}*${T}.${A}.${fmt(a2)}`;
}
