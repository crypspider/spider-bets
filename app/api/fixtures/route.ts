import { createClient } from '@supabase/supabase-js';
export const revalidate = 900;
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
const cacheHeaders = {'Cache-Control':'public, s-maxage=900, stale-while-revalidate=1800'};
const errorHeaders = {'Cache-Control':'no-store'};
const responseHeaders = cacheHeaders;
const competitions = ['PL', 'CL', 'SA', 'BL1', 'FL1'];
const sports = ['soccer_epl', 'soccer_spain_la_liga', 'soccer_italy_serie_a', 'soccer_germany_bundesliga', 'soccer_france_ligue_one', 'soccer_uefa_champs_league', 'soccer_uefa_europa_league', 'soccer_uefa_europa_conference_league', 'soccer_efl_champ'];
const sportNames: Record<string, string> = { soccer_epl: 'Premier League', soccer_spain_la_liga: 'La Liga', soccer_italy_serie_a: 'Serie A', soccer_germany_bundesliga: 'Bundesliga', soccer_france_ligue_one: 'Ligue 1', soccer_uefa_champs_league: 'Champions League', soccer_uefa_europa_league: 'Europa League', soccer_uefa_europa_conference_league: 'Europa Conference League', soccer_efl_champ: 'Championship' };
const normalize = (name: string) => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\b(fc|afc|cf|sc|club)\b/g, '').replace(/[^a-z0-9]/g, '');
const aliases: Record<string, string> = { mancity: 'manchestercity', manunited: 'manchesterunited', wolves: 'wolverhamptonwanderers', spurs: 'tottenhamhotspur', psg: 'parissaintgermain', inter: 'internazionale', atletico: 'atleticodemadrid', gladbach: 'borussiamonchengladbach' };
const teamKey = (name: string) => { const key = normalize(name); return aliases[key] || key; };
const fixtureStatus = (status: string) => ({ SCHEDULED: 'SCHEDULED', TIMED: 'SCHEDULED', NS: 'SCHEDULED', IN_PLAY: 'LIVE', PAUSED: 'HT', FINISHED: 'FT', POSTPONED: 'PST', CANCELLED: 'CANC', SUSPENDED: 'SUSP', AWARDED: 'FT' } as Record<string, string>)[status] || status;
const dbStatus = (status: string) => ['FT', 'AET', 'PEN'].includes(status) ? 'finished' : ['LIVE', 'HT', '1H', '2H', 'ET', 'P'].includes(status) ? 'live' : status === 'PST' ? 'postponed' : status === 'CANC' ? 'cancelled' : 'scheduled';
export async function GET() {
  const footballKey = process.env.FOOTBALL_DATA_KEY;
  const oddsKey = process.env.THE_ODDS_API_KEY;
  if (!footballKey || !oddsKey) return Response.json({ available: false, reason: !footballKey ? 'FOOTBALL_DATA_KEY is not configured' : 'THE_ODDS_API_KEY is not configured', fixtures: [], odds: [] }, { status: 503, headers: errorHeaders });
  try {
    const fetchWithRetry = async (url: string, headers: Record<string, string> = {}) => {
      let last: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(url, { headers, cache: 'force-cache', next: { revalidate: 900 } } as RequestInit & { next: { revalidate: number } });
          if (response.ok || (response.status !== 429 && response.status < 500)) return response;
          last = response;
          const retryAfter = Number(response.headers.get('retry-after'));
          await new Promise(resolve => setTimeout(resolve, retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : 500 * (2 ** attempt)));
        } catch (error) {
          if (attempt === 2) throw error;
          await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
        }
      }
      return last!;
    };
    const [matchResults, oddsBatches] = await Promise.all([
      Promise.all(competitions.map(async code => {
        const response = await fetchWithRetry(`https://api.football-data.org/v4/competitions/${code}/matches`, { 'X-Auth-Token': footballKey });
        if (!response.ok) return { code, matches: [], error: `football-data.org ${code} responded ${response.status}` };
        const payload = await response.json();
        return { code, matches: (payload.matches || []).map((match: any) => ({ match, code })) };
      })),
      Promise.all(sports.map(async sport => {
        const url = new URL(`https://api.the-odds-api.com/v4/sports/${sport}/odds`);
        url.searchParams.set('apiKey', oddsKey); url.searchParams.set('regions', 'uk,eu'); url.searchParams.set('markets', 'h2h,totals,spreads'); url.searchParams.set('oddsFormat', 'decimal'); url.searchParams.set('dateFormat', 'iso');
        const response = await fetchWithRetry(url.toString());
        if (response.status === 404) return [];
        if (response.status === 422) return [];
        if (!response.ok) throw new Error(`The Odds API responded ${response.status}`);
        return await response.json();
      }))
    ]);
    const events = oddsBatches.flat();
    const failedCompetitions = matchResults.filter((result: any) => result.error);
    const fixtures = matchResults.flatMap((result: any) => result.matches).map(({ match }: any) => ({
      id: Number(match.id), kickoff: match.utcDate, status: fixtureStatus(match.status),
      competition: { id: Number(match.competition.id), name: match.competition.name, country: match.area?.name || '' },
      home: { id: Number(match.homeTeam.id), name: match.homeTeam.name, logo: match.homeTeam.crest || '' },
      away: { id: Number(match.awayTeam.id), name: match.awayTeam.name, logo: match.awayTeam.crest || '' },
      score: { home: match.score?.fullTime?.home ?? null, away: match.score?.fullTime?.away ?? null }, venue: match.venue || null, source: 'football-data.org'
    }));
    const odds = events.map((event: any) => ({ id: event.id, sport_key: event.sport_key, commence_time: event.commence_time, home_team: event.home_team, away_team: event.away_team, bookmakers: event.bookmakers || [] }));
    const matched = new Map<any, any>();
    for (const fixture of fixtures) {
      const kickoff = Date.parse(fixture.kickoff);
      const event = events.find((candidate: any) => teamKey(candidate.home_team) === teamKey(fixture.home.name) && teamKey(candidate.away_team) === teamKey(fixture.away.name) && Math.abs(Date.parse(candidate.commence_time) - kickoff) < 18 * 60 * 60 * 1000);
      if (event) matched.set(event.id, fixture);
    }
    const dbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (dbUrl && serviceKey && fixtures.length) {
      const db = createClient(dbUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const comps = Array.from(new Map(fixtures.map((f: any) => [f.competition.id, { id: f.competition.id, name: f.competition.name, country: f.competition.country, season: Number(String(f.kickoff).slice(0, 4)), source: 'football-data.org' }])).values());
      const teams = Array.from(new Map(fixtures.flatMap((f: any) => [{ id: f.home.id, name: f.home.name, short_name: f.home.name, logo_url: f.home.logo || null, country: f.competition.country, source: 'football-data.org' }, { id: f.away.id, name: f.away.name, short_name: f.away.name, logo_url: f.away.logo || null, country: f.competition.country, source: 'football-data.org' }]).map((team: any) => [team.id, team])).values());
      const fixtureRows = fixtures.map((f: any) => ({ id: f.id, competition_id: f.competition.id, home_team_id: f.home.id, away_team_id: f.away.id, kickoff: f.kickoff, status: dbStatus(f.status), home_score: f.score.home, away_score: f.score.away, venue: f.venue, source: 'football-data.org' }));
      for (const [table, rows] of [['competitions', comps], ['teams', teams], ['fixtures', fixtureRows]] as [string, any[]][]) { const { error } = await db.from(table).upsert(rows, { onConflict: 'id' }); if (error) throw new Error(`Supabase ${table} sync failed: ${error.message}`); }
      const bookmakerRows = new Map<string, { id: string; name: string }>(), priceRows: any[] = [];
      for (const event of events) {
        const fixture = matched.get(event.id); if (!fixture) continue;
        for (const book of event.bookmakers || []) {
          const bookmakerId = String(book.key).slice(0, 100); bookmakerRows.set(bookmakerId, { id: bookmakerId, name: book.title });
          for (const market of book.markets || []) if (['h2h', 'totals', 'spreads'].includes(market.key)) for (const outcome of market.outcomes || []) {
            const key = teamKey(outcome.name), side = market.key === 'h2h' ? key === 'draw' ? 'Draw' : key === teamKey(event.home_team) ? 'Home' : key === teamKey(event.away_team) ? 'Away' : null : String(outcome.name), price = Number(outcome.price), point = Number(outcome.point ?? 0);
            if (side && Number.isFinite(price) && price > 1 && Number.isFinite(point)) priceRows.push({ fixture_id: fixture.id, bookmaker_id: bookmakerId, market_id: market.key, outcome: side, price, point, fetched_at: book.last_update || new Date().toISOString() });
          }
        }
      }
      if (bookmakerRows.size) { const { error } = await db.from('bookmakers').upsert(Array.from(bookmakerRows.values()), { onConflict: 'id' }); if (error) throw new Error(`Supabase bookmaker sync failed: ${error.message}`); }
      for (let i = 0; i < priceRows.length; i += 500) { const { error } = await db.from('odds').upsert(priceRows.slice(i, i + 500), { onConflict: 'fixture_id,bookmaker_id,market_id,outcome,point' }); if (error) throw new Error(`Supabase odds sync failed: ${error.message}`); }
    }
    const byKickoff = (a: any, b: any) => a.kickoff.localeCompare(b.kickoff);
    const now = Date.now();
    const upcomingFixtures = fixtures.filter((fixture: any) => ['SCHEDULED', 'NS', 'TIMED'].includes(fixture.status) && Date.parse(fixture.kickoff) > now).sort(byKickoff);
    const liveFixtures = fixtures.filter((fixture: any) => ['LIVE', 'HT'].includes(fixture.status)).sort(byKickoff);
    const results = fixtures.filter((fixture: any) => ['FT', 'AET', 'PEN'].includes(fixture.status)).sort(byKickoff);
    return Response.json({ available: true, source: 'football-data.org', season: new Date().getFullYear(), competitions: competitions, failedCompetitions, cachedForSeconds: 900, fixtures: upcomingFixtures, liveFixtures, results, odds, matchedOddsEvents: matched.size }, { headers: responseHeaders });
  } catch (error) {
    return Response.json({ available: false, reason: error instanceof Error ? error.message : 'Fixture and odds providers unavailable', fixtures: [], odds: [] }, { status: 502, headers: responseHeaders });
  }
}
