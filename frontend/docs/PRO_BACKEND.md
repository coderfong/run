# PASER PRO — what the frontend needs that the API cannot answer yet

Written alongside the monetisation build (2026-08-17). Everything in here is a
surface that is **already built and wired on the client** and is currently
either rendering nothing, rendering without a teaser value, or holding state
on-device that really belongs on the server.

Nothing listed here is faked in the app. Where the data does not exist, the UI
says so or shows nothing — see the honesty rule at the top of
`src/map/intelligence.js` and the teaser contract in
`src/components/ProTeaser.js`.

---

## 1. Result / RunDetail teaser previews  ·  *medium value, small change*

**Where:** `src/components/TerritoryInsights.js`, the locked rows.

**Problem.** `GET /runs/{id}/insights` returns `pro: null` for a free account,
so the locked rows have no real number to show and render as bare titles. The
brief for this work asked for rows like `Territory efficiency: Top 18% 🔒`,
which is a much stronger teaser — but the client has nothing true to put there
and inventing one would be a lie the runner discovers the moment they pay.

**Suggested contract.** Add a small, deliberately incomplete teaser block to
the free response:

```jsonc
// GET /runs/{run_id}/insights
{
  "...": "existing free fields unchanged",
  "pro": null,
  "pro_teaser": {                    // NEW, present only when pro is null
    "efficiency_percentile": 18,     // int 1..100, this run's m2_per_km against
                                     //   the runner's own last 30 days
    "is_personal_best": true,        // bool — already computed in _pro_block
    "at_risk_count": 3               // int — already computed in _pro_block
  }
}
```

All three are already calculated inside `_pro_block` in
`backend/app/routes/insights.py`; this only asks for three scalars to be
lifted out of the paid block. Note `efficiency_percentile` is against the
runner's **own** history, not against other runners — a percentile across the
playerbase would leak other people's performance.

**Client change once it lands:** pass `preview` on the matching rows in
`TerritoryInsights`. `ProTeaser` already renders them.

---

## 2. Leaderboard rank history  ·  *high value, real work*

**Where:** `src/screens/SeasonScreen.js` (PRO filters exist), and the Home
contextual card in `src/components/ProHomeCard.js`.

**Problem.** Nothing stores a runner's rank over time. So:

* the "rank history" PRO filter can show a board but not a **trend**;
* the strongest Home teaser available (`#128 → #72, +56 this month`) cannot be
  built at all, and `ProHomeCard` deliberately ships without it rather than
  approximating;
* `notableRun` cannot use "leaderboard climb" as a trigger, which was asked
  for — see the note in `src/pro/notableRun.js`.

**Suggested contract.**

```jsonc
// GET /leaderboard/history?category=land&window=30d
// PRO only (require_pro). 402 turns into the paywall client-side already.
{
  "points": [
    { "at": "2026-07-18", "rank": 128, "field": 4210, "value": 1420000.0 },
    { "at": "2026-07-25", "rank": 96,  "field": 4380, "value": 1810000.0 }
  ],
  "change": { "ranks": 56, "since": "2026-07-18" }   // for the one-line teaser
}
```

```jsonc
// GET /leaderboard/standing   (EXISTING, never gated — add two fields)
{
  "...": "existing",
  "rank_7d_ago": 128,       // NEW, nullable
  "rank_30d_ago": 184       // NEW, nullable
}
```

The two fields on `standing` are the important half: they are what makes the
free contextual Home card and the notable-run "climb" trigger possible, and
they are cheap next to the full series.

**Storage.** Needs a daily snapshot table (`user_id, day, category, rank,
field, value`) written by a cron — the same place the bot-activity cron lives.
Ranks cannot be backfilled, so this starts producing value only from the day
it ships. Worth starting early for that reason alone.

---

## 3. Map layer: "Highly contested"  ·  *declared, unavailable*

**Where:** `src/map/intelligence.js`, the `churn` layer. It is declared with
`available: false`, matches nothing, and the layers sheet tells the runner it
is not available yet rather than drawing a guess.

**Problem.** `GET /map-polygons` returns no ownership-change count. The data
exists — `territory_events` (migration 0038, see
`backend/app/territory_history.py`) — but is never aggregated per polygon.

**Suggested contract.**

```jsonc
// GET /map-polygons — one field per territory
{
  "territories": [
    { "...": "existing", "owner_changes": 4 }   // NEW: count of ownership
                                                //   transfers in the window
  ]
}
```

