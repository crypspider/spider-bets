export type MatchableFixture = { home: string; away: string; kickoff: string };
export type MatchableEvent = { home_team: string; away_team: string; commence_time: string };

const DROP = new Set(['fc','afc','cf','sc','club','ac','as','ss','rc','us','calcio','fussball','fussballclub','futebol','clube','de','and','the','football','soccer','1909','1907','1913','1899','1900','1902','1904','1893','1895','1891','1878','1886','1892','1885','1897','1901','1889','1888','29','07','04','05','1','stade','olympique','om']);
const aliases: Record<string, string> = {
  munchen: 'munich', muenchen: 'munich',
  gladbach: 'monchengladbach',
  spurs: 'tottenham',
  wolves: 'wolverhampton',
  hannover96: 'hannover', inter: 'internazionale', milano: 'internazionale', lyonnais: 'lyon', brestois: 'brest', rennais: 'rennes', aio: 'aek',
};
const canonical = (t: string) => aliases[t] || t;
export const normalizeTeamName = (name: string) => {
  const normalized = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ');
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean).filter(t => !DROP.has(t)).map(canonical);
  return Array.from(new Set(tokens)).sort().join('-');
};

export function tokensOf(name: string): string[] {
  return normalizeTeamName(name).split('-').filter(Boolean);
}

export function matchFixtureOdds<T extends MatchableEvent>(fixture: MatchableFixture, events: T[]): T | undefined {
  const kickoff = Date.parse(fixture.kickoff);
  if (!Number.isFinite(kickoff)) return undefined;
  const fh = tokensOf(fixture.home);
  const fa = tokensOf(fixture.away);
  return events.find(event => {
    const eh = tokensOf(event.home_team);
    const ea = tokensOf(event.away_team);
    const teamOk = (a: string[], b: string[]) => {
      if (!a.length || !b.length) return false;
      const sa = new Set(a), sb = new Set(b);
      // every token of the smaller side appears in the other (handles 'real madrid' vs 'madrid', 'milan' vs 'inter-milan'? no — guarded by both teams)
      return (sa.size <= sb.size ? a.every(t => sb.has(t)) : b.every(t => sa.has(t)));
    };
    return teamOk(fh, eh) && teamOk(fa, ea) && Math.abs(Date.parse(event.commence_time) - kickoff) < 18 * 60 * 60 * 1000;
  });
}
