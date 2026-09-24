# Fit Studio

Drag-and-resize fitting for the cosmetics art. Every item's placement is three
numbers in its `layout` — `w` (width as a fraction of the body box), `top` or
`cy` (where it sits vertically), `dx` (how far off centre) — read by
`src/components/character/CharacterRig.js`. This tool lets you push the art
around on the real rig and writes those numbers back into the catalogue.

```bash
npm run fit
```

then open http://localhost:5178.

- Pick a slot tab, click an item. It gets worn and selected.
- Drag the art to move it; drag a corner to resize; the wheel scales.
  `←↑↓→` nudge (`shift` ×10), `[` `]` size, `n` next item, `0` reset.
- The dashed ghost is where the item sat before you touched it, so you can
  always see what changed. Guide lines mark the collar, waist and sole.
- Every change autosaves to `fit-overrides.json`. Nothing touches the app
  source until you press **Write into catalogue**.
- **Preview diff** shows exactly which lines would change first.
- **Copy edits** puts the numbers on the clipboard, if you would rather hand
  them over than apply them yourself.

The ⚠ marker in the item list flags art pushed a long way off centre — nearly
always a bad cut rather than a deliberate look.

## Hair under a hat

With a hat and a hairstyle both worn, two things can be set in
`src/config/hairUnderHat.json` (read by `src/config/headwearFit.js`, so the app
draws exactly what the studio shows):

- **Where the hair sits.** On the hair tab, *position* picks what a drag moves:
  **no hat** (the hairstyle's own catalogue layout, as ever), **every hat** (its
  position under any crown-covering hat) or **this hat only** (under the worn
  hat, which wins over every hat and also works on open-top pieces). The
  with-hat positions save as you drag; `0` or *Remove this with-hat position*
  drops one. Only the hair moves: the hat stays on the skull and the crop stays
  where the hat is.
- **Which hair the hat hides.** *Hair under hat…* paints it with the hat on:
  pink is hidden, brush to hide more, `alt`/right button to bring hair back, `h`
  hat on/off. Save it for *every hairstyle under this hat* or *only this one*.
  **Regenerate** re-measures the hat's seat from its art where it sits now (the
  same maths as `scripts/measure-headwear-fit.py`) and rebuilds the hidden hair
  from it; saving that untouched drops the painted cover, goes back to the
  automatic shape and writes the fresh seat into `headwearFit.json`.

Both files are backed up to `backups/hair-under-hat/<stamp>/` the first time a
server run rewrites them.

## Hiding an item

**Hide from app** (or **Show in app** to undo) keeps the item in the
catalogue but stops the app offering it: the Avatar Studio grid, the first-run
rack, the coin shop, loot boxes and the random-outfit dice all skip it. Anyone
already wearing it still renders, and the Avatar Studio keeps it in their grid
while it is on. The list lives in `src/config/hiddenCosmetics.js`, and the
server's shop catalogue is regenerated on every change.

Reach for this before **Delete**: a hidden item can come back with one click,
and nothing that names it (pass rewards, saved outfits, tests) breaks. The
panel says when hiding would still leave the item somewhere: a pass or PRO
reward is still paid out by its ladder, and a default is still what new
runners start in. Tick **hidden** above the list to see only hidden items.

The shop needs a backend deploy to stop selling a newly hidden item; until
then the app itself leaves it off the shelf.

## Deleting an item

**Delete item** drops the selected item's line from the catalogue, and with
"its art too" ticked moves its PNGs out of `assets/`. Nothing is erased:

- the removed source line is recorded in `deleted-items.json`,
- the art is **moved** to `deleted-art/<timestamp>/`, not unlinked,
- the config file is backed up first, same as applying fits.

Putting an item back is a copy of that line and a move of the folder.

It also keeps the rest of the app honest as it goes:

- **The default loadout.** Deleting the item a slot defaults to is allowed, but
  only if you say which item takes over — `DEFAULT_EQUIPPED` is rewritten in
  the same breath, because a default naming nothing is a broken first run.
- **Colour variants.** A colourable item's ten PNGs live in an `ART` entry in
  `cosmeticsArt.js`, not on the item, so removing the item alone would leave
  ten `require()`s pointing at art that is gone — a bundler error, not a
  warning. Orphaned entries go with the item. An entry only *partly* missing is
  reported instead: that is damage, not a deletion.
- **The server's shop mirror.** `backend/app/shop_catalog.py` is generated from
  cosmetics.js, so it is regenerated after any delete that touched it. That is
  what keeps `node scripts/check-catalog.js` passing.

It refuses outright to delete the empty-slot `none` item and the last item in a
slot. If the id is named anywhere that is *not* generated — pass rewards,
premium grants, anything hand-maintained on the server — it lists those lines
and asks before going ahead. Forcing past that prompt leaves a dangling
reference you have to fix by hand, so read the list. Art shared with an item
that is staying is left where it is.

## Where fits are written

| items | file |
| --- | --- |
| hand-written catalogue | `src/config/cosmetics.js` |
| generated outfit waves | `src/config/outfitItems.js` |
| hair sheets | `src/config/hairSheetItems.js` |
| curated 2026 catalog | `src/config/curatedCosmetics.js` |

Each file is copied to `<name>.fitbak-<timestamp>` before it is rewritten, and
the applied overrides are kept as `fit-overrides.applied-<timestamp>.json`.

Nothing here is transcribed from the rig: the placement constants are read out
of `CharacterRig.js` at startup and the catalogue is imported from the config
files, so the studio cannot drift from what the app draws. If `CharacterRig.js`
is restructured, `manifest.mjs` says so instead of guessing.

## Applying without the UI

```bash
node scripts/fit-studio/apply-fit.mjs --dry-run
node scripts/fit-studio/apply-fit.mjs
```