Worth capping the window (say 30 days) and the cost — this is the hottest
read path in the app and it must not grow a per-row subquery. A materialised
count on the territory row, updated when an event is written, is likely the
right shape.

**Client change:** flip `available: true` and set a `shade` from
`owner_changes`. Nothing else.

---

## 4. Territory Planner allowance  ·  *works on-device, belongs on the server*

**Where:** `src/pro/exposure.js`, `plannerPreviewsLeft` / `notePlannerUse`.

**Current behaviour.** Three free previews, persisted in AsyncStorage,
surviving app restarts. It does **not** survive a reinstall or move between
devices.

**This is deliberate and is probably fine.** The planner is a courtesy trial,
not a licence — it reads polygons the client already has, so a determined
person can reach the same conclusions from the API directly. Treating it as a
security boundary would be theatre. What actually protects paid features is
`require_pro` on the server.

If the count should be authoritative anyway:

```jsonc
// GET  /me/pro/allowances          →  { "planner_previews_used": 2, "limit": 3 }
// POST /me/pro/allowances/planner  →  { "planner_previews_used": 3, "limit": 3 }
```

`src/pro/exposure.js` is the only module that would change; the screen calls
`spendPlannerPreview()` and does not care where the number lives.

---

## 5. Share styles that are not presets  ·  *card work, not API work*

**Where:** `src/config/shareStyles.js`.

Three requested styles are **not** implemented, and the file says so rather
than shipping approximations:

| Style | What it actually needs |
|---|---|
| Animated | A video/GIF encoder and an export path that is not `captureRef`. |
| Season Recap | Season aggregates the card is never passed (`GET /me/season/summary`). |
| Territory Takeover | The claim polygon drawn on the card; the card is given a route, not a claim. |

The share card is the one surface in this app with a crash history
(`docs/SHARING.md`), so each of these is real work on `RunShareCard` and
should be scoped on its own rather than smuggled in behind a preset.

---

## 6. Pay to win: an open question that is NOT a frontend bug

**This is the most important item in this document.**

`backend/app/progression.py`, `premium_rewards_for_level()` grants the PRO
reward track **more energy than the free track**: `+30`/`+50` per tier against
free's `+15`/`+25`, plus `+25` on every lootbox tier.

Energy is the claim limiter (`backend/app/energy.py` — runs are always free,
energy is spent to *claim*). So PRO currently buys **more claims**, which is
advantage bought with money. That contradicts, in this order:

* `backend/app/entitlements.py`, module docstring: *"Nothing in this module may
  be used to gate ... energy"*;
* `frontend/src/config/pro.js`: *"WHAT PRO NEVER SELLS: power ... not cheaper
  energy"*;
* the test in `__tests__/proEntitlement.test.js` that fails the build if a perk
  line *says* this — which passed the whole time, because the code did it
  without the copy admitting to it.

**What was changed here:** only the advertising. `ProStep.js` no longer says
"More energy to claim with" or "Double rewards, every level", and
`ProfileScreen`'s PRO poster no longer says "Twice the rewards."

**What was deliberately NOT changed:** the ladder itself. It is a live economy
that existing subscribers have already bought into, and rebalancing it is a
product decision with refund and complaint consequences — not something a
frontend monetisation branch should do unilaterally.

**Suggested fix, if you want it.** In `premium_rewards_for_level`, swap the
energy grants for something that does not gate play — coins buy cosmetics only
(`app/coins.py` makes the same no-power promise), so they are the natural
substitute:

```python
    if level in LOOTBOX_LEVELS:
        rarity = _RARITY_UP[lootbox_rarity(level)]
        out.append({"kind": "lootbox", "key": rarity, "label": _label_for("lootbox", rarity)})
-       out.append({"kind": "energy", "key": "+25", "label": "+25"})
+       out.append({"kind": "coins", "key": "+250", "label": "+250"})
        return out
    if level in PREMIUM_ITEMS:
        ...
-   amount = 50 if level % 10 == 0 else 30
-   return [{"kind": "energy", "key": f"+{amount}", "label": f"+{amount}"}]
+   amount = 500 if level % 10 == 0 else 300
+   return [{"kind": "coins", "key": f"+{amount}", "label": f"+{amount}"}]
```

Note this makes the PRO track *cosmetically* richer and *competitively*
identical, which is the stated design. It will need a migration decision for
subscribers mid-ladder, and `check:catalog` should be re-run afterwards.
