export const revalidate = 900;
const SPORTS=['soccer_epl','soccer_spain_la_liga','soccer_italy_serie_a','soccer_germany_bundesliga','soccer_france_ligue_one','soccer_uefa_champs_league','soccer_uefa_europa_league','soccer_uefa_europa_conference_league','soccer_efl_champ'];
export async function GET() {
 const key=process.env.THE_ODDS_API_KEY;if(!key)return Response.json({available:false,reason:'THE_ODDS_API_KEY is not configured',odds:[]},{status:503});
 try {
  const data=await Promise.all(SPORTS.map(async sport=>{const u=new URL(`https://api.the-odds-api.com/v4/sports/${sport}/odds`);u.searchParams.set('apiKey',key);u.searchParams.set('regions','uk,eu');u.searchParams.set('markets','h2h,totals,spreads');u.searchParams.set('oddsFormat','decimal');u.searchParams.set('dateFormat','iso');const r=await fetch(u,{cache:'force-cache'});if(!r.ok){if(r.status===404)return [];throw new Error(`Odds API responded ${r.status}`)}return await r.json()}));
  const odds=data.flat().map((ev:any)=>({id:ev.id,sport_key:ev.sport_key,commence_time:ev.commence_time,home_team:ev.home_team,away_team:ev.away_team,bookmakers:(ev.bookmakers||[]).map((b:any)=>({key:b.key,title:b.title,last_update:b.last_update,markets:(b.markets||[]).map((m:any)=>({key:m.key,last_update:m.last_update,outcomes:m.outcomes}))}))}));
  return Response.json({available:true,source:'The Odds API',cachedForSeconds:900,odds});
 } catch(e) {return Response.json({available:false,reason:e instanceof Error?e.message:'Odds provider unavailable',odds:[]},{status:502});}
}
