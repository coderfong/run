from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # "development" or "production". Production enforces config hygiene at
    # startup: a real JWT_SECRET and explicit CORS origins (see main.py).
    env: str = "development"

    database_url: str = "postgresql://run:run@localhost:5432/run"

    # JWT — MUST be overridden via env var in production.
    jwt_secret: str = "dev-only-change-me-in-prod"
    jwt_algorithm: str = "HS256"
    jwt_expire_days: int = 30
    # Clients silently refresh when this close to expiry (see /auth/refresh).
    jwt_refresh_window_days: int = 7

    # CORS — comma-separated list of allowed origins, or "*" to allow all
    # (dev only; production refuses to boot with "*").
    cors_origins: str = "*"

    # Sentry — no-op when unset.
    sentry_dsn: str = ""

    # Shared secret for the /admin/* maintenance endpoints (the expiry sweep,
    # the season recompute). These mutate every player's data, so they are NOT
    # open: without a token set they return 404 — the endpoint simply does not
    # exist as far as the outside world is concerned, which tells a prober
    # nothing. Set it in the environment and send it as `X-Admin-Token`.
    admin_token: str = ""

    # App version reported by GET /version (override per deploy).
    app_version: str = "2.1.0"

    # The COMMIT this process is running, reported by GET /version.
    #
    # `app_version` cannot answer "is my fix live" — it is a hand-maintained
    # string that only moves when somebody edits the deploy config, so it says
    # the same version through any number of pushes. That gap is not academic: three
    # separate times this build, "did the deploy take" could only be answered
    # by inference, and for a change living inside an authenticated handler it
    # could not be answered at all.
    #
    # Render injects RENDER_GIT_COMMIT into every service automatically, so
    # this needs no dashboard entry and no blueprint edit — it is populated by
    # the platform on Render and empty everywhere else, which is exactly the
    # honest answer when running locally.
    render_git_commit: str = ""

    # Loop / polygon validation thresholds.
    # Tuned to filter out GPS jitter and trivial micro-loops.
    min_loop_points: int = 8           # minimum GPS samples before we look for a loop
    min_loop_area_m2: float = 200.0    # ignore loops smaller than this (anti-jitter)
    max_polygon_area_m2: float = 1_250_000.0  # 1.25 km^2 — the ceiling one claim
                                       # can reach. With diminishing returns it
                                       # needs ~74 real km to touch, so it is a
                                       # sanity bound rather than the wall the
                                       # old 12.5 km cap was.
    closure_radius_m: float = 25.0     # if current point is within this of an earlier
                                       # segment, we treat it as a loop closure
    simplify_tolerance_m: float = 1.5  # douglas-peucker tolerance for cleanup
    max_speed_mps: float = 12.0        # ~43 km/h, drop GPS points exceeding this
    # A fix this coarse says nothing about where a runner moving 3 m/s went,
    # and stringing such fixes together invents distance out of pure error.
    # Mirrors the client's live gate (frontend/src/run/gpsFilter.js) so the
    # number a runner watches and the number they are paid for agree.
    max_accuracy_m: float = 35.0
    # ...unless the whole trace is that coarse, in which case the run happened
    # somewhere with genuinely bad reception and dropping most of it would be
    # worse than keeping it. Below this surviving share, the gate stands down.
    min_accurate_share: float = 0.34

    # ---- what counts as a run --------------------------------------------
    # Two thresholds, because "worth rewarding" and "worth a piece of the map"
    # are different bars. Below the REWARDED line an activity still saves, but
    # pays nothing at all — a phone shaken on a desk must not mint currency.
    # Between the lines it pays distance XP but cannot take ground. Only above
    # the CLAIM line does the full loop open up.
    min_rewarded_distance_m: float = 500.0
    min_rewarded_duration_s: float = 240.0
    min_claim_distance_m: float = 1000.0
    min_claim_duration_s: float = 420.0
    # Distance alone is spoofable by pacing a room: this is how much DISTINCT
    # ground the route covered (see geospatial.route_unique_length_m), so
    # forty laps of a corridor stay forty laps of a corridor.
    min_unique_route_length_m: float = 700.0

    # ---- claims ----------------------------------------------------------
    # How much land a run earns, per metre of TERRITORIAL distance (see
    # `territorial_distance_m` — real distance with diminishing returns past
    # 5 km). 75 m²/m is about a 75 m-wide corridor along the route, which is a
    # neighbourhood; the old 400 was a ~400 m-wide swathe and a few runners
    # could paint out most of a city.
    claim_area_per_m: float = 75.0
    claim_circle_segments: int = 64        # polygon vertices approximating the circle
    claim_snap_tolerance_m: float = 30.0   # legacy: how close a given centre must sit

    # ---- route-grown territory -------------------------------------------
    # The earned area is not stamped as a fixed shape: it is GROWN around the
    # run's own route, so the territory keeps the silhouette of where you
    # went. See geospatial.route_claim_polygon_wgs.
    claim_anchor_min: int = 4          # simplified route keeps at least this many turns
    claim_anchor_max: int = 12         # ...and at most this many, so the silhouette is
                                       # the broad shape and not every GPS wobble
    claim_min_width_m: float = 140.0   # no part of a claim may be narrower than this —
                                       # what stops a run reading as a coloured ribbon
    claim_max_aspect: float = 10.0     # compactness pressure: a claim may span at most
                                       # sqrt(aspect × area) end to end, so a very long
                                       # run makes a fat capsule, never a 40 km streak
    claim_smooth_frac: float = 0.55    # closing/opening radius as a fraction of the
                                       # half-width: fills necks, then kills tentacles

    # ---- claim placement (\"choose your attack\") ---------------------------
    # The run earns a fixed amount of land; WHERE along the route it lands is
    # the runner's move. The earned area is grown around a WINDOW of the route
    # rather than the whole of it, and the window slides from start to finish.
    # A shorter window means the same land packed thicker, which is what makes
    # the choice a real trade rather than a cosmetic one.
    claim_window_frac: float = 0.55    # window length as a fraction of the route
    claim_window_min_m: float = 400.0  # ...but never shorter than this, or a 1 km
                                       # run would deploy onto a 550 m stub
    claim_placement_count: int = 9     # candidate positions offered (odd, so one
                                       # of them is dead centre). The client picks
                                       # BY INDEX and the server rebuilds the list,
                                       # so a placement can never be forged.
    # ...and the claim can be TURNED about its own centre, which is the second
    # half of the move: sliding aims along the run, rotating aims across it.
    # The pivot is always on the route, so a turned claim still covers ground
    # that was actually run — but at 360° it can also reach streets that were
    # not. Narrow the span (e.g. 120) to keep claims hugging the route.
    claim_rotation_count: int = 8      # headings offered, 0 = exactly as run
    claim_rotation_span_deg: float = 360.0
    # ...but a turned claim must still be ground the runner actually went near.
    # Rotation is a real tactical choice (aim ACROSS the route rather than
    # along it); unbounded rotation is a claim on streets they never ran, which
    # breaks the one promise the whole game rests on — you own where you ran.
    # A candidate must keep at least `claim_min_route_attachment` of its area
    # within `claim_route_attachment_buffer_m` of the actual trail. Heading 0 is
    # exempt: it IS the shape as run, so it can never be "detached" from itself.
    claim_route_attachment_buffer_m: float = 100.0
    claim_min_route_attachment: float = 0.60

    # ---- claiming later ---------------------------------------------------
    # A finished run's land does not have to be placed on the result screen:
    # the runner can leave and plan the attack from Home instead, for this
    # many hours after the run ends. Past that the land lapses. A run earns
    # ONE move, and a stockpile of unplaced runs would let a runner fight from
    # the sofa, answering every attack without going out. 0 = no limit.
    claim_defer_hours: float = 24.0

    # ---- anti-cheat (validate_run) -------------------------------------
    # Flagged runs are shadow-flagged: the submitter sees normal success,
    # but their territories are hidden from everyone else. Never surface
    # which rule fired.
    cheat_max_mock_fraction: float = 0.05   # >5% mock-provider points -> flag
    cheat_teleport_speed_mps: float = 12.0  # sustained speed implying teleport
    cheat_teleport_min_points: int = 3      # ...over at least this many consecutive gaps
    cheat_pace_floor_s_per_km: float = 170.0  # 2:50/km — faster sustained is inhuman
    cheat_pace_window_m: float = 500.0      # rolling window for the pace floor
    cheat_stride_min_m: float = 0.5         # distance/steps below this -> flag
    cheat_stride_max_m: float = 2.0         # distance/steps above this -> flag
    cheat_clean_min_points: int = 120       # only long runs checked for "too clean"
    cheat_clean_spacing_cv: float = 0.05    # near-zero spacing variance = spoof-ish
    cheat_clean_accuracy_var: float = 0.01  # near-zero accuracy variance = spoof-ish

    # ---- development harness ---------------------------------------------
    # Comma-separated immutable user IDs allowed simulator access.
    # Empty disables all developer privileges; usernames/emails never grant them.
    dev_run_accounts: str = ""

    # ---- rate limiting ---------------------------------------------------
    rate_limit_auth: str = "10/minute"
    rate_limit_submit_path: str = "60/minute"
    rate_limit_end_run: str = "10/minute"
    rate_limit_default: str = "120/minute"

    # ---- claim-options latency cache --------------------------------------
    # Building the 72-candidate grid is ~1.8 s of geometry and PostGIS. It is
    # deterministic from the stored route, the frozen area and the land around
    # it, so the result is cached per run and re-priced on every request.
    #
    # PER WORKER and in-process, deliberately: it is a latency cache, never a
    # source of truth. Each worker keys on a fingerprint of the surrounding
    # territory, so two workers cannot disagree — the worst case is that one of
    # them recomputes. Set to 0 to turn it off entirely.
    claim_options_cache_size: int = 32

    # ---- map viewport simplification -------------------------------------
    # Server-side ST_SimplifyPreserveTopology tolerance (WGS84 degrees) and a
    # feature cap, chosen by the client's map zoom so low zooms send far
    # fewer/lighter polygons. ~0.0001 deg ~= 11m at Singapore's latitude.
    map_zoom_mid: float = 15.0
    map_zoom_low: float = 13.0
    map_zoom_vlow: float = 11.0
    map_tol_high: float = 0.00003   # zoom >= mid  : near-full detail
    map_tol_mid: float = 0.00015    # low  <= zoom < mid
    map_tol_low: float = 0.0004     # vlow <= zoom < low
    map_tol_vlow: float = 0.0009    # zoom < vlow
    map_cap_low_zoom: int = 400     # feature cap once zoomed out past `low`

    # ---- route privacy ----------------------------------------------------
    # A GPS trace is a home address. These are the DEFAULTS for an account that
    # has never touched its privacy settings, and they are deliberately
    # protective: a default that protects nobody is not a default. Runners can
    # lower them, and the owner always sees their own routes in full.
    route_trim_default_m: float = 250.0      # cut from BOTH ends before publishing
    route_publish_delay_default_h: float = 3.0   # withhold from others this long
    # Under-18 accounts get FLOORS, not defaults: they cannot publish more of
    # themselves than this even if they turn the controls down. Age comes from
    # `users.birthday`, which onboarding always collected but never sent.
    minor_age: int = 18
    minor_min_trim_m: float = 500.0
    minor_min_delay_h: float = 24.0

    # ---- contested / "changed hands" window ------------------------------
    contested_days: int = 7         # a territory claimed within N days reads as hot

    # ---- territory decay -------------------------------------------------
    # Lifetime is NOT a pace multiplier any more. It used to be strength × 4
    # days, and since strength was 0.6–2.0 straight off pace, a fast runner's
    # land lived 8 days and a slow runner's 2.4 — pace decided how much you
    # took, whether you could take it, AND how long you kept it. Now it is
    # mostly effort and upkeep: a base, plus distance, plus how often you have
    # come back to the same ground. Stored per territory as `expires_at`.
    territory_life_days_base: float = 4.0
    territory_life_days_max: float = 9.0
    territory_life_km_per_day: float = 5.0   # +1 day per 5 km...
    territory_life_distance_cap_days: float = 2.0   # ...up to +2
    territory_life_reinforce_cap_days: float = 3.0  # +1 per reinforcement, up to +3
    territory_life_pace_bonus_days: float = 0.5     # pace is worth half a day, no more
    # LEGACY: the old strength multiplier. Nothing should read this any more —
    # it is kept only so an old row without `expires_at` can still be aged.
    territory_life_days_per_strength: float = 4.0

    # ---- claim strength ---------------------------------------------------
    # A narrow band, deliberately. The old 0.6–2.0 meant a 2.0 attacker beat
    # every solo defender alive and a 0.6 defender could hold nothing — pace
    # was the whole PvP game. Now pace is worth ~1.4× at the extremes and
    # REINFORCEMENT is how land actually gets strong.
    strength_pace_min: float = 0.85
    strength_pace_max: float = 1.20
    strength_distance_min: float = 0.90
    strength_distance_max: float = 1.15
    strength_pace_weight: float = 0.70   # ...and 0.30 to distance
    strength_min: float = 0.85
    strength_max: float = 1.20
    strength_ceiling: float = 2.0        # reinforcement can carry land this far

    # ---- club defence -----------------------------------------------------
    # Clubmates' overlapping land stacks on top of the owner's, but with
    # FALLOFF. A flat sum meant every extra member added their full strength,
    # so a large enough club produced ground no solo runner could ever take —
    # club size stopped being an advantage and became immunity.
    club_defence_w1: float = 1.00   # strongest clubmate, full weight
    club_defence_w2: float = 0.50
    club_defence_w3: float = 0.25
    club_defence_rest: float = 0.10  # everyone else
    # ...and a hard ceiling on the total (owner + club). Nothing on the map
    # defends harder than this.
    max_effective_defence: float = 2.5

    # Attacker strength tops out at `strength_max` (1.20), so anything defended
    # above that could never fall to a single claim however many people threw
    # themselves at it. A bounced attack therefore CHIPS the defence: land is
    # durable, not invulnerable, and a coordinated siege gets through in the
    # end. Chip is a fraction of the attacker's own strength.
    defence_chip_frac: float = 0.10
    defence_chip_floor: float = 0.50     # chipping never drops land below this

    # ---- hold credit ------------------------------------------------------
    # Rank should measure keeping ground, not only taking it. The scheduled
    # sweep credits territory that has survived this long since its last
    # credit. Capped per sweep so someone holding sixty zones does not out-earn
    # every contested outcome in the game by doing nothing.
    hold_credit_hours: float = 48.0
    hold_credit_max_per_sweep: int = 10

    # ---- XP (verified runs only) ------------------------------------------
    # Running is the career; territory is the bonus on top. It used to be the
    # other way round — 50 XP for a 5 km run against 500 for pressing Claim.
    xp_per_km: int = 50
    xp_per_claim: int = 50           # flat base for placing any claim
    xp_per_steal: int = 50           # flat base bonus when a claim takes rival land
    # Area-scaled XP: taking territory earns MORE the larger the ground taken.
    xp_per_km2_claimed: int = 100    # per km² of land the claim covers
    xp_per_km2_stolen: int = 200     # per km² carved off rivals (worth more)
    # Hard ceilings relative to what the RUN itself paid, so a 1 km jog with a
    # surgical claim can never out-earn an honest 10 km.
    xp_claim_max_frac_of_run: float = 0.75
    xp_steal_max_frac_of_run: float = 1.0
    # Club XP: a member's earned XP also advances their club by this fraction,
    # so clubs progress collectively without double-counting the solo total.
    club_xp_share: float = 1.0

    # ---- Energy (gates territory CLAIMS only — runs are always allowed) -----
    energy_base_max: int = 100          # cap at level 0 (grows +5 / 10 levels)
    energy_regen_seconds: int = 360     # 1 energy per 6 min → full in ~10h
    # Cost depends on WHAT the claim does. One flat price made a quiet
    # expansion cost the same as storming a defended border, which is both
    # unfair and uninformative — the price is now part of how the move reads.
    energy_cost_claim: int = 20         # baseline / fallback (also what old
                                        # clients see in the energy meter)
    energy_cost_claim_empty: int = 16       # nobody's ground
    energy_cost_claim_reinforce: int = 12   # your own land, made stronger
    energy_cost_claim_attack: int = 20      # a rival loses ground
    energy_cost_claim_fortified: int = 24   # ...and their defence holds part of it
    # The first claim each day is half price, so anyone who actually went for a
    # run can reliably DO something with it. Deliberately a discount and not a
    # free attack: the floor is participation, not free aggression.
    energy_first_claim_discount: float = 0.5

    # Earned energy scales with the run and is capped daily, so the meter can't
    # be refilled by repeatedly stepping outside.
    energy_run_base: int = 3            # ...plus 1 per km
    energy_run_max: int = 15            # per run
    energy_daily_run_cap: int = 30      # per day, from running

    # ---- Coins -------------------------------------------------------------
    # Flat 25-per-run made a 20 m walk the best coins-per-minute in the game.
    coins_run_base: int = 10            # ...plus 8 per km
    coins_run_per_km: int = 8
    coins_run_max: int = 100            # per run
    coins_daily_run_cap: int = 180      # per day, from running

    # Days roll over at local midnight, not UTC — a UTC day boundary is 8am in
    # Singapore, which would reset everyone's daily allowances mid-morning.
    daily_reset_utc_offset_hours: float = 8.0

    # ---- daily territorial limits -----------------------------------------
    # The neutral-expansion ration, OFF since 2026-08-10. 0 disables it; any
    # positive value is the number of NEUTRAL expansions allowed per game day.
    #
    # It was switched off because it was a second cap on a decision that was
    # already capped. Every claim costs Energy, Energy regenerates on a clock
    # and can be bought, so it is the thing that rations claiming — and it
    # rations it continuously rather than as a cliff. On top of that, this
    # counter told a runner who had done the running AND had the Energy to
    # spend that they still could not take open ground, which reads as the
    # game being broken rather than as a rule. Two currencies for one decision.
    #
    # The behaviour is kept rather than deleted because the reason it existed
    # is real (painting the map by repetition), and if Energy alone turns out
    # to be too loose this is one env var away from returning.
    max_neutral_claims_per_game_day: int = 0

    # Temporary safety rails until opponent-relative rank scoring lands. Both
    # exist because a flat per-claim reward is farmable by anyone willing to
    # claim repeatedly, and neither is meant to bind on a normal day.
    daily_claim_xp_cap: int = 500
    daily_neutral_claim_rank_cap: int = 15

    # ---- PASERBY (crossed paths) ------------------------------------------
    # Two runs cross when a sample of one lands within `radius` metres of a
    # sample of the other within `window` seconds. Both numbers are deliberately
    # small: this is "you passed each other", not "you were in the same suburb".
    # Nothing here is ever returned to a client — see app/paserby.py.
    paserby_radius_m: float = 40.0
    paserby_time_window_s: int = 180
    # One encounter per pair per this many hours. Covers both MVP rules at once:
    # a pair can produce one rewarded encounter a day, and a second crossing
    # inside the window produces no row at all (so short repeated runs are
    # worthless).
    paserby_pair_cooldown_hours: int = 24
    # How far back a finished run looks for company. Traces older than this are
    # swept, so the location data this feature keeps is measured in days.
    paserby_lookback_hours: int = 24
    paserby_trace_retention_days: int = 2
    # The route is sampled rather than stored point-for-point: one sample per
    # interval is enough to catch a crossing at 40 m, and the cap stops a very
    # long run writing thousands of rows.
    paserby_trace_interval_s: float = 25.0
    paserby_trace_max_points: int = 300
    # Candidate discovery is deliberately wider than the product result. The
    # spatial index narrows first; only this bounded set receives detailed
    # trace analysis. Selection then enforces the two invisible product caps.
    paserby_candidate_pool_size: int = 200
    paserby_max_encounters_per_run: int = 3
    paserby_max_per_cluster: int = 2
    # Samples are 25s apart by default. Six nearby intervals is therefore
    # sustained company, not a brief crossing.
    paserby_corun_radius_m: float = 50.0
    paserby_corun_min_duration_s: int = 150
    paserby_trace_alignment_s: int = 40
    paserby_same_direction_degrees: float = 35.0
    paserby_same_direction_min_duration_s: int = 90
    paserby_separation_m: float = 90.0
    paserby_cluster_window_s: int = 180
    paserby_cluster_radius_m: float = 160.0
    paserby_frequent_threshold: int = 5
    # The reveal shows this many characters; the rest are "+N more".
    paserby_reveal_cast: int = 3
    # A high five is a wave, not a payout: small XP, hard daily ceiling, and no
    # coins, energy, territory or rank at all.
    paserby_high_five_xp: int = 5
    paserby_daily_social_xp_cap: int = 25
    # Whether a new account participates before touching the setting. ON matches
    # every other social surface in the app (feed, profile, rivals) and nothing
    # here exposes location — flip to False for opt-in-only.
    paserby_default_enabled: bool = True

    # ---- CLUB RUNS (run together, or it is not a club run) ----------------
    # A run counts for a club only when at least this many OTHER members of
    # that club ran the same route at the same time — see app/club_runs.py.
    # One partner means two people, which is the rule as stated: a club run is
    # a run the club did together. Nothing a solo run earns for the RUNNER
    # changes; what it stops producing is club land, club XP, weekly goal
    # progress, season area and club rating movement.
    club_run_min_partners: int = 1
    # How far apart two runners may be and still be together. Wider than
    # PASERBY's 40 m crossing radius would be wrong in spirit — that is one
    # moment, this is a whole route — but it has to clear a dual carriageway,
    # because two people either side of one are running together and their
    # phones disagree by about thirty metres.
    club_run_path_tolerance_m: float = 35.0
    # ...and for how much of the route. Measured BOTH ways, so a 10 km run
    # that happens to contain a clubmate's 2 km loop is not a club run for
    # either of them.
    club_run_min_shared_frac: float = 0.60
    # An absolute floor as well as a fraction: two 200 m shuffles round the
    # same block share 100% of themselves and are not a club run.
    club_run_min_shared_m: float = 400.0
    # Watches get started by hand, so the two windows only have to overlap
    # once this much slack is allowed at each end.
    club_run_time_grace_s: int = 600
    # Ceiling on how many clubmates one run is measured against. A whole club
    # turning out together is a group run, not a reason to run the geometry
    # fifty times.
    club_run_max_partners: int = 20
    # How far the probe LOOKS, which is not a rule. Clubmates out at the same
    # time within this radius are measured and their verdict logged with the
    # rule they failed (app/club_runs.py `judge`), so false negatives can be
    # read from the logs. Who qualifies is still decided by the tolerance
    # above: a pair that never comes within it shares no metres.
    club_run_diagnostic_radius_m: float = 250.0

    # ---- In-app purchases (PASER PRO + energy packs) ----------------------
    # MUST be true in production. With it off, /me/pass/purchase and
    # /me/energy/purchase grant their goods to any authenticated caller with
    # no receipt at all — the entire premium track for free. Verification
    # lives in app/iap.py and FAILS CLOSED if the settings below are unset.
    iap_verify_receipts: bool = False
    # Apple verification is now StoreKit 2's signed transaction, checked
    # LOCALLY against Apple's own root certificate (app/certs/AppleRootCA-G3.cer,
    # a public file — no secret) rather than the deprecated verifyReceipt HTTP
    # endpoint. `apple_shared_secret` is what that old endpoint needed; it is
    # kept only so a still-running deploy doesn't crash on an unrecognised env
    # var, but nothing reads it any more.
    apple_shared_secret: str = ""
    # iOS bundle id every verified transaction must match. Same value as
    # `android_package` today, but it is Apple's identifier, not Google's —
    # App Store Connect → your app → General → Bundle ID.
    apple_bundle_id: str = "com.pacerrun.app"
    # The numeric App Store Connect app id (App Information → Apple ID). Only
    # required to verify a PRODUCTION transaction — sandbox verification (every
    # TestFlight tester and every App Review purchase) works without it, so
    # this can stay unset until the app is actually live for sale.
    apple_app_apple_id: str = ""
    # Google Play: an OAuth access token for the Android Publisher API, plus
    # the package name receipts are validated against.
    google_play_access_token: str = ""
    android_package: str = "com.pacerrun.app"

    # ---- PASER PRO subscription -------------------------------------------
    # PRO is an auto-renewable subscription (app/entitlements.py). These are
    # the only product ids `/me/pro/subscribe` will accept — an id not on this
    # list is rejected before a receipt is looked at, so a client cannot name
    # its own product and have an expiry taken on trust. Both must sit in the
    # SAME subscription group in App Store Connect / the Play Console, or
    # switching plans starts a second parallel subscription instead of
    # replacing the first.
    pro_products: tuple[str, ...] = ("paser_pro_monthly", "paser_pro_yearly")
    # How long PRO survives past its expiry, covering a store-side billing
    # retry. Short on purpose: cover for a failed charge, not a free period.
    # Set to 0 to cut entitlement off exactly at expiry.
    pro_grace_days: int = 3

    # ---- Account recovery (forgot password) -------------------------------
    # A six digit code mailed to the account's VERIFIED address. Six digits is
    # only safe because guessing is bounded three ways: the code dies after
    # `recovery_code_ttl_minutes`, a single code accepts
    # `recovery_max_attempts` wrong guesses before it is burnt, and requests
    # are rate limited per IP by `rate_limit_recovery`.
    recovery_code_ttl_minutes: int = 15
    recovery_max_attempts: int = 5
    # The ticket handed out once a code is verified. It is what authorises the
    # actual password change, so it lives only long enough to type a password
    # into a form.
    recovery_ticket_ttl_minutes: int = 10
    # Deliberately tighter than rate_limit_auth: these endpoints send mail to
    # an address the caller names, so an unlimited one is a mail cannon.
    rate_limit_recovery: str = "5/hour"

    # Mail transport: "log" (development, writes to the log), "resend" (HTTPS
    # API, needs resend_api_key) or "smtp". Anything else means recovery is
    # unconfigured and its endpoints return 501. See app/mailer.py.
    mail_backend: str = "log"
    # A real, monitored address: the "your recovery email changed" warning asks
    # the reader to reply to it, and that reply has to land somewhere.
    mail_from: str = "PASER <recovery@paser.app>"
    mail_timeout_s: float = 10.0
    resend_api_key: str = ""
    mail_smtp_host: str = ""
    mail_smtp_port: int = 587
    mail_smtp_user: str = ""
    mail_smtp_password: str = ""
    mail_smtp_ssl: bool = False

    # ---- Social sign-in (Google / Apple) ----------------------------------
    # Comma-separated allowed audiences (OAuth client ids for Google; bundle /
    # service ids for Apple). Tokens whose `aud` isn't listed are rejected.
    # Empty → that provider's endpoint returns 501 (not configured).
    google_client_ids: str = ""
    apple_client_ids: str = ""
    # Server-side Sign in with Apple token lifecycle. The private key is the
    # .p8 contents (literal newlines or escaped \n both work). These are needed
    # to exchange the native authorization code and revoke the refresh token
    # when an Apple-created account is deleted.
    apple_client_id: str = ""
    apple_team_id: str = ""
    apple_key_id: str = ""
    apple_private_key: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
