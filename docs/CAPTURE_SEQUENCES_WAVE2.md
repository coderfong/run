# Capture sequences, wave 2

**Sprite-only rule, 2026-08-16.** A capture scene ships only if every visual in
it is drawn art. Scenes that draw part of the world with vector primitives
(`EnvironmentLayer`'s shadow, cracks, glow seams, rise, sweep band, scanline,
wind, pull field, dust) are held out of `PLAYABLE_CAPTURE_STYLES` — they stay
authored in the file, but players never see them. `FLASH` and `DARKEN` are not
vectors and do not count: they are full-screen tinted views, not drawings.

This is enforced structurally, not by a list: `scene()` derives
`usesVectorEnvironment` from the sequence, so a held-out scene cannot rejoin the
pool by accident and a shipping scene cannot quietly gain a vector beat.
`resolveCaptureStyle` also redirects held-out ids, so an old saved run cannot
replay one. **8 of 38 scenes ship** — paint_bomb, lightning_conquest,
golden_crown, ink_flood, energy_pulse, lucky_duck, angel_vs_demon,
overdrive_claim. All five encounter modes survive, including the duel.

To bring a held-out scene back, replace its vector beats with sprite effects;
it rejoins the pool automatically. Note that no shipping scene now uses the
`freeze` camera cue (both users are held out), and the `crack_glow` reveal
transition has no shipping user either.

**Status, 2026-08-16:** all 6 Lane A scenes and 2 of 4 Lane B scenes are shipped
in `captureStyles.js` (`CAPTURE_STYLES` is 38 long; see `effects.test.js`).
Shipped: Ward Break, Chain Reaction, Corrosion Creep, Lights Out, Storm Front,
Seal of Ownership (`hex_seal`), Overdrive, Geyser Break. `docs/ANIMATION_ASSET_LICENSES.md`
is now the source of truth on what is actually licence-cleared — it has moved
ahead of the lane assignments below: Super Pixel Fantasy FX Pack 3 and Warped
shooting fx (confirmed CC0 by reading the bundled PDF) are both approved.
`PixelArtRPGVFXLite` is explicitly held back (no licence text in the download
at all); Geyser Break was written against `acid_splash_01` instead of its
`WaterWave_Lite` so it ships without it. Lane C (Smoke Screen, Spike Field,
Treasure Claim, Redraw, Critter Stampede) is still unbuilt and still blocked
on the packages named below.

Thirteen new capture styles, designed against what is actually sitting in
`C:\Users\user\Desktop\animations` rather than against a wishlist. Every scene
below is written in the existing `captureStyles.js` DSL, respects the narrative
contract `validateChoreography` enforces, and names the exact source file each
new effect id would come from.

Read `frontend/src/effects/captureStyles.js` first if you have not recently.
The 25 shipped styles establish the pattern these follow.

---

## 1. What the folder actually holds

37 archives and 7 loose files. The release importer has pulled **44 assets out
of 7 packages**. The rest of the folder is untouched.

### Already imported (7 packages, 44 assets)

| Package | Taken | Left behind |
| --- | --- | --- |
| PVFX Foundry Thirteen | 13 of 13 | nothing |
| Free Pixel Effects Pack | 10 of 20 | **10 unused sheets** |
| Super Pixel Effects Mini Pack 1 | 3 of 4 | `fx1_splatter_small_red` |
| explosion pack 1 (ansimuz) | 1 of 8 | **7 unused explosions** |
| ELR WindyLeafs | 3 of 3 | nothing |
| Tiny RPG Emoji Pack I | 14 of 32 | 18 unused emoticons |
| Icons emote | 0 of 14 | **all 14**, in 4 balloon directions |

### Never touched

| Package | Contents | Why it matters |
| --- | --- | --- |
| **Effect and FX Pixel All Free** | 180 sheets, uniform 64x64 grid, **9 colour rows x N frames each** | by far the largest pool, and the 9 rows are the same effect in 9 palettes, which is exactly what a territory colour needs |
| Super Pixel Fantasy FX Pack 3 | 10 buff/debuff auras (attack up, defense up, haste, rejuvenate, death), 128x128 | the only *character* auras in the folder; nothing shipped charges the runner visually |
| Warped shooting fx (ansimuz) | bolt, pulse, charged, crossed, spark, waveform, 6 hits | clean small impacts, plus 3 audio files |
| PixelArtRPGVFXLite | water wave, fire, wind ground, void shield, holy cross, electric, firework, explosion. 64x64, 6 frames each | wind and water have no equivalent in the shipped set |
| free pixel magic sprite effects | 15 magic sheets, 72px tall, plus 10 static 32x32 loot icons | |
| lightning | 6 bolt sheets, 64x64 | shipped lightning is a burst, not a bolt |
| Free Smoke Fx Pixel 2 | 4 large smoke sheets | there is no smoke in the app at all |
| Pixel Explosions Free Pack | boom 16px, bigboom 32px, biggerboom 48px | a ready made size ladder |
| Animated Chests | 4 chest tiers x 10 frames, 48x32, plus snow variants | a whole prop nobody has used |
| Pixel UI pack 3 | panels, bars, spinners, star ratings | |
| 500 Bullet 24x24 | 30 sheets | |
| Glitch Portals | 600 frames, 5 sizes, 2 variants | **already blocked** on licence |
| chicken, ducky x2, chubby rat, blue shroomie | 48px critters, idle and walk | |
| Pixel Art Animations Warrior | 5 large red slash VFX, 256px | |
| Cartoon FX Pack PC DEMO | a Unity `.exe` demo | no extractable sprites, ignore it |
| BloodFX, Retro Impact A, Retro Impact 5, Retro Pixel 32x32 pack 2, Pixel Holy Spell 32x32 pack 3 | `.rar` | **no extractor on this machine**, see caveats |

### Unused reveal transitions

Five `REVEAL_TRANSITION` values exist and no shipped style uses them:
`RADIAL`, `CRACK`, `FREEZE_SPREAD`, `IMPLODE`, `CORRUPTION_SPREAD`. Four of the
scenes below claim four of them.

---

## 2. Licence lanes

This is the constraint that decides build order, so it comes before the scenes.
`docs/ANIMATION_ASSET_LICENSES.md` is the gate and
`frontend/scripts/animations/animation-selection.json` records only 7 packages.

**Lane A. Ship today.** Already approved packages with unused assets: Free
Pixel Effects Pack (public domain), explosion pack 1 (CC0), Icons emote,
Tiny RPG Emoji Pack I (CC0), plus everything already installed. Six of the
thirteen scenes below are Lane A end to end.

**Lane B. Terms shipped, need a gate entry and a read.**
- Super Pixel Fantasy FX Pack 3: `license.txt` points at untiedgames.com and
  summarises as bundle with your game OK, redistribute the pack no.
- PixelArtRPGVFXLite: Unity Asset Store free pack, standard store EULA.
- free pixel magic: `License.txt` is a bare craftpix.net/file-licenses URL, the
  same family already approved on your direction for the landscape scenes.
- Warped shooting fx: ships `public-license.pdf`, **same filename and same
  author as the already approved explosion pack 1**. The page is rasterised so
  it cannot be read programmatically. Open it. It is almost certainly the same
  CC0 statement, which would make the whole pack Lane A.

