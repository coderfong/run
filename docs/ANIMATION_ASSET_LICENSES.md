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

The release importer copies 44 assets from these packages. They are registered with `releaseApproved: true`; the two existing PASER Lotties are also explicitly approved.

## Blocked candidates requiring verification

One of the 45 curated external candidates is blocked:

| Asset id | Package/source | Reason |
| --- | --- | --- |
| `glitch_portal_01` | Glitch Portals | no explicit license file in the archive; verify original download terms |

That file remains in the external source library and curated selection for later review, but is absent from `frontend/assets/effects`, absent from the generated `require()` registry, and absent from Android/web export assets. `Glitch Takeover` is marked unapproved as a complete style; production resolution falls back to Thunderstrike.

## Enforcement

- Package records in `animation-selection.json` carry `releaseApproved` and a block reason.
- `animations:import` always operates in approved-only mode and records all exclusions in `frontend/assets/effects/import-manifest.json`.
- `animations:validate` rejects any generated entry that is not explicitly approved.
- Production code can resolve only generated approved entries; an optional missing visual step is skipped without affecting capture state.
- PASER ships only selected derived runtime assets, never a complete source pack.
