# SPIDER BETS

Football betting simulator using virtual money only. No deposits, withdrawals, or real-money payouts.

## Requirements

Node.js 20+, a Supabase project, API-Football and The Odds API credentials.

## Setup and exact local commands

1. Create a Supabase project. Paste and run `supabase/schema.sql` in its SQL Editor.
2. In Supabase Authentication, enable email/password. Set the Site URL and allowed redirect URLs for your local and deployed origins. Configure email verification and password recovery email templates/settings as desired.
3. Copy `.env.example` to `.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `API_FOOTBALL_KEY`, and `THE_ODDS_API_KEY`. The provider keys are server-only; never put them in `NEXT_PUBLIC_` variables or commit `.env.local`.
4. Run:

```bash
cd spider-bets
npm install
npm run dev
```

Open http://localhost:3000.

Checks:

```bash
npm run typecheck
npm test
npm run build
```

## API feeds and quotas

`GET /api/fixtures` fetches the API-Football season configured in `API_FOOTBALL_SEASON` (default 2024) for the configured leagues (default Premier League, ID 39). Free-plan use is explicitly restricted to seasons 2022, 2023, or 2024; the endpoint refuses other years rather than silently requesting unavailable data. Requests are cached for one hour and multiple league requests are spaced by one second. It returns historical season fixtures, not upcoming fixtures. `GET /api/odds` fetches real h2h decimal odds from The Odds API for EPL, La Liga, Serie A, Bundesliga, Ligue 1, UCL, UEL, UECL, and EFL Championship. It is cached for 15 minutes. Missing credentials and provider failures produce explicit unavailable states, never invented fixtures or prices. Trim the league/sport lists to preserve quota.
The supplied API-Football key is live and authenticated. The current free-plan fixture query was verified with season 2024 and returned 380 real Premier League fixtures. The Odds API key responded successfully and returned 21 EPL events in a direct provider check; the app endpoint returned 165 real events across its configured sports during verification. These are distinct snapshots: historical fixtures and current odds do not necessarily match, so the app will only offer bets when a fixture has a matching live odds event.
The admin-only `POST /api/admin/sync` endpoint matches provider events to fixtures and upserts competitions, teams, fixtures, bookmaker records and odds into Supabase. It requires a valid Supabase bearer access token, a profile with role `admin`, server-side service key, both sports API keys, and rate-limits sync requests to one per five minutes per server process. Syncing is manual in stage 1, not a background job. Use `API_FOOTBALL_LEAGUES` and `API_FOOTBALL_SEASON` to match subscription and competition coverage.

## What works in stage 1

Supabase Auth handles email/password signup, login, logout, email verification settings, and password recovery. The database signup trigger creates a profile, ₦100,000 virtual wallet, and signup ledger row. Daily demo bonus is ₦1,000 per UTC date, protected by a unique user/date claim.

Bet placement is handled atomically by the `place_bet` Postgres RPC: validates stake, single/accumulator selection count, available scheduled fixture/odds and wallet balance; locks the wallet; rejects multiple picks on the same fixture; saves bet slip, bet and picks; debits stake; records transaction and audit log. Combined odds multiply decimal selections. Potential return is stake times combined odds.

Settlement is a manual admin action in the dashboard, not automatic polling. It calls `settle_fixture` for an admin-supplied final score, resolves supported h2h picks, waits for all accumulator picks to resolve, and applies a unique settlement record to avoid duplicates. Winnings or void refunds update the virtual wallet and ledger; notifications and audit rows are added. Only submit scores verified from an official result source.

The dashboard has match filters/search, wallet, daily bonus, bet slip, recent bet/transaction views and admin counts/settlement. Picks are disabled if live provider odds do not match. A custom spider SVG is used as the favicon and app mark.

## Admin and security

Register an account, then use Supabase SQL Editor to promote it, replacing the username:

```sql
update public.profiles set role='admin' where username='your_username';
```

RLS is enabled for every app table. Users can read their own wallet, bets, transactions and notifications. Public reads are limited to fixtures/teams/competitions/bookmakers/markets/odds. Betting, daily bonus and settlement mutations run through security-definer functions; admin settlement checks role. Provider sync checks the signed-in admin with Supabase Auth, then performs server-side upserts. Keep `SUPABASE_SERVICE_ROLE_KEY` server-side. Audit the RLS policies and provider licensing/quota before production use.

## Vercel deployment

Push to Git, import the repository into Vercel as a Next.js project, configure all variables from `.env.example` in Project Settings, deploy, and add the deployed URL to Supabase Auth Site URL/redirect allowlist. Apply `supabase/schema.sql` once to the Supabase project. Verify current-season access with API-Football and provider quotas before expecting current fixtures. Sign in as an admin and run manual provider sync after deployment.

## Verification, exact scope

Passed in this workspace: `npm run typecheck`; `npm test` (3 tests for single return, accumulator multiplication, invalid odds); `npm run build`; local development server returned HTTP 200 for `/`; real `/api/fixtures` returned 380 Premier League fixtures from API-Football season 2024; real `/api/odds` returned 165 events across configured sports. A direct Odds API check returned 21 EPL events. No provider data or user records were mocked.

Not tested: Supabase registration/verification/recovery, executing the schema, live bet placement and wallet mutation, database settlement, or admin actions. No Supabase project URL/key/service key was available. The fixture records are historical season 2024 and The Odds API returns current events, so they generally will not match for bet placement; a matching event with real odds is required. Current 2026 fixtures are blocked by the free API-Football plan's season limit. These integrations need a configured Supabase project and a current-season data plan before a full user journey can be tested.
## Project map

`app/` Next.js UI and API endpoints. `lib/betting.test.ts` calculation tests. `supabase/schema.sql` schema, RLS, signup trigger, wallet/bet/settlement functions. `public/spider.svg` logo/favicon. `.env.example` safe environment template.