**Lane C. No licence file in the download.** Effect and FX Pixel All Free,
lightning, Animated Chests, Free Smoke Fx Pixel 2, Pixel Explosions Free Pack,
Pixel UI pack 3, 500 Bullet, the loose critters. Same situation that got
`glitch_portal_01` blocked. Each Lane C scene below carries a **fallback** line
saying what it degrades to using approved art, so none of them are dead.

The `.rar` archives cannot be opened here at all: no 7-Zip, WinRAR or unrar on
this machine. Filenames were read out of the headers, contents were not seen.
Install an extractor before counting on them.

---

## 3. The thirteen scenes

Each is authored at pre-scale timings, exactly like the existing file. `scene()`
multiplies by `DRAMA_SCALE` (1.4). The arithmetic that matters:

- one `reveal`, one `haptic`, one `victory` after the reveal
- the attacker acts before the reveal, the defenders react before the reveal,
  and the defenders have an exit beat
- `contact` only in a `DUEL`, and none of these are duels
- one body runs one action at a time, so a group beat at `start` with `stagger`
  over three rivals is not clear until `start + 2*stagger + duration`
- `duration` must not exceed `reveal.start + 2800`

---

### 1. Ward Break — `ward_break` — Lane A

**Why it is new.** The only style where the rivals have a defence. Everything
shipped happens *to* people standing on ground. Here they put something up, hold
it, and it fails. That is a different emotional beat from twenty five variations
of being knocked over.

Uses `8_protectioncircle` as the ward, `10_weaponhit` as the strike, `14_phantom`
as the residue. All three are unused sheets in an already approved public domain
pack. Claims the unused `IMPLODE` transition.

```js
scene({
  id: 'ward_break',
  name: 'Ward Break',
  encounterMode: M.ATTACKER_ONLY,
  description: 'The rivals throw a ward up over the claim and hold it; the runner charges one shot, cracks it, and the ward collapses inward taking the ground with it.',
  beats: [
    'The rivals raise a ward over the claim',
    'The runner charges a single shot',
    'The ward cracks under it and they strain to hold it',
    'It collapses inward and the ground goes with it',
  ],
  duration: 4060,
  sequence: [
    attacker(140, ACTION.STEP_FORWARD, { duration: 150 }),
    // They act second, but they act BEFORE the reveal, which is the rule.
    defenders(300, ACTION.BRACE),                                  // ends 800
    effect(360, 'protection_circle_01', { anchor: S.TERRITORY_CENTER, size: 320, speed: 0.9 }),
    attacker(560, ACTION.CHARGE, { duration: 760 }),
    effect(660, 'magic_infinity_01', { anchor: 'characterCenter', size: 170, speed: 0.9 }),
    camera(700, CAMERA_ACTION.ZOOM_IN, { amount: 1.08, duration: 620 }),
    // Holding it up. Directional, so they lean into the middle of their own ward.
    defenders(880, ACTION.RESIST_PULL, { toward: S.TERRITORY_CENTER, duration: 620 }),
    projectile(1340, 'magical_projectile_01', 'characterCenter', S.TERRITORY_CENTER, {
      duration: 240, size: 150, speed: 1.6,
    }),
    effect(1580, 'weapon_hit_01', { anchor: S.TERRITORY_CENTER, size: 260, speed: 1.2 }),
    environment(1600, E.CRACKS, { anchor: S.TERRITORY_CENTER, size: 300, duration: 520, count: 6 }),
    // Cracks in the WARD, not the ground. Last of them ends at 2100.
    scatter(1560, [ACTION.WINCE, ACTION.SURPRISED, ACTION.WINCE], { stagger: 70, duration: 400 }),
    // The ward holding for one beat after it has visibly failed.
    pause(2100, 180),
    effect(2280, 'void_implosion_01', { anchor: S.TERRITORY_CENTER, size: 280, speed: 1.3 }),
    environment(2280, E.FLASH, { duration: 300, opacity: 0.6, color: '#9BE8FF' }),
    haptic(2280, 'heavy'),
    shake(2290, { intensity: 1.3, axis: 'both' }),
    camera(2300, CAMERA_ACTION.PUNCH_IN, { amount: 1.14 }),
    defenders(2340, ACTION.SHOCKWAVE_KNOCKBACK, { from: S.TERRITORY_CENTER }),
    reveal(2420, { transition: T.IMPLODE, origin: S.TERRITORY_CENTER, duration: 860 }),
    effect(2620, 'phantom_cross_01', { anchor: 'randomTerritoryPoint', size: 200, opacity: 0.8 }),
    scatter(3200, FLIGHT_POOL, { stagger: 60, duration: 620, from: S.TERRITORY_CENTER }),
    attacker(2820, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
    attacker(3460, ACTION.CELEBRATE, { duration: 600 }),
    victory(3460),
  ],
}),
```

---

### 2. Chain Reaction — `chain_reaction` — Lane A

**Why it is new.** Escalation. `domino_capture` travels but does not grow;
`meteor_claim` is one bang. This one starts as a firecracker the rivals laugh
off and ends as the biggest detonation in the pack, and the joke is that they
watched it coming and did not move fast enough.

The size ladder already exists inside the approved CC0 explosion pack:
`explosion-1-a` (32px frames), `-1-b` (64px), `-1-d` (128px), `-1-e` (192px).
Four imports, one pack, no new licence work.

```js
scene({
  id: 'chain_reaction',
  name: 'Chain Reaction',
  encounterMode: M.PROJECTILE,
  description: 'The runner rolls one small charge onto the edge of the claim; each blast sets off a bigger one, walking toward the rivals until the last one takes everything.',
  beats: [
    'The runner rolls a charge onto the edge of the claim',
    'The first pop is small and the rivals barely look',
    'Every blast is bigger than the last and they are coming this way',
    'The last one goes off under everybody',
  ],
  duration: 4040,
  sequence: [
    attacker(150, ACTION.THROW, { toward: S.TERRITORY_TOP }),
    projectile(480, 'bomb_blast_01', 'characterCenter', S.TERRITORY_TOP, {
      duration: 380, size: 90, arc: -70, spin: 260,
      bounce: { height: 22, duration: 260, drift: 16 },
    }),
    // Small. Deliberately unimpressive.
    effect(900, 'boom_small_01', { anchor: S.TERRITORY_TOP, size: 110, speed: 1.3 }),
    scatter(940, [ACTION.LOOK_RIGHT, ACTION.NOTICE, ACTION.LOOK_LEFT], {
      stagger: 70, duration: 340, from: S.TERRITORY_TOP,
    }),
    effect(1180, 'boom_mid_01', { anchor: 'randomTerritoryPoint', size: 170, speed: 1.25 }),
    effect(1440, 'boom_large_01', { anchor: 'randomTerritoryPoint', size: 230, speed: 1.2 }),
    // Now they move. Last of them ends at 2000.
    scatter(1460, [ACTION.HOP_BACK, ACTION.DODGE_LEFT, ACTION.DODGE_RIGHT], {
      stagger: 70, duration: 400, from: S.TERRITORY_TOP,
    }),
    attacker(1600, ACTION.BRACE),
    camera(1700, CAMERA_ACTION.WHIP_DOWN, { duration: 240 }),
    pause(2000, 160),
    effect(2160, 'boom_huge_01', { anchor: 'defenderGroupCenter', size: 330, speed: 1.1 }),
    environment(2160, E.FLASH, { duration: 340, opacity: 0.7, color: '#FFC98A' }),
    haptic(2160, 'heavy'),
    shake(2170, { intensity: 1.5, axis: 'both' }),
    camera(2180, CAMERA_ACTION.PUNCH_IN, { amount: 1.16 }),
    environment(2200, E.DUST, {
      anchor: 'defenderGroupCenter', size: 320, duration: 1400, count: 9, color: '#4A3A32',
    }),
    defenders(2220, ACTION.SHOCKWAVE_KNOCKBACK, { from: 'defenderGroupCenter' }),
    reveal(2340, { transition: T.SHOCKWAVE, origin: S.TERRITORY_CENTER, duration: 900 }),
    effect(2560, 'explosion_orange_01', { anchor: 'randomTerritoryPoint', size: 180, opacity: 0.8 }),
    scatter(3080, FLIGHT_POOL, { stagger: 60, duration: 620, from: 'defenderGroupCenter' }),
    attacker(2800, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
    attacker(3440, ACTION.CELEBRATE, { duration: 600 }),
    victory(3440),
  ],
}),
```

