# PASER — Asset Prompt Pack

Goal: kill the "AI-coded / stock-photo + dark-scrim" look and match the
hand-drawn, flat, **character-cast** style of the PASER mascot sheet
(`docs/character-sheet.png` — the 50 people). The brand isn't one mascot; it's a
**diverse crew of runners**. We reuse that cast everywhere: auth, onboarding,
empty states, loading.

Generate in **ChatGPT (GPT-4o image mode)**. The single most important step:
**upload the character sheet as a reference on EVERY generation** and say
*"in this exact art style / using these characters."* Text alone won't reproduce
the line quality — the reference image will.

---

## 0. The style, in words (the STYLE BLOCK)

Paste this at the top of every prompt, alongside the uploaded sheet:

```
Hand-drawn flat illustration in the EXACT style of the attached character sheet.
Black hand-inked outline, medium-thin, slightly wobbly / organic (NOT a thick
uniform vector line, NOT smooth digital). Flat matte color fills, muted-saturated.
Little or NO shading, no gradients, no photographic texture. Plain flat
background. Cute, chunky, friendly people, roughly 4–5 heads tall. Simple faces:
small dot/oval eyes, tiny nose line, small friendly smile. Casual streetwear —
hoodies, tees, beanies, caps, glasses/sunglasses, sneakers. Diverse cast.
Clean, sticker-like, wholesome. High resolution.
```

Why this matters vs. the first draft:
- **"hand-inked, medium-thin, slightly wobbly"** — your sheet's line is organic,
  not a fat uniform outline. That imperfection is the charm; ask for it explicitly.
- **"flat matte, little/no shading, no gradients, no photo texture"** — this is
  what separates it from the old AI-photo hero.
