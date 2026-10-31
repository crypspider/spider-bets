-- SPIDER BETS stage 1. Apply in Supabase SQL Editor.
create extension if not exists pgcrypto;
create type public.app_role as enum ('user','admin');
create type public.txn_type as enum ('signup_bonus','daily_bonus','bet_stake','bet_return','admin_adjustment','void_refund');
create type public.bet_status as enum ('pending','won','lost','void');
create type public.fixture_status as enum ('scheduled','live','finished','postponed','cancelled');
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, username text unique, display_name text, role public.app_role not null default 'user', avatar_url text, created_at timestamptz not null default now());
create table public.wallets (user_id uuid primary key references auth.users(id) on delete cascade, balance numeric(14,2) not null default 100000 check(balance>=0), updated_at timestamptz not null default now());
create table public.transactions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), type public.txn_type not null, amount numeric(14,2) not null, balance_after numeric(14,2) not null, reference_id uuid, note text, created_at timestamptz not null default now());
create table public.competitions (id bigint primary key, name text not null, country text, season int, logo_url text, source text not null default 'api-football', updated_at timestamptz not null default now());
create table public.teams (id bigint primary key, name text not null, short_name text, logo_url text, country text, source text not null default 'api-football', updated_at timestamptz not null default now());
create table public.fixtures (id bigint primary key, competition_id bigint references public.competitions(id), home_team_id bigint references public.teams(id), away_team_id bigint references public.teams(id), kickoff timestamptz not null, status public.fixture_status not null default 'scheduled', home_score int, away_score int, venue text, source text not null default 'api-football', updated_at timestamptz not null default now());
create table public.bookmakers (id text primary key, name text not null, updated_at timestamptz not null default now());
create table public.markets (id text primary key, name text not null, description text);
insert into public.markets(id,name) values ('h2h','Match Result'),('totals','Over/Under'),('spreads','Handicap') on conflict do nothing;
create table public.odds (id uuid primary key default gen_random_uuid(), fixture_id bigint not null references public.fixtures(id) on delete cascade, bookmaker_id text not null references public.bookmakers(id), market_id text not null references public.markets(id), outcome text not null, price numeric(10,4) not null check(price>1), point numeric(10,3), fetched_at timestamptz not null default now(), unique(fixture_id,bookmaker_id,market_id,outcome,point));
create index odds_fixture_idx on public.odds(fixture_id,fetched_at desc);
create table public.bet_slips (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), status text not null default 'open' check(status in ('open','placed','cancelled')), created_at timestamptz not null default now());
create table public.bets (id uuid primary key default gen_random_uuid(), slip_id uuid not null references public.bet_slips(id), user_id uuid not null references auth.users(id), bet_type text not null check(bet_type in ('single','accumulator')), stake numeric(14,2) not null check(stake>0), combined_odds numeric(12,4) not null check(combined_odds>1), potential_return numeric(14,2) not null, status public.bet_status not null default 'pending', settled_at timestamptz, created_at timestamptz not null default now());
create table public.selections (id uuid primary key default gen_random_uuid(), bet_id uuid not null references public.bets(id) on delete cascade, fixture_id bigint not null references public.fixtures(id), market_id text not null references public.markets(id), outcome text not null, odds numeric(10,4) not null check(odds>1), result text not null default 'pending' check(result in ('pending','won','lost','void')), created_at timestamptz not null default now());
create index selections_fixture_idx on public.selections(fixture_id);
create table public.settlements (id uuid primary key default gen_random_uuid(), bet_id uuid not null unique references public.bets(id), result public.bet_status not null, payout numeric(14,2) not null default 0, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), title text not null, body text not null, read_at timestamptz, created_at timestamptz not null default now());
create table public.audit_logs (id bigint generated always as identity primary key, actor_id uuid references auth.users(id), action text not null, entity text not null, entity_id text, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create table public.daily_bonus_claims(user_id uuid not null references auth.users(id), claim_date date not null default (now() at time zone 'utc')::date, amount numeric(14,2) not null default 1000, primary key(user_id,claim_date));

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.profiles(id,username,display_name) values(new.id, nullif(new.raw_user_meta_data->>'username',''), coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1))) on conflict(id) do nothing; insert into public.wallets(user_id,balance) values(new.id,100000) on conflict(user_id) do nothing; insert into public.transactions(user_id,type,amount,balance_after,note) values(new.id,'signup_bonus',100000,100000,'Welcome virtual demo balance'); return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin'); $$;