---

### 3. Corrosion Creep — `corrosion_creep` — Lane A

**Why it is new.** It is the only style where the takeover is *slow and
unstoppable* rather than sudden. Nothing detonates, nobody is thrown, and the
rivals lose the ground one branch at a time. Claims the unused
`CORRUPTION_SPREAD` transition, which is the transition this style is named for.

`17_felspell` is an unused sheet in the approved public domain pack;
`acid_splash_01` is already installed.

```js
scene({
  id: 'corrosion_creep',
  name: 'Corrosion Creep',
  encounterMode: M.TERRAIN_TRANSFORM,
  description: 'One drop goes down and eats outward in branches; the rivals give up a step every time a branch reaches them, until there is nothing left to stand on.',
  beats: [
    'The runner puts a single drop on the ground',
    'It starts eating outward in branches',
    'The rivals back off from every branch that reaches them',
    'The whole surface goes over',
  ],
  duration: 3760,
  sequence: [
    attacker(150, ACTION.PLANT),
    effect(460, 'acid_splash_01', { anchor: 'characterFeet', size: 160, speed: 1.1 }),
    environment(640, E.CRACKS, { anchor: 'characterFeet', size: 260, duration: 700, count: 5 }),
    scatter(700, NOTICE_POOL, { stagger: 90, duration: 380, from: 'characterFeet' }),
    effect(1000, 'acid_splash_01', { anchor: 'randomTerritoryPoint', size: 210, speed: 1.0 }),
    environment(1040, E.CRACKS, { anchor: S.TERRITORY_CENTER, size: 340, duration: 800, count: 7 }),
    effect(1340, 'acid_splash_01', { anchor: S.TERRITORY_BOTTOM, size: 240, speed: 1.1 }),
    // Ground given up a step at a time, not lost all at once. Ends 1920.
    scatter(1300, [ACTION.HOP_BACK, ACTION.STUMBLE_LEFT, ACTION.HOP_BACK], {
      stagger: 90, duration: 440, from: 'characterFeet',
    }),
    reveal(1560, { transition: T.CORRUPTION_SPREAD, origin: S.CHARACTER_FEET, duration: 1100 }),
    effect(1800, 'fel_spell_01', { anchor: S.TERRITORY_CENTER, size: 280, speed: 0.95 }),
    // Medium, not heavy: nothing here hits anybody.
    haptic(1900, 'medium'),
    shake(1910, { intensity: 0.8, axis: 'x' }),
    camera(1920, CAMERA_ACTION.ZOOM_IN, { amount: 1.06, duration: 520 }),
    defenders(1960, ACTION.SLIDE_TOWARD, { toward: 'perimeter' }),
    effect(2200, 'acid_splash_01', { anchor: 'randomTerritoryPoint', size: 210, opacity: 0.85 }),
    environment(2260, E.GLOW_SEAMS, { anchor: S.TERRITORY_CENTER, size: 320, duration: 700, count: 7 }),
    camera(2480, CAMERA_ACTION.RELEASE, { duration: 380 }),
    scatter(2700, [ACTION.RUN_LEFT, ACTION.FLEE_FROM, ACTION.RUN_RIGHT], {
      stagger: 70, duration: 640, from: 'characterFeet',
    }),
    attacker(2500, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
    attacker(3140, ACTION.CELEBRATE, { duration: 620 }),
    victory(3140),
  ],
}),
```

---

### 4. Lights Out — `lights_out` — Lane A

**Why it is new.** The comedy register the pack is missing. `ghost_theft` is the
quiet one, but it is still eerie. This one is *boring on purpose*: the runner
hums, the claim goes dark, the rivals get bored and wander off, and the ground
changes hands because nobody could be bothered to defend it.

The whole scene runs on the **Icons emote** balloons, which are approved and
have never been imported. Claims the unused `RADIAL` transition.

```js
scene({
  id: 'lights_out',
  name: 'Lights Out',
  encounterMode: M.TERRITORY_ONLY,
  description: 'The runner hums one note over the claim and the lights go down; the rivals yawn, lose interest and drift off the ground rather than fight for it.',
  beats: [
    'The runner hums a note over the claim',
    'The lights go down across the ground',
    'The rivals yawn and stop paying attention',
    'They drift off and the claim is already someone else\u2019s',
  ],
  duration: 3740,
  sequence: [
    attacker(150, ACTION.CAST, { hold: true }),
    effect(420, 'emote_note_01', { anchor: 'characterHead', size: 110 }),
    scatter(640, [ACTION.NOTICE, ACTION.LOOK_LEFT, ACTION.LOOK_RIGHT], {
      stagger: 95, duration: 380, from: 'characterCenter',
    }),
    environment(700, E.DARKEN, { duration: 1600, opacity: 0.4 }),
    effect(900, 'midnight_01', { anchor: S.TERRITORY_CENTER, size: 280, speed: 0.7, opacity: 0.85 }),
    effect(1240, 'emote_sleeping_01', { anchor: 'defenderGroupCenter', size: 120 }),
    // Shaking themselves awake, and failing. Ends 1880.
    defenders(1260, ACTION.SHAKE_OFF),
    camera(1500, CAMERA_ACTION.ZOOM_IN, { amount: 1.05, duration: 600 }),
    effect(1500, 'magic_bubbles_01', { anchor: S.TERRITORY_CENTER, size: 250, speed: 0.8, opacity: 0.6 }),
    reveal(1620, { transition: T.RADIAL, origin: S.TERRITORY_CENTER, duration: 1100 }),
    // The lightest haptic in the pack. This style should barely register.
    haptic(1900, 'light'),
    defenders(1920, ACTION.SLIDE_TOWARD, { toward: 'perimeter' }),
    effect(2100, 'emote_dots_01', { anchor: 'defenderGroupCenter', size: 110 }),
    environment(2200, E.WIND, { duration: 900, count: 6 }),
    camera(2320, CAMERA_ACTION.RELEASE, { duration: 400 }),
    scatter(2660, [ACTION.RUN_LEFT, ACTION.RUN_RIGHT, ACTION.RUN_LEFT], {
      stagger: 95, duration: 640,
    }),
    attacker(2480, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
    attacker(3120, ACTION.CELEBRATE, { duration: 620 }),
    victory(3120),
  ],
}),
```

---

### 5. Storm Front — `storm_front` — Lane A