- Keep the characters' **own varied outfit colors**; use the brand palette
  (**hot pink #EC4899, violet #8B5CF6, teal #2DD4BF**) mainly for **backgrounds
  and accents**, not to recolor the people.

For spot art (empty states, loading, trail graphics) add:
`transparent background, PNG with alpha`. For full-bleed heroes, use a solid flat
brand-color background (we fade it to black in-app).

---

## 1. Consistency workflow (do this — it's the whole game)

DALL·E drifts. To keep ONE consistent cast:
1. **Upload `character-sheet.png` on every prompt.** Start with:
   *"Using this exact art style and these characters, draw a new scene:"*
2. **Name the characters by number** you want in a scene, e.g. *"use the runners
   #5 (green hoodie, peace sign), #17 (blonde, blue tee) and #33 (yellow beanie)."*
   Referencing specific rows keeps faces/outfits stable.
3. For a hero with motion, ask to **redraw a chosen character mid-run** rather than
   inventing a new person.
4. If a generation goes off-model, re-upload the sheet and add *"match the line
   weight and proportions of the reference exactly."*

Save the sheet into the repo so it's always at hand:
**`docs/character-sheet.png`** (drop the image you sent there).

---

## 2. Per-asset prompts

### A. Auth hero — `assets/art/auth-hero.png`  (sign-in screen)
Full-bleed, **solid flat background** (we fade the bottom to black in-app, so keep
the crew in the TOP ~60%, lower third simple).
```
<STYLE BLOCK + upload character-sheet.png>
Background: solid flat warm yellow #FFD429 filling the whole square.
Scene: a small crew of 3–4 runners FROM THE SHEET (pick e.g. #5, #17, #24, #46)
mid-run, jogging to the right, big friendly energy, a couple of small motion
"whoosh" lines behind them, one waving. Keep everyone in the upper two-thirds;
lower third mostly empty flat yellow.
```

### B. Onboarding 1 — claim mechanic — `assets/art/claim-explainer.png`
Spot illustration, transparent (sits inside a dark slide).
```
<STYLE BLOCK + sheet, transparent background PNG with alpha>
Scene: one runner from the sheet jogging along a bold hand-inked looping trail
that closes into a filled territory patch (flat teal #2DD4BF with a black outline),
a little flag planted in the patch. Diagrammatic: "run a loop -> claim the land".
```

### C. Onboarding 2 — clubs / defend — `assets/art/onboarding-clans.png`
Full-bleed, solid flat background (dark slide overlays it — deep violet works).
```
<STYLE BLOCK + sheet>
Background: solid flat deep violet #2A2140 filling the square.
Scene: 4–5 runners from the sheet standing together as a club on an outlined
territory patch, one holding a small flag, friendly-but-competitive "our turf"
pose. Centered, lots of breathing room top and bottom for text.
```

### D. Onboarding 3 — safety — `assets/art/onboarding-safety.png`
Full-bleed, solid flat background (dark slide overlays it — deep teal works).
```
<STYLE BLOCK + sheet>
Background: solid flat deep teal #10312E filling the square.
Scene: one runner from the sheet stopped at a crosswalk, looking up at a friendly
rounded traffic light showing green, one hand raised in a calm "look both ways"
gesture. Reassuring, not scary. Centered, room top and bottom for text.
```

### E. Home cards — `assets/art/card-solo.png` & `assets/art/card-clubs.png`
Transparent PNGs, right-weighted composition.
```
card-solo:  <STYLE BLOCK + sheet, transparent> ONE runner from the sheet
             running solo, small speed lines, determined happy face.
card-clubs: <STYLE BLOCK + sheet, transparent> a pack of 3 runners from the
             sheet running together and high-fiving.
```

### F. Season banner — `assets/art/season-banner.png`
```
<STYLE BLOCK + sheet> Background: solid flat hot pink #EC4899.
Scene: a runner from the sheet on a podium holding a trophy, confetti made of
simple flat hand-drawn shapes, other runners cheering. Keep subject centered.
```

### G. Empty states (new — `assets/art/empty-*.png`, transparent)
Single, calm characters from the sheet:
- `empty-runs.png` — a runner stretching / tying a lace, "ready when you are".
- `empty-leaderboard.png` — a runner looking up at an empty podium, hopeful.
- `empty-club.png` — one runner waving, "invite your crew".
- `empty-notifications.png` — a runner napping / relaxed, "all caught up".
```
<STYLE BLOCK + sheet, transparent background PNG with alpha> <the pose above>.
Single character, small, centered, gentle.
```

### H. Loading — `assets/art/loading.png` (transparent)
```
<STYLE BLOCK + sheet, transparent> one runner from the sheet running in place,
legs blurred with two flat motion lines. Simple enough to bob/spin as a loader.
```

### I. App icon (optional, high-impact) — `assets/icon.png` (1024×1024)
The icon should NOT be a full-body person (too detailed at 60px). Two options:
```
Option 1 (letters): <STYLE BLOCK> Background solid flat hot pink #EC4899. A bold
hand-inked "P" monogram OR the word "PASER" in the same wobbly ink style, centered,
no character. iOS-app-icon safe margins.

Option 2 (mascot bust): <STYLE BLOCK + sheet> Background solid flat hot pink. Just
the head-and-shoulders of ONE iconic runner from the sheet (e.g. #24, yellow
beanie), big and centered, readable tiny. No text.
```

---

## 3. Light + dark variants

Most assets work on both themes because heroes carry their own flat background and
spot art is transparent. Two rules:
- **Transparent spot assets** (claim-explainer, empty-*, loading, card-*) must read
  on BOTH near-white (light) and near-black (dark) surfaces → keep the **black
  ink outline**, and avoid pure-black or pure-white as a character's main fill.
- If any asset vanishes on one theme, make a `*-light.png` / `*-dark.png` pair
  (swap the outline to dark-gray on dark). Only if needed.

---

## 4. File manifest (names the app already/will expect)

| File (under `frontend/assets/`)   | Used by                | Status  |
|-----------------------------------|------------------------|---------|
| `art/auth-hero.png`               | Sign-in screen (new)   | NEW     |
| `art/claim-explainer.png`         | Onboarding slide 1     | replace |
| `art/onboarding-clans.png`        | Onboarding slide 2     | replace |
| `art/onboarding-safety.png`       | Onboarding slide 3     | replace |
| `art/card-solo.png`               | Home "solo run" card   | replace |
| `art/card-clubs.png`              | Home "clubs" card      | replace |
| `art/season-banner.png`           | Season screen          | replace |
| `art/empty-runs.png`              | Profile/empty runs     | NEW     |
| `art/empty-leaderboard.png`       | Leaderboard empty      | NEW     |
| `art/empty-club.png`              | Club empty             | NEW     |
| `art/empty-notifications.png`     | Notifications empty    | NEW     |
| `art/loading.png`                 | Full-screen loading    | NEW     |
| `icon.png` / `adaptive-icon.png`  | App icon               | replace |
| `docs/character-sheet.png`        | (reference for prompts)| add     |

> Export spot assets at **1024×1024 PNG** (alpha where noted); full-bleed heroes
> at least **1242×2688** (or 1:1 1024 and let the app cover-crop).

---

## 5. Sign-in note
The redesigned sign-in (`src/screens/AuthScreen.js`) currently points its hero at
the old placeholder. Once `art/auth-hero.png` (asset A — the running crew) exists,
change the one `AUTH_HERO` line marked `TODO(assets)`. The crew belongs in the top
~60%; the screen fades to solid black behind the buttons.
