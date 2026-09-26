# Seeded world activity director

The seeded world is 384 bot accounts (`users.is_bot`, `bot_accounts`) in 24
clubs. They make **real** runs, claims, steals, Elo matches and club runs
through the same code a human claim uses. This document covers what decides
*when and why* they run.

## Pieces

| File | Role |
|---|---|
| `backend/bot_activity.py` | Cron entry point (`run-bots`, every 15 min). Plans a tick, executes it, logs it. `--dry-run`, `--simulate-hours`. |
| `backend/bot_director.py` | The policy. Pure functions over a snapshot, so it is unit tested without a database. |
| `backend/bot_observe.py` | The reads: one `Snapshot` per tick (rolling activity, territories, bots, active humans, rivalries, intents, hotspots). |
| `backend/bot_world.py` | Bot identity and motion: names, routes, archetypes and cadence, timestamped group traces, the run writer. |
| `backend/bot_sim_config.py` | Every tunable, read from `BOT_*` env vars. Its docstring lists each one. |
| `backend/bot_simulate.py` | Simulate N hours in a rolled-back transaction. |
| `backend/app/claim_consequences.py` | Steal ledger, rank points, Elo and victim alerts for a landed claim. Shared by `/claim-territory` and the bots. |
| `alembic 0046` | `bot_world_intents` (scheduled reactions and cooldown ledger), `bot_hotspots`, and two activity indexes. |

## One tick

1. **Observe.** Real and bot claims, battles and club group runs in the last
   60 minutes, per region. Slower 24h signals decide each region's share.
2. **Targets.** `BOT_WORLD_TARGET_*_PER_HOUR` × time of day (1.0 in the
   05:30–08:00 and 17:30–21:30 SGT peaks, down to
   `BOT_NIGHT_MULTIPLIER` overnight) × `BOT_ACTIVITY_SCALE`.
3. **Regions.** Each region's share comes from recent human runs and claims,
   human territory, active clubs, the bot population, combat and hotspots,
   with a floor (`BOT_REGION_MIN_SHARE`) so no region goes dead.
4. **Humans first.** Per region, `bot_quota`:
   `owed = max(0, target − human_last_hour)`. The tick pays its slice of that,
   plus a proportional correction toward the bots' own rolling count. Once real
   players meet a target, the quota is zero. The only bot runs left are
   due bots at `BOT_BACKGROUND_FLOOR`; every other due bot gets a rest day.
5. **Engagement director.**
   - Every human claim rolls four reactions once: `nearby` 0.5–3h, `probe`
     2–8h, `attack` 6–24h, and `revenge` 1–3 days, the last only when the claim
     took land from a bot, which is the bot that comes back.
   - Every active player (ran within `BOT_HUMAN_ACTIVE_DAYS`, holds land) has a
     rolling 24/48h interaction score. A fight with another real player counts
     `BOT_HUMAN_ORGANIC_WEIGHT`×. Below the soft floor
     (`BOT_HUMAN_DAILY_INTERACTIONS`), one floor intent is scheduled hours
     ahead.
   - Nothing lands between 23:30 and 05:30.
6. **Due intents → runs.**
   - Checked first: the hard daily ceiling, saturation, and the per-player
     cooldown (`BOT_HUMAN_ATTACK_COOLDOWN_H`). An intent on cooldown is
     deferred, not dropped.
   - The bot must be in the player's **live Elo tier**, not a clubmate, within
     `BOT_HUMAN_PRESSURE_RADIUS_M` (then the fallback radius), free to run, and
     past the pair cooldown.
   - Scoring prefers known rivals and bots with a grudge, and penalises the
     player's last two attackers so faces rotate.
7. **Region plan.**
   - Club group runs come first: clubs in their standing session, or unseen
     for a while.
   - Then combat: retake land lost in the last day, a rematch, or a
     front-line raid on a bot in the same tier and another club.
   - Then frontier expansion: points scored toward borders, contested
     corridors, human areas and hotspots, and away from the bot's own interior.
   - Due bots fill slots first; rested bots are pulled forward only within
     their archetype's weekly habit.
8. **Execute.** Each run gets a synthesised route aimed by its mode (`edge`,
   `nibble`, `push`, `takeover`, `frontier`). It becomes a `runs` row, goes
   through the `club_runs.log_run` probe and `_claim_territory`, then
   `claim_consequences.settle`, and `sync_credit` for club credit.
   - A fully defended claim rolls back exactly like a human's 409. The run
     stands and the bot is rescheduled.
   - Real victims get the same "captured" / "defended" push a human attacker
     triggers, sent after commit.

## Group runs and club validation

A group shares:
- one route, with each member's own GPS noise on top
- one start, within ±3 s
- one pace, the slowest member's
- one speed profile

Each member's run stores a `together_trace` of fixes every 5 s. The second and
later finishers pass the unchanged human matcher: path share ≥ 60% within
35 m, and `nearby_in_time`. Only then does `attribute_territories` make the
land club land. Before this change, bot runs carried no trace and the matcher
fails closed, so no bot club run had counted since 2026-09-10.

## Safety rules

- Min gap between a bot's runs: `BOT_MIN_RUN_GAP_H`.
- Daily cap per archetype. Only daily and hardcore runners double, and the
  second run is at most 10 km.
- Weekly habit for pulled-forward runs.
- Per-tick and per-hour hard caps.
- At most one pressure run per player per tick.
- Row lock per bot, and an advisory lock per tick.
- Runs end inside the last tick window, never in the future.
- Rank-tier combat, club membership and expiry all live in the shared claim
  code. The director cannot bypass them.

## Operating it

```bash
python bot_activity.py --dry-run
```
Read-only transaction. Shows targets, activity, per-region quotas, eligible
bots, human engagement scores, intents it would schedule or resolve, and every
planned run with its predicted overlap.

```bash
python bot_activity.py --simulate-hours 24 --sim-humans 3 --sim-start-sgt 5
```
Local databases only. Clone first:
`CREATE DATABASE territory_run_botsim TEMPLATE territory_run`, then seed it.
Add `--sim-human-claims-per-hour 40` to watch bots back off.

Each live tick prints a readable block plus one `BOT_TICK_JSON {...}` line in
the Render logs. Kill switch: `BOT_ACTIVITY_SCALE=0`.

`bot_world_intents` explains an empty world from the database.
`status/reason` shows what was skipped and why: `not_rolled`, `saturated`,
`cooldown`, `no_eligible_bot`, `floor_met`, `run_failed`.