**Why it is new.** `lightning_conquest` is one bolt into the middle of the
group. This is a weather system crossing the claim: three strikes that march
top, middle, bottom, each one landing somewhere different, so the threat has a
direction and the rivals can see where the next one goes.

Runs entirely on installed assets plus `18_midnight` from the approved pack.
Upgrade path: the six sheets in `lightning.zip` give each strike its own bolt.

```js
scene({
  id: 'storm_front',
  name: 'Storm Front',
  encounterMode: M.PROJECTILE,
  description: 'A weather front crosses the claim top to bottom; three strikes walk down the ground in order and the rivals can see exactly where the next one lands.',
  beats: [
    'The runner pulls a front in off the edge',
    'The sky closes over the claim and the rivals look up',
    'Strikes walk down the ground, one after another',
    'The last one lands under them and the front passes over',
  ],
  duration: 3780,
  sequence: [
    attacker(150, ACTION.RAISE_ARMS),
    environment(420, E.DARKEN, { duration: 1500, opacity: 0.34 }),
    effect(520, 'midnight_01', { anchor: S.TERRITORY_TOP, size: 300, speed: 1.2, opacity: 0.7 }),
    defenders(680, ACTION.LOOK_UP),
    environment(940, E.WIND, { duration: 1400, count: 10, color: '#9FD8FF' }),
    // Strike one, at the top. Nobody is under it yet.
    projectile(1100, 'magical_projectile_01', 'screenTop', S.TERRITORY_TOP, {
      duration: 200, size: 140, speed: 1.7,
    }),
    effect(1300, 'electric_impact_01', { anchor: S.TERRITORY_TOP, size: 230, speed: 1.3 }),
    scatter(1160, [ACTION.DUCK, ACTION.BRACE, ACTION.DUCK], {
      stagger: 90, duration: 420, from: 'screenTop',
    }),
    // Strike two, closer.
    projectile(1420, 'magical_projectile_01', 'screenTop', 'defenderGroupCenter', {
      duration: 190, size: 150, speed: 1.7,
    }),
    effect(1610, 'electric_burst_01', { anchor: 'defenderGroupCenter', size: 250, speed: 1.2 }),
    attacker(1500, ACTION.BRACE),
    // Strike three, on them.
    projectile(1740, 'magical_projectile_01', 'screenTop', S.TERRITORY_BOTTOM, {
      duration: 180, size: 160, speed: 1.8,
    }),
    effect(1920, 'electric_impact_01', { anchor: S.TERRITORY_BOTTOM, size: 280, speed: 1.15 }),
    environment(1920, E.FLASH, { duration: 280, opacity: 0.75, color: '#CFF6FF' }),
    haptic(1920, 'heavy'),
    shake(1930, { intensity: 1.25, axis: 'x' }),
    camera(1940, CAMERA_ACTION.PUNCH_IN, { amount: 1.12 }),
    defenders(1960, ACTION.SHOCKWAVE_KNOCKBACK, { from: S.TERRITORY_BOTTOM }),
    // The reveal follows the front, top to bottom, rather than blooming.
    reveal(2060, { transition: T.SPREAD_FROM_EDGE, origin: S.TERRITORY_TOP, duration: 1000 }),
    effect(2300, 'solar_shrapnel_01', { anchor: 'randomTerritoryPoint', size: 200, opacity: 0.8 }),
    scatter(2820, FLIGHT_POOL, { stagger: 60, duration: 620, from: S.TERRITORY_BOTTOM }),
    attacker(2540, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
    attacker(3180, ACTION.CELEBRATE, { duration: 600 }),
    victory(3180),
  ],
}),
```

---

### 6. Seal of Ownership — `hex_seal` — Lane A

**Why it is new.** `stamp_of_ownership` is one hit. This is the opposite: a
signature being drawn, ring by ring, that the rivals can see closing around them
and cannot get out of. No impact anywhere until the last ring snaps.

Built on `8_protectioncircle` used as the seal rather than as a shield, which is
the same trick `dragon_sweep` plays with a shadow.

```js
scene({
  id: 'hex_seal',
  name: 'Seal of Ownership',
  encounterMode: M.TERRITORY_ONLY,
  description: 'A seal inscribes itself under the claim and locks one ring at a time; the rivals feel it closing around them and are lifted out as the last ring snaps shut.',
  beats: [
    'The runner starts drawing a seal under the claim',
    'Rings lock one after another and the rivals feel it closing',
    'The pattern spreads cell by cell across the ground',
    'The last ring snaps shut and the claim is signed',
  ],
  duration: 3680,
  sequence: [
    attacker(150, ACTION.CAST, { hold: true }),
    effect(420, 'protection_circle_01', { anchor: S.TERRITORY_CENTER, size: 200, speed: 0.8 }),
    scatter(620, NOTICE_POOL, { stagger: 85, duration: 380, from: S.TERRITORY_CENTER }),
    effect(900, 'magic_spell_01', { anchor: S.TERRITORY_CENTER, size: 260, speed: 0.9, opacity: 0.85 }),
    environment(940, E.SWEEP_BAND, {
      anchor: S.TERRITORY_CENTER, size: 320, duration: 1000, opacity: 0.35, color: '#FFD98A',
    }),
    effect(1200, 'magic_spell_01', { anchor: 'randomTerritoryPoint', size: 220, speed: 1.1 }),
    // Pulling against a ring that is closing on them. Ends 1840.
    defenders(1220, ACTION.RESIST_PULL, { toward: S.TERRITORY_CENTER, duration: 620 }),
    effect(1500, 'magic_spell_01', { anchor: S.TERRITORY_BOTTOM, size: 240, speed: 1.1 }),
    reveal(1660, { transition: T.TILE_CONVERT, origin: S.TERRITORY_CENTER, duration: 900 }),
    camera(1700, CAMERA_ACTION.ZOOM_IN, { amount: 1.06, duration: 520 }),
    effect(1900, 'protection_circle_01', { anchor: S.TERRITORY_CENTER, size: 320, speed: 1.2 }),
    defenders(1900, ACTION.SLIDE_TOWARD, { toward: 'perimeter' }),
    haptic(1980, 'success'),
    shake(1990, { intensity: 0.9, axis: 'y' }),
    camera(2000, CAMERA_ACTION.PUNCH_IN, { amount: 1.08 }),
    effect(2200, 'sunburn_ring_01', { anchor: S.TERRITORY_CENTER, size: 240, opacity: 0.85 }),
    camera(2320, CAMERA_ACTION.RELEASE, { duration: 380 }),
    scatter(2640, [ACTION.PORTAL_EXIT, ACTION.RUN_LEFT, ACTION.RUN_RIGHT], {
      stagger: 70, duration: 640, toward: 'perimeter',
    }),
    attacker(2420, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
    attacker(3060, ACTION.CELEBRATE, { duration: 620 }),
    victory(3060),
  ],
}),
```

---

### 7. Overdrive — `overdrive_claim` — Lane B

**Why it is new.** Nothing in the pack makes the *runner* look powerful before
the event. Every style opens with a gesture and then the world does the work.
Here three auras stack onto the runner while the rivals stand and watch it
build, and the whole claim is one stomp at the end of it. The anticipation is
the character, not the sky.

