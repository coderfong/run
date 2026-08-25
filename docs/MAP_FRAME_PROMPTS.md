# PASER — Ranked map frame prompts

The board frame on the map screen is currently a plain 3pt NB stroke
(`GlobalMapScreen.js`, `styles.mapFrame`). The goal is for it to become the
**frame of the rank you are viewing** — the same ladder the portrait borders
already speak (`BORDER_TIERS` in `config/progression.js`, art in
`assets/borders/`), so scouting from Wood up to Mythic visibly changes what the
board is held in.

Generate in ChatGPT (image mode). One generation per tier. Ten tiers need art;
`none` keeps the plain stroke.

---

## What the art has to be (read this before generating)

The frame is **nine-sliced** and stretched over a full-screen rectangle
(~377 x 645pt on an iPhone 15 Pro), so the rules are not negotiable:

1. **Corners carry the ornament. Edges must be uniform.** The middle ~60% of
   each edge gets stretched. Anything with a recognisable shape in there smears.
2. **Hollow centre, transparent outside.** This frame has NO paper layer — the
   map has to show through it. Every other frame in the pack ships an ink and a
   paper drawing; this one is ink only.
3. **Full colour, drawn in.** The existing frames are monochrome and tinted at
   runtime by `frameInkFor`. These are not: the material IS the rank, so gold
   must arrive gold. They render untinted.
4. **Gradients run ACROSS the band, never along it.** A gradient along an edge
   is destroyed by the stretch. On the multi-stop tiers (onyx, ember, prismatic,
   mythic) the colour shifts from the outer lip to the inner lip and stays
   constant down the length of the run.
5. **Legible on both basemaps.** It sits on the light Mapbox style and the dark
   one. Every tier needs a dark outer contour so it never dissolves into a pale
   street grid.

---

## The prompt (paste per tier, swap the MATERIAL line)

Upload `docs/character-sheet.png` as a style reference on every generation.

```
Using the hand-drawn art style of the attached reference sheet, draw a single
decorative RECTANGULAR PICTURE FRAME, seen flat-on, as a game UI border.

STYLE
Hand-inked outline, medium-thin, slightly wobbly and organic — not a smooth
uniform vector line. Flat matte colour fills, muted-saturated. Minimal shading:
at most one flat highlight and one flat shadow tone per material. No gradients
rendered as soft blurs, no photographic texture, no bevel or emboss effects, no
drop shadow. Clean, sticker-like, bold enough to read small.

SHAPE AND COMPOSITION — this part is strict
- A tall portrait rectangle frame, roughly 2:3, with softly rounded corners.
- The band (the frame itself) is about 7% of the image width thick.
- The four CORNERS carry all of the ornament and are the most detailed part.
- The straight RUNS between the corners must be plain and UNIFORM: the same
  cross-section repeated the whole way, no motifs, no gems, no tapering, no
  variation in thickness. The middle of every edge will be stretched, so
  anything with a shape in it will smear.
- The centre of the frame is COMPLETELY EMPTY and fully transparent. Do not
  fill it, do not put a background, a scene, a mat, or a colour wash inside it.
- Outside the frame is also fully transparent. Nothing behind it, no shadow, no
  glow bleeding off the edge, no page.
- Centred in the canvas with a small even margin of empty space on all sides.
- Any gradient runs ACROSS the thickness of the band (outer edge to inner
  edge), never along its length.
- Keep a dark ink contour on the outer and inner edge of the band so the frame
  reads against both a light and a dark background.

MATERIAL
<<< paste the tier line here >>>

OUTPUT
1024 x 1536 PNG with a transparent background (alpha). Frame only.
```

---

## The ten material lines

| tier | level | paste as MATERIAL |
|---|---|---|
| `wood` | 1 | Rough sawn timber planks, warm mid brown `#9C6B3F`, visible straight grain along each run, a single knot on each corner where the planks cross and overlap. Plain, humble, unpolished. |
| `bronze` | 5 | Cast bronze band, warm orange brown `#CD7F32`, faint green patina in the recesses, a round rivet at each of the four corners. Slightly pitted, old metal. |
| `silver` | 10 | Polished silver band, cool grey white `#C7CCD1`, one flat highlight stripe running the length of the band, corners chamfered into a clean flat facet. Simple and sharp. |
| `gold` | 15 | Bright gold band, warm yellow `#FFCF4A`, a small curling filigree flourish at each corner only, the runs left plain. Rich but not fussy. |
| `platinum` | 20 | Pale cool white metal `#D7E9F5`, a thin double line running the length of the band with a hairline gap between, corners meeting in a small sharp outward spur. Precise, cold, expensive. |
| `diamond` | 25 | Icy cyan crystal `#7CE7FF`, band cut into long flat facets down its length, a single faceted gem set at each corner. Glassy, pale, cold. |
| `onyx` | 30 | Matte black polished stone, dark charcoal `#3A3A44` on the outer lip shading across to pale grey `#8A8AA0` on the inner lip, corners squared into heavy blocks. Severe and heavy. |
| `ember` | 36 | Charred blackened metal, glowing hot from within: deep orange `#FF8A3D` on the outer lip across to hot red `#FF3D6A` on the inner lip, small flat flame licks curling off the four corners only. |
| `prismatic` | 43 | Iridescent band, hot pink `#EC4899` on the outer lip shading across to violet `#8B5CF6` then teal `#2DD4BF` on the inner lip, corners set with a small flat shard catching all three colours. |
| `mythic` | 50 | Radiant gold `#FFD76A` band, edges catching pink `#FF6AD5` and blue `#6A9BFF`, a burst of small flat star sparkles at each corner only, none along the runs. The last tier, and it looks it. |

---

## After the art comes back

Per tier, deliver `frontend/assets/frames/frame_rank_<tier>.png`.

Then it needs wiring, which is code work, not art work:

1. Register the ten sources in `SOURCES` (`src/ui/frameRegistry.js`) and add
   their measured nine-slice insets to `frame-manifest.json`. The insets can be
   measured off the art rather than eyeballed — `measure_insets` in
   `scripts/animations/cut_frames.py` already does exactly this and can be
   pointed at a single PNG.
2. The registry currently expects an `[ink, paper]` pair per frame. These are
   ink only, so either make paper optional or ship a fully transparent paper.
3. In `GlobalMapScreen.js`, swap `styles.mapFrame`'s plain `View` for an
   `ArtFrame` keyed on `viewedTier.key`, keeping `pointerEvents="none"` and the
   `insets.top + space.sm` / `space.sm` box it sits in. `none` keeps the
   existing NB stroke.
4. Frames scale to a point-valued line weight (`weightScale`) — the map frame
   should ask for roughly the 3pt the NB stroke uses now, so a Mythic frame is
   more ornate than a Wood one without being thicker.
