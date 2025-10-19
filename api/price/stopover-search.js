import { flightOffersMultiCity, buildGFlightsDeeplink } from "./_lib/amadeus";

function* tuples({ depart_window, return_window, z_range, x_range=[0,0], y_range=[0,0] }){
  const [depStart,depEnd]=depart_window.map(d=>new Date(d));
  const [retStart,retEnd]=return_window.map(d=>new Date(d));
  for(let dep=new Date(depStart); dep<=depEnd; dep.setDate(dep.getDate()+1)){
    for(let ret=new Date(retStart); ret<=retEnd; ret.setDate(ret.getDate()+1)){
      const totalDays=Math.round((ret-dep)/86400000);
      for(let X=x_range[0]; X<=x_range[1]; X++){
        for(let Y=y_range[0]; Y<=y_range[1]; Y++){
          const Z=totalDays-X-Y;
          if(Z>=z_range[0] && Z<=z_range[1]) yield { dep:new Date(dep), ret:new Date(ret), X, Y, Z };
        }
      }
    }
  }
}

export default async function handler(req,res){
  try{
    const { origin, t1="ATH", z_range, x_range=[0,0], y_range=[0,0], depart_window, return_window } = req.body||{};
    const results=[];
    let count=0;

    for(const t of tuples({ depart_window, return_window, z_range, x_range, y_range })){
      if(count>=8) break; // protect quotas; tune later
      const d0=t.dep;
      const a1=new Date(d0); a1.setDate(a1.getDate()+t.X);
      const b1=new Date(a1); b1.setDate(b1.getDate()+t.Z);
      const a2=new Date(b1); a2.setDate(a2.getDate()+t.Y);
      const iso=d=>d.toISOString().slice(0,10);

      const originDestinations=[
        { id:"1", originLocationCode:origin, destinationLocationCode:t1,  departureDateTimeRange:{ date: iso(d0) } },
        { id:"2", originLocationCode:t1,     destinationLocationCode:"BEY", departureDateTimeRange:{ date: iso(a1) } },
        { id:"3", originLocationCode:"BEY",  destinationLocationCode:t1,  departureDateTimeRange:{ date: iso(b1) } },
        { id:"4", originLocationCode:t1,     destinationLocationCode:origin, departureDateTimeRange:{ date: iso(a2) } },
      ];

      try{
        const data = await flightOffersMultiCity(originDestinations);
        const first = data?.data?.[0];
        if(first){
          const totalFare = Number(first?.price?.grandTotal || first?.price?.total || 0);
          results.push({
            totalFare,
            deltaVsBaseline:null,
            slices:[
              { from:origin, to:t1, date:iso(d0) },
              { from:t1, to:"BEY", date:iso(a1) },
              { from:"BEY", to:t1, date:iso(b1) },
              { from:t1, to:origin, date:iso(a2) },
            ],
            durations:first?.itineraries?.map(i=>i.duration)||[],
            overnights:false,
            alliance:null,
            bookingDeeplink: buildGFlightsDeeplink(origin,t1,"BEY",[d0,a1,b1,a2]),
            notes:"Prototype mapping; refine filters later"
          });
          count++;
        }
      }catch(e){ /* skip tuple on error */ }
    }

    results.sort((a,b)=>a.totalFare-b.totalFare);
    res.status(200).json({ currency:"CAD", results });
  }catch(e){
    res.status(500).json({ error:"STOPOVER_FAILED", detail:String(e?.message||e) });
  }
}