Needs Super Pixel Fantasy FX Pack 3: `attack_up_large_red`,
`defense_up_large_blue`, `haste_large_green`. 128x128 frames, 18 to 29 frames,
`spritesheet.txt` next to each one already lists the exact frame rectangles.

```js
scene({
  id: 'overdrive_claim',
  name: 'Overdrive',
  encounterMode: M.ATTACKER_ONLY,
  description: 'Three auras stack onto the runner in plain sight while the rivals back off, and the whole claim is taken with one stomp at the end of it.',
  beats: [
    'The runner starts stacking up',
    'Three auras land on them and the rivals stop to watch',
    'They drive one stomp into the ground',
    'A single pulse clears the claim',
  ],
  duration: 3680,
  sequence: [
    attacker(150, ACTION.CHARGE, { duration: 900 }),
    effect(200, 'attack_up_01', { anchor: 'characterCenter', size: 180, speed: 1.1 }),
    effect(520, 'defense_up_01', { anchor: 'characterCenter', size: 200, speed: 1.1 }),
    scatter(560, NOTICE_POOL, { stagger: 80, duration: 380, from: 'characterCenter' }),
    effect(840, 'haste_01', { anchor: 'characterCenter', size: 220, speed: 1.15 }),
    camera(400, CAMERA_ACTION.ZOOM_IN, { amount: 1.1, duration: 800 }),
    pause(1080, 180),
    defenders(1140, ACTION.HOP_BACK, { from: 'characterCenter' }),
    attacker(1260, ACTION.STOMP),
    effect(1560, 'impact_shock_01', { anchor: 'characterFeet', size: 300, speed: 1.3 }),
    effect(1600, 'frost_nova_01', { anchor: S.TERRITORY_CENTER, size: 320, speed: 1.2 }),
    environment(1600, E.FLASH, { duration: 300, opacity: 0.6, color: '#FFD9A8' }),
    haptic(1600, 'heavy'),
    shake(1610, { intensity: 1.35, axis: 'both' }),
    camera(1620, CAMERA_ACTION.RELEASE, { duration: 280 }),
    defenders(1680, ACTION.SHOCKWAVE_KNOCKBACK, { from: 'characterFeet' }),
    reveal(1760, { transition: T.SHOCKWAVE, origin: S.CHARACTER_FEET, duration: 880 }),
    attacker(1860, ACTION.RECOIL),
    effect(1980, 'nebula_burst_01', { anchor: 'randomTerritoryPoint', size: 210, opacity: 0.85 }),
    scatter(2540, FLIGHT_POOL, { stagger: 70, duration: 640, from: 'characterFeet' }),
    attacker(2420, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
    attacker(3060, ACTION.CELEBRATE, { duration: 620 }),
    victory(3060),
  ],
}),
```

---

### 8. Geyser Break — `geyser_break` — Lane B

**Why it is new.** The event comes from *below the rivals specifically* rather
than from the sky or from the runner's feet. They feel the ground swell under
their own feet for a full second before anything happens, which is a kind of
dread none of the shipped styles has.

Needs `WaterWave_Lite` from PixelArtRPGVFXLite (64x64, 6 frames) for the fallout.
Upgrade: `Effect and FX Pixel` Part 11 sheet `529` is a perfect geyser cone.

```js
scene({
  id: 'geyser_break',
  name: 'Geyser Break',
  encounterMode: M.TERRAIN_TRANSFORM,
  description: 'The ground swells under the rivals for a beat before it opens; a column comes up through them and falls back as rain onto ground that has changed hands.',
  beats: [
    'The runner drives a heel into the ground',
    'The surface swells under the rivals and they lose their footing',
    'A column comes up through them',
    'It falls back as rain and the claim has changed hands',
  ],
  duration: 3720,
  sequence: [
    attacker(150, ACTION.STOMP),
    effect(460, 'magic_bubbles_01', { anchor: 'defenderGroupCenter', size: 180, speed: 0.9 }),
    environment(520, E.RISE, { anchor: 'defenderGroupCenter', size: 280, duration: 900, count: 5 }),
    scatter(660, [ACTION.LOOK_LEFT, ACTION.NOTICE, ACTION.LOOK_RIGHT], {
      stagger: 85, duration: 380, from: 'defenderGroupCenter',
    }),
    effect(1000, 'magic_bubbles_01', { anchor: 'defenderGroupCenter', size: 170, opacity: 0.7 }),
    // Losing their feet on ground that is moving. Ends 1840.
    scatter(1240, [ACTION.STUMBLE_LEFT, ACTION.HOP_BACK, ACTION.STUMBLE_RIGHT], {
      stagger: 80, duration: 440, from: 'defenderGroupCenter',
    }),
    attacker(1400, ACTION.BRACE),
    effect(1600, 'fire_column_01', { anchor: 'defenderGroupCenter', size: 320, speed: 1.1 }),
    environment(1620, E.FLASH, { duration: 280, opacity: 0.5, color: '#BFE9FF' }),
    haptic(1620, 'heavy'),
    shake(1630, { intensity: 1.3, axis: 'y' }),
    camera(1640, CAMERA_ACTION.PUNCH_IN, { amount: 1.12 }),
    defenders(1880, ACTION.SHOCKWAVE_KNOCKBACK, { from: 'defenderGroupCenter' }),
    reveal(1960, { transition: T.SPREAD_FROM_CENTER, origin: S.TERRITORY_CENTER, duration: 900 }),
    effect(2200, 'water_wave_01', { anchor: 'randomTerritoryPoint', size: 220, opacity: 0.8 }),
    environment(2300, E.DUST, {
      anchor: 'defenderGroupCenter', size: 280, duration: 1100, count: 6, color: '#8FB8CC',
    }),
    scatter(2740, FLIGHT_POOL, { stagger: 60, duration: 620, from: 'defenderGroupCenter' }),
    attacker(2460, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
    attacker(3100, ACTION.CELEBRATE, { duration: 620 }),
    victory(3100),
  ],
}),
```

---

### 9. Smoke Screen — `smoke_screen` — Lane C

**Why it is new.** The takeover happens where you cannot see it. Every other
style shows you the moment the ground turns over; this one hides it behind
smoke and shows you the result. That is a genuinely different edit, and it is
the cheapest dramatic trick in the folder.

**Needs:** Free Smoke Fx Pixel 2, four sheets, no licence file.
**Fallback:** `explosion-1-e` from the approved CC0 pack is 192px and mostly
smoke; combined with `E.DUST` at count 9 and `E.DARKEN` the scene reads without
any new package at all.

