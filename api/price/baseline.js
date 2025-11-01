for (let d = new Date(departStart); d <= departEnd; d.setUTCDate(d.getUTCDate() + 1)) {
  for (let r = new Date(returnStart); r <= returnEnd; r.setUTCDate(r.getUTCDate() + 1)) {
    if (r <= d) continue;

    const departDate = fmtDate(d);
    const returnDate = fmtDate(r);

    // 🔍 Debug log before calling Amadeus
    console.log(`Checking pair: depart=${departDate}, return=${returnDate}`);

    const data = await flightOffersRoundTrip({
      origin,
      dest,
      departDate,
      returnDate,
      adults,
      cabin,
      currency
    });

    const offers = data?.data ?? [];

    // 🔍 Debug log after receiving offers
    console.log(`Offers found: ${offers.length} for ${departDate} → ${returnDate}`);
