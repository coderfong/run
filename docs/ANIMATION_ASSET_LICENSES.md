# Animation asset license gate

This is an implementation inventory, not legal advice. Preserve the source archives and their bundled terms.

## Approved packages

| Source | Evidence in download | Release handling |
| --- | --- | --- |
| PVFX Foundry Thirteen | README/license identify rendered sprite sheets and metadata as CC0 1.0; attribution appreciated | approved; Pixel VFX Studio is credited in Profile |
| Free Pixel Effects Pack | README states public-domain personal/commercial use; no credit required | approved; source README retained |
| Super Pixel Effects Mini Pack 1 | bundled terms permit game/app use, prohibit pack redistribution, and require attribution | approved; Will Tice is visibly credited in Profile |
| Icons emote | bundled terms permit production use and editing and prohibit redistribution/resale; attribution appreciated | approved; RiaKare is credited in Profile |
| Tiny RPG Emoji Pack I | README identifies the pack as CC0 1.0 | approved; CC0 needs no attribution, and the credit is recorded in `animation-selection.json` |
| explosion pack 1 (ansimuz) | bundled `public-license.pdf` states CC0: any personal or commercial project, no attribution required, modification and redistribution unrestricted | approved; Luis Zuno is credited in Profile |
| ELR-WindyLeafs | no license file shipped in the download; terms verified by the project owner 2026-08-11 | approved on the owner's verification, recorded in `animation-selection.json` |
| BigFramesColored | no license file shipped in the download; terms verified by the project owner 2026-08-11 | approved on the owner's verification, recorded in `assets/frames/frame-manifest.json`; the nine-slice cuts are derived, the source sheets are not shipped |
| Nature Landscapes Free Pixel Art (CraftPix) | `License.txt` points at craftpix.net/file-licenses; the free licence permits commercial use and restricts redistribution of the packs themselves | approved on the owner's direction 2026-08-13 (they supplied the pack and named the scene); CraftPix is credited in Profile. **The terms have not been read line by line** — do that before the store release, and note it is the only row here approved on a direction rather than on a reading. One scene of eight ships, as five layers |
| Super Pixel Fantasy FX Pack 3 (untied games) | bundled `license.txt` (full text, not a bare URL) states: bundling with a game is OK for commercial and non-commercial projects, reselling or reuploading the pack itself is not, bundling into a large game engine/tool product is not, attribution is required | approved 2026-08-16; Will Tice / unTied Games needs a credit line in Profile (not yet added) |
| Warped shooting fx (ansimuz) | bundled `public-license.pdf` read directly: CC0, same statement, same author (Luis Zuno aka Ansimuz), as the already-approved `explosion pack 1` | approved 2026-08-16 on the reading; CC0 needs no attribution. No assets imported from this package yet — nothing currently needs one |
| free pixel magic sprite effects (craftpix) | `License.txt` is a bare craftpix.net/file-licenses URL, same family as the Nature Landscapes row above | approved 2026-08-16 on the same owner direction that covers the Nature Landscapes row; **not read line by line**, same caveat. No assets imported from this package yet |

**Held back:** `PixelArtRPGVFXLite` (Unity Asset Store free pack) ships no license file or EULA text at all in the download — the bundled ReadMe only thanks the downloader and asks for a store rating. Unlike the rows above, there is nothing in the archive to point to. `geyser_break` was written to use `acid_splash_01` (PVFX Foundry, already CC0-approved) in the one beat that would have used this pack's `WaterWave_Lite`, so nothing currently depends on it. Get the owner's direction, or find the actual Unity Asset Store EULA text, before importing anything from it.

The release importer copies 58 assets from these packages. They are registered with `releaseApproved: true`; the two existing PASER Lotties are also explicitly approved. The frame and landscape packs sit outside the effect importer and carry their provenance in their own manifests (`assets/frames/frame-manifest.json`, `assets/art/scenes/scene-manifest.json`), written by their install scripts so it cannot drift from the art.

## Blocked candidates requiring verification

One of the 45 curated external candidates is blocked:

| Asset id | Package/source | Reason |
| --- | --- | --- |
| `glitch_portal_01` | Glitch Portals | no explicit license file in the archive; verify original download terms |

That file remains in the external source library and curated selection for later review, but is absent from `frontend/assets/effects`, absent from the generated `require()` registry, and absent from Android/web export assets. `Glitch Takeover` is marked unapproved as a complete style; production resolution falls back to Thunderstrike.

## Lane C: terms found, not cleared (2026-08-16)

None of these seven downloads carry a license file. Reading found terms for three by
tracing the filenames to the itch.io pages they came from; the other four could not be
traced to a source at all.

| Source | What was found | Status |
| --- | --- | --- |
| Effect and FX Pixel All Free | matches `bdragon1727.itch.io/750-effect-and-fx-pixel-all`. Free-tier terms on that page: *"Free to use on non-commercial games. If you will be using on a commercial game, please contribute (any value)."* No redistribution either tier. | **not cleared** — PASER is a commercial game and no contribution has been made to BDragon1727 |
| Free Smoke Fx Pixel 2 | matches `bdragon1727.itch.io/free-smoke-fx-pixel-2`, same creator, same free-tier terms (commercial use requires a contribution) | **not cleared**, same reason |
| 500 Bullet 24x24 Free | matches `bdragon1727.itch.io/500-pixel-bullet-24x24`, same creator, same free-tier terms | **not cleared**, same reason |
| lightning, Animated Chests, Pixel Explosions Free Pack, Pixel UI pack 3 | not traceable to a source page from the filenames, folder structure, or embedded metadata — none of BDragon1727's listed packs matched these four | **unknown**, unchanged from before |

The fix for the first three is a business decision, not a research one: contribute any
amount to BDragon1727 (there's a pay-what-you-want field on each of those three itch.io
pages) and the free tier converts to commercial-cleared. Until that happens, or until the
owner supplies different terms, none of these seven packages move to Lane A or B, and any
scene written against them needs an approved-asset fallback the way `geyser_break` uses
`acid_splash_01` in place of `PixelArtRPGVFXLite`'s `WaterWave_Lite`.

## Enforcement

- Package records in `animation-selection.json` carry `releaseApproved` and a block reason.
- `animations:import` always operates in approved-only mode and records all exclusions in `frontend/assets/effects/import-manifest.json`.
- `animations:validate` rejects any generated entry that is not explicitly approved.
- Production code can resolve only generated approved entries; an optional missing visual step is skipped without affecting capture state.
- PASER ships only selected derived runtime assets, never a complete source pack.