```js
scene({
  id: 'smoke_screen',
  name: 'Smoke Screen',
  encounterMode: M.TERRITORY_ONLY,
  description: 'A smoke charge swallows the claim and nobody sees what happens inside it; the smoke lifts on ground that already belongs to somebody else.',
  beats: [
    'The runner throws a smoke charge into the claim',
    'It blooms and swallows the whole ground',
    'Shapes move around inside it',
    'The smoke lifts and the claim has already changed hands',
  ],
  duration: 3600,
  sequence: [
    attacker(150, ACTION.THROW, { toward: S.TERRITORY_CENTER }),
    projectile(500, 'bomb_blast_01', 'characterCenter', S.TERRITORY_CENTER, {
      duration: 360, size: 100, arc: -90, spin: 220,
      bounce: { height: 24, duration: 260, drift: 12 },
    }),
    scatter(640, [ACTION.NOTICE, ACTION.LOOK_RIGHT, ACTION.NOTICE], {
      stagger: 75, duration: 360, from: 'characterCenter',
    }),
    effect(900, 'smoke_puff_01', { anchor: S.TERRITORY_CENTER, size: 280, speed: 0.9, opacity: 0.95 }),
    environment(1000, E.DARKEN, { duration: 1400, opacity: 0.34 }),
    effect(1040, 'smoke_puff_02', { anchor: 'randomTerritoryPoint', size: 260, speed: 0.85, opacity: 0.9 }),
    scatter(1180, [ACTION.DUCK, ACTION.SURPRISED, ACTION.DUCK], {
      stagger: 70, duration: 440, from: S.TERRITORY_CENTER,
    }),
    effect(1300, 'smoke_puff_03', { anchor: S.TERRITORY_TOP, size: 300, speed: 0.8, opacity: 0.9 }),
    camera(1400, CAMERA_ACTION.TILT, { amount: 1.6, duration: 360 }),
    attacker(1500, ACTION.CAST, { hold: true }),
    haptic(1700, 'medium'),
    shake(1710, { intensity: 0.7, axis: 'x' }),
    // The turnover happens under full cover. This is the whole idea.
    reveal(1800, { transition: T.DISSOLVE, origin: S.TERRITORY_CENTER, duration: 1000 }),
    defenders(1820, ACTION.SLIDE_TOWARD, { toward: 'perimeter' }),
    effect(2200, 'smoke_puff_04', { anchor: S.TERRITORY_BOTTOM, size: 280, speed: 1.1, opacity: 0.7 }),
    environment(2300, E.WIND, { duration: 900, count: 8 }),
    scatter(2560, [ACTION.RUN_LEFT, ACTION.RUN_RIGHT, ACTION.FLEE_FROM], {
      stagger: 70, duration: 640, from: S.TERRITORY_CENTER,
    }),
    attacker(2340, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
    attacker(2980, ACTION.CELEBRATE, { duration: 620 }),
    victory(2980),
  ],
}),
```

---

### 10. Spike Field — `spike_field` — Lane C

**Why it is new.** `earth_crack` opens the ground downward. This drives it
upward in a line that arrives at each rival in turn, so the threat has a
travelling front they can watch approach. Claims the unused `CRACK` transition.

**Needs:** `Effect and FX Pixel` Part 11 sheet `527`, a crown of spikes erupting.
**Fallback:** `earth_rupture_01` (installed) fired three times at travelling
anchors with `E.RISE` under it gets 80 percent of the read.

```js
scene({
  id: 'spike_field',
  name: 'Spike Field',
  encounterMode: M.TERRAIN_TRANSFORM,
  description: 'The runner drives a stake in and a line of spikes tears up out of the ground, arriving at each rival in turn until the whole field erupts.',
  beats: [
    'The runner drives a stake into the ground',
    'A line of spikes tears up toward the rivals',
    'It reaches each of them in turn',
    'The whole field erupts and the ground breaks over',
  ],
  duration: 3560,
  sequence: [
    attacker(150, ACTION.PLANT),
    effect(500, 'impact_shock_01', { anchor: 'characterFeet', size: 200, speed: 1.2 }),
    // The nearest rival sees it first, which is what makes it feel aimed.
    actor({ role: ROLE.DEFENDER, target: 'nearest', start: 640, action: ACTION.NOTICE, from: 'characterFeet' }),
    effect(820, 'spike_crown_01', { anchor: 'characterFeet', size: 190, speed: 1.3 }),
    effect(1020, 'spike_crown_01', { anchor: 'randomTerritoryPoint', size: 220, speed: 1.3 }),
    // 1120, not 1060: the nearest rival's notice does not clear until 1100.
    scatter(1120, [ACTION.HOP_BACK, ACTION.DODGE_LEFT, ACTION.DODGE_RIGHT], {
      stagger: 80, duration: 420, from: 'characterFeet',
    }),
    effect(1240, 'spike_crown_01', { anchor: 'defenderGroupCenter', size: 250, speed: 1.25 }),
    environment(1280, E.RISE, { anchor: S.TERRITORY_CENTER, size: 340, duration: 800, count: 6 }),
    effect(1700, 'earth_rupture_01', { anchor: S.TERRITORY_CENTER, size: 300 }),
    haptic(1700, 'heavy'),
    shake(1710, { intensity: 1.35, axis: 'y' }),
    camera(1720, CAMERA_ACTION.PUNCH_IN, { amount: 1.12 }),
    environment(1720, E.CRACKS, { anchor: S.TERRITORY_CENTER, size: 340, duration: 600, count: 8 }),
    defenders(1740, ACTION.SHOCKWAVE_KNOCKBACK, { from: S.TERRITORY_CENTER }),
    reveal(1860, { transition: T.CRACK, origin: S.CHARACTER_FEET, duration: 900 }),
    environment(1940, E.GLOW_SEAMS, { anchor: S.TERRITORY_CENTER, size: 340, duration: 700, count: 8 }),
    effect(2140, 'earth_rupture_01', { anchor: 'randomTerritoryPoint', size: 190, opacity: 0.85 }),
    scatter(2600, FLIGHT_POOL, { stagger: 60, duration: 620, from: S.TERRITORY_CENTER }),
    attacker(2320, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
    attacker(2960, ACTION.CELEBRATE, { duration: 600 }),
    victory(2960),
  ],
}),
```

---

### 11. Treasure Claim — `treasure_claim` — Lane C

**Why it is new.** The only style where the rivals move *toward* the event.
Everything else is notice then scatter. Here curiosity pulls them into the
middle of the claim and the thing they crowded around is what throws them off
it. It is also the only style with a physical prop rather than an effect.

**Needs:** Animated Chests. 48x32 frames, 4 tiers (wood, iron, gold, ice),
10 frames each: shut, rattling, cracking, lid open. Snow variants included.
No licence file in the download.
**Fallback:** none that keeps the idea. This one lives or dies on the prop.

```js
scene({
  id: 'treasure_claim',
  name: 'Treasure Claim',
  encounterMode: M.SUMMON_ONLY,
  description: 'The runner lobs a chest into the middle of the rivals; they crowd in to see what it is, and what comes out of it puts them on the perimeter.',
  beats: [
    'The runner lobs something heavy into the middle of the rivals',
    'It lands, rattles, and they crowd in to look',
    'The lid comes off',
    'What comes out of it takes the whole claim',
  ],
  duration: 4000,
  sequence: [
    attacker(150, ACTION.THROW, { toward: 'defenderGroupCenter' }),
    projectile(480, 'magical_projectile_01', 'characterCenter', 'defenderGroupCenter', {
      duration: 420, size: 110, arc: -90, spin: 180,
      bounce: { height: 26, duration: 280, drift: 14 },
    }),
    scatter(620, [ACTION.NOTICE, ACTION.LOOK_RIGHT, ACTION.NOTICE], {
      stagger: 80, duration: 360, from: 'characterCenter',
    }),
    effect(940, 'treasure_chest_01', { anchor: 'defenderGroupCenter', size: 140, speed: 0.7 }),
    environment(940, E.DUST, { anchor: 'defenderGroupCenter', size: 160, duration: 600, count: 4 }),
    // Curiosity, not fear. The one style where they close in. Ends 1880.
    defenders(1180, ACTION.SLIDE_TOWARD, { toward: 'defenderGroupCenter' }),
    attacker(1500, ACTION.BRACE),
    // The lid creaking. Nothing happens here on purpose.
    pause(1900, 240),
    effect(2140, 'nebula_burst_01', { anchor: 'defenderGroupCenter', size: 300, speed: 1.2 }),
    environment(2140, E.FLASH, { duration: 340, opacity: 0.65, color: '#FFE9A8' }),
    haptic(2140, 'success'),
    shake(2150, { intensity: 1.1, axis: 'y' }),
    camera(2160, CAMERA_ACTION.PUNCH_IN, { amount: 1.12 }),
    defenders(2180, ACTION.SHOCKWAVE_KNOCKBACK, { from: 'defenderGroupCenter' }),
    reveal(2320, { transition: T.RADIAL, origin: S.TERRITORY_CENTER, duration: 900 }),
    effect(2520, 'radiant_heal_01', { anchor: S.TERRITORY_CENTER, size: 260, opacity: 0.85 }),
    scatter(3040, FLIGHT_POOL, { stagger: 60, duration: 620, from: 'defenderGroupCenter' }),
    attacker(2760, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
    attacker(3400, ACTION.CELEBRATE, { duration: 600 }),
    victory(3400),
  ],
}),
```