create or replace function public.place_bet(p_stake numeric,p_selections jsonb,p_bet_type text default 'single') returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); slip uuid; bid uuid; bal numeric; n int; combo numeric; potential numeric;
begin
 if uid is null then raise exception 'authentication required'; end if;
 if p_stake<=0 or p_stake>10000000 then raise exception 'invalid stake'; end if;
 if p_bet_type not in ('single','accumulator') then raise exception 'invalid bet type'; end if;
 if jsonb_typeof(p_selections)<>'array' or jsonb_array_length(p_selections)<1 then raise exception 'add at least one selection'; end if;
 n:=jsonb_array_length(p_selections); if p_bet_type='single' and n<>1 then raise exception 'single bet needs exactly one selection'; end if;
 if p_bet_type='accumulator' and n<2 then raise exception 'accumulator needs at least two selections'; end if;
 select balance into bal from public.wallets where user_id=uid for update; if bal is null or bal<p_stake then raise exception 'insufficient virtual balance'; end if;
 if exists(select 1 from jsonb_array_elements(p_selections) s where not exists(select 1 from public.fixtures f where f.id=(s->>'fixture_id')::bigint and f.status='scheduled') or not exists(select 1 from public.markets m where m.id=s->>'market_id') or (s->>'odds')::numeric<=1 or (s->>'odds')::numeric>1000 or nullif(trim(s->>'outcome'),'') is null) then raise exception 'selection is unavailable or odds are invalid'; end if;
 if exists(select 1 from (select (s->>'fixture_id')::bigint id from jsonb_array_elements(p_selections) s) q group by id having count(*)>1) then raise exception 'only one selection per fixture'; end if;
 select exp(sum(ln((s->>'odds')::numeric))) into combo from jsonb_array_elements(p_selections) s; potential:=round(p_stake*combo,2);
 insert into public.bet_slips(user_id,status) values(uid,'placed') returning id into slip;
 insert into public.bets(slip_id,user_id,bet_type,stake,combined_odds,potential_return) values(slip,uid,p_bet_type,p_stake,combo,potential) returning id into bid;
 insert into public.selections(bet_id,fixture_id,market_id,outcome,odds) select bid,(s->>'fixture_id')::bigint,s->>'market_id',s->>'outcome',(s->>'odds')::numeric from jsonb_array_elements(p_selections) s;
 update public.wallets set balance=balance-p_stake,updated_at=now() where user_id=uid returning balance into bal;
 insert into public.transactions(user_id,type,amount,balance_after,reference_id,note) values(uid,'bet_stake',-p_stake,bal,bid,'Virtual stake');
 insert into public.audit_logs(actor_id,action,entity,entity_id,details) values(uid,'bet_placed','bet',bid::text,jsonb_build_object('stake',p_stake,'selection_count',n,'type',p_bet_type));
 return jsonb_build_object('bet_id',bid,'balance',bal,'combined_odds',combo,'potential_return',potential);
end; $$;

create or replace function public.settle_fixture(p_fixture_id bigint,p_home_score int,p_away_score int) returns int language plpgsql security definer set search_path=public as $$
declare s record; sel_result text; bet_result public.bet_status; payout numeric; bal numeric; settled int:=0; actual text;
begin
 if not public.is_admin() then raise exception 'admin only'; end if;
 update public.fixtures set status='finished',home_score=p_home_score,away_score=p_away_score,updated_at=now() where id=p_fixture_id;
 for s in select distinct b.id,b.user_id,b.stake,b.status from public.bets b join public.selections x on x.bet_id=b.id where x.fixture_id=p_fixture_id and b.status='pending' loop
   update public.selections x set result=case when x.market_id='h2h' and ((x.outcome='Home' and p_home_score>p_away_score) or (x.outcome='Away' and p_home_score<p_away_score) or (x.outcome='Draw' and p_home_score=p_away_score)) then 'won' when x.market_id='h2h' then 'lost' else 'void' end where x.bet_id=s.id and x.fixture_id=p_fixture_id and x.result='pending';
   if not exists(select 1 from public.selections where bet_id=s.id and result='pending') then
     if exists(select 1 from public.selections where bet_id=s.id and result='lost') then bet_result:='lost'; payout:=0;
     elsif exists(select 1 from public.selections where bet_id=s.id and result='void') then bet_result:='void'; payout:=s.stake;
     else bet_result:='won'; select round(s.stake*exp(sum(ln(odds))),2) into payout from public.selections where bet_id=s.id; end if;
     update public.bets set status=bet_result,settled_at=now() where id=s.id and status='pending';
     insert into public.settlements(bet_id,result,payout) values(s.id,bet_result,payout) on conflict(bet_id) do nothing;
     if payout>0 then update public.wallets set balance=balance+payout,updated_at=now() where user_id=s.user_id returning balance into bal; insert into public.transactions(user_id,type,amount,balance_after,reference_id,note) values(s.user_id,case when bet_result='void' then 'void_refund'::public.txn_type else 'bet_return'::public.txn_type end,payout,bal,s.id,'Virtual bet settlement'); end if;
     insert into public.notifications(user_id,title,body) values(s.user_id,'Bet settled', 'Your bet was settled as '||bet_result::text||'.'); settled:=settled+1;
   end if;
 end loop;
 insert into public.audit_logs(actor_id,action,entity,entity_id,details) values(auth.uid(),'fixture_settled','fixture',p_fixture_id::text,jsonb_build_object('home_score',p_home_score,'away_score',p_away_score,'bets_settled',settled));
 return settled;
