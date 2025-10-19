export default async function handler(req,res){
  try{
    // MVP: you can implement a simple sampler later
    res.status(200).json({
      currency:"CAD",
      baselineFare:null,
      baselineItinerary:null,
      searchedDates:[...req.body?.depart_window||[], ...req.body?.return_window||[]]
    });
  }catch(e){
    res.status(500).json({ error:"BASELINE_FAILED", detail:String(e?.message||e) });
  }
}