---

### 12. Redraw — `redraw_claim` — Lane C

**Why it is new.** It is the only style that admits the map is drawn. PASER's
whole identity is hand drawn ink, nine slice frames and a line weight, and no
capture style has ever used that. The old owner gets scribbled out and the new
shape is inked back in over the top.

**Needs:** `Effect and FX Pixel` Part 15 sheet `720`, a scribbled X drawn on and
rubbed off over 20 frames. Part 15 `703` (a diamond outline) works as the
signature tap.
**Fallback:** `magic_spell_01` under `E.SCANLINE` reads as redrawing but loses
the scribble, which is the joke.

```js
scene({
  id: 'redraw_claim',
  name: 'Redraw',
  encounterMode: M.ATTACKER_ONLY,
  description: 'The runner scribbles the old owner out and inks the shape back in over the top; the rivals are rubbed off the page and redrawn outside the line.',
  beats: [
    'The runner starts scribbling out the old colour',
    'The scribble crosses the claim and the rivals go with it',
    'The new shape is inked back in over the top',
    'One tap of the pencil signs it',
  ],
  duration: 3880,
  sequence: [
    attacker(150, ACTION.CAST, { duration: 420 }),
    effect(420, 'scribble_out_01', { anchor: S.TERRITORY_TOP, size: 200, speed: 1.4 }),
    scatter(600, [ACTION.SURPRISED, ACTION.NOTICE, ACTION.LOOK_RIGHT], {
      stagger: 85, duration: 380, from: S.TERRITORY_TOP,
    }),
    attacker(760, ACTION.CAST, { side: 'right', duration: 420 }),
    effect(820, 'scribble_out_01', { anchor: S.TERRITORY_CENTER, size: 240, speed: 1.4 }),
    camera(1000, CAMERA_ACTION.TILT, { amount: -1.8, duration: 320 }),
    effect(1120, 'scribble_out_01', { anchor: S.TERRITORY_BOTTOM, size: 260, speed: 1.4 }),
    // Rubbed out, not knocked over. Ends 1900.
    scatter(1200, [ACTION.STUMBLE_LEFT, ACTION.GLITCH_JUMP, ACTION.STUMBLE_RIGHT], {
      stagger: 110, duration: 480,
    }),
    environment(1300, E.SCANLINE, { anchor: S.TERRITORY_CENTER, size: 300, duration: 800, steps: 5 }),
    reveal(1620, { transition: T.PIXEL_REFORM, origin: S.TERRITORY_TOP, duration: 900 }),
    effect(1900, 'magic_spell_01', { anchor: S.TERRITORY_CENTER, size: 220 }),
    // Redrawn outside the line they were standing in.
    defenders(1960, ACTION.PORTAL_EXIT, { toward: 'perimeter' }),
    attacker(1940, ACTION.PLANT),
    haptic(2120, 'success'),
    shake(2130, { intensity: 0.75, axis: 'y' }),
    camera(2140, CAMERA_ACTION.PUNCH_IN, { amount: 1.06 }),
    effect(2320, 'sunburn_ring_01', { anchor: S.TERRITORY_CENTER, size: 230, opacity: 0.85 }),
    attacker(2620, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
    attacker(3260, ACTION.CELEBRATE, { duration: 620 }),
    victory(3260),
  ],
}),
```

---

### 13. Critter Stampede — `critter_stampede` — Lane C

**Why it is new.** The event is a crowd of animals, not an effect. It is the
second comedy style and it is the only one where the rivals lose the ground to
something that is not remotely trying to take it. Pairs with `lucky_duck`, which
is currently the only funny style in the pack and is carrying that whole
register alone.

**Needs:** the four loose critters (chicken idle and walk 96x48 and 192x48,
ducky the same, `ducky_2_spritesheet` 192x128, chubby rat 96x16). No licence
files anywhere, and they are loose files rather than a package, so provenance
may be hard to reconstruct.
**Fallback:** none. This is the one idea in the list that is purely blocked on
clearance.

```js
scene({
  id: 'critter_stampede',
  name: 'Critter Stampede',
  encounterMode: M.SUMMON_ONLY,
  description: 'The runner whistles and something comes over the rise; the rivals give up the claim rather than argue with a flock crossing it.',
  beats: [
    'The runner whistles',
    'Something small comes over the rise',
    'A whole flock crosses the claim',
    'The rivals give up the ground rather than argue with it',
  ],
  duration: 3840,
  sequence: [
    attacker(150, ACTION.RAISE_ARMS),
    effect(420, 'emote_exclamation_01', { anchor: 'characterHead', size: 110 }),
    effect(600, 'critter_chicken_01', { anchor: S.TERRITORY_TOP, size: 90, speed: 1.4 }),
    scatter(700, NOTICE_POOL, { stagger: 80, duration: 380, from: S.TERRITORY_TOP }),
    effect(1000, 'critter_duck_01', { anchor: 'randomTerritoryPoint', size: 90, speed: 1.5 }),
    environment(1100, E.DUST, {
      anchor: S.TERRITORY_CENTER, size: 280, duration: 1200, count: 8, color: '#C8B08A',
    }),
    effect(1120, 'critter_rat_01', { anchor: 'randomTerritoryPoint', size: 80, speed: 1.6 }),
    scatter(1280, [ACTION.HOP_BACK, ACTION.DODGE_LEFT, ACTION.BOUNCE_REACTION], {
      stagger: 80, duration: 440, from: S.TERRITORY_TOP,
    }),
    effect(1500, 'critter_chicken_01', { anchor: S.TERRITORY_CENTER, size: 110, speed: 1.5 }),
    environment(1560, E.SHADOW_SWEEP, { anchor: S.TERRITORY_CENTER, size: 320, duration: 900 }),
    haptic(1760, 'medium'),
    shake(1770, { intensity: 0.85, axis: 'y' }),
    reveal(1840, { transition: T.LIGHT_SWEEP, origin: S.TERRITORY_TOP, duration: 950 }),
    // Put on the floor by a chicken. That is the joke, so give it 900ms.
    defenders(1920, ACTION.FALL_AND_RECOVER),
    camera(2000, CAMERA_ACTION.PUNCH_IN, { amount: 1.06 }),
    effect(2200, 'explosion_orange_01', { anchor: 'randomTerritoryPoint', size: 150, opacity: 0.6 }),
    effect(2400, 'emote_anger_01', { anchor: 'defenderGroupCenter', size: 110 }),
    scatter(2860, [ACTION.RUN_LEFT, ACTION.RUN_RIGHT, ACTION.FLEE_FROM], {
      stagger: 70, duration: 620, from: S.TERRITORY_CENTER,
    }),
    attacker(2600, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
    attacker(3240, ACTION.CELEBRATE, { duration: 600 }),
    victory(3240),
  ],
}),
```