end; $$;
create or replace function public.claim_daily_bonus() returns numeric language plpgsql security definer set search_path=public as $$ declare uid uuid:=auth.uid(); newbal numeric; begin if uid is null then raise exception 'authentication required'; end if; insert into public.daily_bonus_claims(user_id,claim_date,amount) values(uid,(now() at time zone 'utc')::date,1000); update public.wallets set balance=balance+1000,updated_at=now() where user_id=uid returning balance into newbal; insert into public.transactions(user_id,type,amount,balance_after,note) values(uid,'daily_bonus',1000,newbal,'Daily virtual bonus'); return newbal; exception when unique_violation then raise exception 'daily bonus already claimed'; end; $$;

alter table public.profiles enable row level security; alter table public.wallets enable row level security; alter table public.transactions enable row level security; alter table public.competitions enable row level security; alter table public.teams enable row level security; alter table public.fixtures enable row level security; alter table public.bookmakers enable row level security; alter table public.markets enable row level security; alter table public.odds enable row level security; alter table public.bet_slips enable row level security; alter table public.bets enable row level security; alter table public.selections enable row level security; alter table public.settlements enable row level security; alter table public.notifications enable row level security; alter table public.audit_logs enable row level security; alter table public.daily_bonus_claims enable row level security;
create policy "profiles readable" on public.profiles for select using (id=auth.uid() or public.is_admin()); create policy "profile self update" on public.profiles for update using(id=auth.uid()) with check(id=auth.uid() and role='user');
create policy "wallet own/admin" on public.wallets for select using(user_id=auth.uid() or public.is_admin());
create policy "tx own/admin" on public.transactions for select using(user_id=auth.uid() or public.is_admin());
create policy "public competitions" on public.competitions for select using(true); create policy "public teams" on public.teams for select using(true); create policy "public fixtures" on public.fixtures for select using(true); create policy "public bookmakers" on public.bookmakers for select using(true); create policy "public markets" on public.markets for select using(true); create policy "public odds" on public.odds for select using(true);
create policy "slips owner/admin" on public.bet_slips for select using(user_id=auth.uid() or public.is_admin()); create policy "bets owner/admin" on public.bets for select using(user_id=auth.uid() or public.is_admin()); create policy "selections owner/admin" on public.selections for select using(exists(select 1 from public.bets b where b.id=bet_id and (b.user_id=auth.uid() or public.is_admin()))); create policy "settlements owner/admin" on public.settlements for select using(exists(select 1 from public.bets b where b.id=bet_id and (b.user_id=auth.uid() or public.is_admin()))); create policy "notifications own/admin" on public.notifications for select using(user_id=auth.uid() or public.is_admin()); create policy "notifications mark own" on public.notifications for update using(user_id=auth.uid()) with check(user_id=auth.uid()); create policy "audit admin only" on public.audit_logs for select using(public.is_admin());
grant execute on function public.place_bet(numeric,jsonb,text) to authenticated; grant execute on function public.claim_daily_bonus() to authenticated; grant execute on function public.settle_fixture(bigint,int,int) to authenticated;
-- Assign the first super-admin manually after registering: update public.profiles set role='admin' where username='your_username';