---

## 4. New effect ids these need

Rows marked Lane A require no licence work. `import-manifest.json` records
`frameWidth`, `frameHeight`, `columns`, `rows`, `frameCount` and `fps`, so the
geometry column below is in that order.

| Effect id | Lane | Source entry | Geometry |
| --- | --- | --- | --- |
| `protection_circle_01` | A | `Free Pixel Effects Pack/8_protectioncircle_spritesheet.png` | 100x100, 8x8, 64 frames, 30fps |
| `weapon_hit_01` | A | `Free Pixel Effects Pack/10_weaponhit_spritesheet.png` | 100x100, 6x6, 36 frames, 30fps |
| `phantom_cross_01` | A | `Free Pixel Effects Pack/14_phantom_spritesheet.png` | 100x100, 8x8, 64 frames, 30fps |
| `fel_spell_01` | A | `Free Pixel Effects Pack/17_felspell_spritesheet.png` | 100x100, 10x10, 100 frames, 30fps |
| `midnight_01` | A | `Free Pixel Effects Pack/18_midnight_spritesheet.png` | 100x100, 8x8, 64 frames, 30fps |
| `boom_small_01` | A | `explosion pack 1/Explosions pack/explosion-1-a/spritesheet.png` | 32x32, 8x1, 8 frames, 14fps |
| `boom_mid_01` | A | `explosion pack 1/Explosions pack/explosion-1-b/spritesheet.png` | 64x64, 8x1, 8 frames, 14fps |
| `boom_large_01` | A | `explosion pack 1/Explosions pack/explosion-1-d/spritsheet.png` | 128x128, 12x1, 12 frames, 14fps (note the typo in the filename) |
| `boom_huge_01` | A | `explosion pack 1/Explosions pack/explosion-1-e/explosion-5.png` | 192x192, 22x1, 22 frames, 14fps |
| `emote_note_01` | A | `Icons emote/Center/12 - Note.png` | 32x32, 8x2, 16 frames, 14fps |
| `emote_sleeping_01` | A | `Icons emote/Center/10 - Sleeping.png` | 32x32, 8x2, 16 frames, 14fps |
| `emote_dots_01` | A | `Icons emote/Center/09 - Dots.png` | 32x32, 8x2, 16 frames, 14fps |
| `emote_exclamation_01` | A | `Icons emote/Center/02 - Exclamation.png` | 32x32, 8x2, 16 frames, 14fps |
| `emote_anger_01` | A | `Icons emote/Center/04 - Anger.png` | 32x32, 8x2, 16 frames, 14fps |
| `attack_up_01` | B | `Super Pixel Fantasy FX Pack 3/spritesheet/fanfx3_attack_up_large_red/spritesheet.png` | 128x128, 18x1, 18 frames, 20fps |
| `defense_up_01` | B | `.../fanfx3_defense_up_large_blue/spritesheet.png` | 128x128, 18x1, 18 frames, 20fps |
| `haste_01` | B | `.../fanfx3_haste_large_green/spritesheet.png` | 128x128, 29x1, 29 frames, 20fps |
| `water_wave_01` | B | `PixelArtRPGVFXLite/Textures/Water/WaterWave_Lite.png` | 64x64, 1x6, 6 frames, 12fps |
| `smoke_puff_01..04` | C | `Free Smoke Fx Pixel 2/Free Smoke Fx  Pixel 04..07.png` | 64x64 grids, 8x10 / 11x15 / 12x23 / 16x20 |
| `spike_crown_01` | C | `Effect and FX Pixel All Free/Free/Part 11/527.png` | 64x64, 13x9, 13 frames per colour row |
| `scribble_out_01` | C | `.../Part 15/720.png` | 64x64, 20x9 |
| `treasure_chest_01` | C | `Animated Chests/Chests.png` | 48x32, 5x8, 10 frames per tier, 4 tiers |
| `critter_chicken_01` | C | `chicken-walk.png` | 48x48, 4x1, 4 frames |
| `critter_duck_01` | C | `ducky-walk.png` | 48x48, 4x1, 4 frames |
| `critter_rat_01` | C | `chubby_rat_free/walking.png` | 16x16, 6x1, 6 frames |

### The 9 colour rows

`Effect and FX Pixel All Free` stores every effect as a **9 row x N column**
grid at 64x64, where the rows are the same animation in 9 palettes. The importer
currently assumes one animation per sheet. Teaching it a `row` field would give
every effect from that pack a per palette variant for free, which is the closest
thing in the folder to territory coloured VFX. That is worth more than any single
scene in this document, and it is one manifest field plus a crop offset.

---

## 5. Bench

Ideas that are real but did not make the cut, with the asset that would carry
them, so they are not lost:

- **Survey Line.** A flat beam (`Part 12/579`) draws the claim boundary and the
  rivals step back over it as it is drawn. Nothing in the pack draws a border.
- **Lock On.** `Part 9/449` is a crosshair that fills in over 9 frames. It is a
  better reticle than `orbital_strike` currently has, and dropping it into that
  style is a 1 line upgrade rather than a new scene.
- **Fissure Race.** `Part 4/195` is a 14 frame horizontal crack that spreads. It
  would let `earth_crack` show a fissure travelling instead of implying it with
  `E.CRACKS`.
- **Lotus.** `Part 14/655` opens into a flower over 14 frames. A gentler
  `vine_overgrowth`.
- **Skull.** `Part 13/633` assembles a skull. Fits a rival specific taunt or a
  streak break, not a claim.
- **Three hit combo.** The 5 Warrior VFX sheets are large red slash arcs. They
  would carry a third duel, but the pack already has two and duels are the only
  styles allowed `contact`.
- **Sword and Sorcery loot icons.** The 10 static 32x32 icons in the magic pack
  are items, not effects. Better used in the reward ladder than in a capture.
- **`FREEZE_SPREAD`.** Still unused, and `freeze_over` uses
  `SPREAD_FROM_EDGE` instead. Probably just a bug worth fixing.

---

## 6. Before any of this ships

1. Install a `.rar` extractor. Five archives were never opened, including two
   retro impact packs and a holy spell pack that may be better than several
   Lane C substitutes above.
2. Open `Warped shooting fx files/public-license.pdf`. Same author and filename
   as the approved explosion pack. If it is the same CC0 statement, 12 more
   assets move to Lane A.
3. Decide on `Effect and FX Pixel All Free`. It is 180 sheets with no licence
   file, it is the single biggest thing in the folder, and four scenes above
   plus the whole colour row idea depend on it.
4. Remember the OTA cap. `eas update` is already failing at 1000 assets with
   1252 referenced, so each of these adds to a total that already needs a full
   build to ship. Import in one batch, not one style at a time.
