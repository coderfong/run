// The layered pixel-art landscapes, and where their layers live.
//
// Metro needs literal require() calls, so the sources are written out here and
// everything else — how far each layer drifts, the sky colour, the art's own
// aspect — is read from the manifest the installer emits
// (scripts/animations/install_scene_nature.py), so the numbers can never drift
// from the art they were measured on. Same discipline as the frame registry.

import manifest from '../../assets/art/scenes/scene-manifest.json';

const SOURCES = {
  nature5: [
    require('../../assets/art/scenes/nature5/1.png'),
    require('../../assets/art/scenes/nature5/2.png'),
    require('../../assets/art/scenes/nature5/3.png'),
    require('../../assets/art/scenes/nature5/4.png'),
    require('../../assets/art/scenes/nature5/5.png'),
  ],
};

export const SCENES = Object.freeze(
  Object.fromEntries(
    Object.entries(manifest.scenes)
      .filter(([id]) => SOURCES[id])
      .map(([id, spec]) => [id, Object.freeze(spec)])
  )
);

/**
 * The layer images for a scene, back to front. Empty for an unknown scene, so
 * a caller that names one that is not in the build draws nothing rather than
 * throwing — the same rule the rest of the art registries follow.
 */
export function sceneLayerSources(id) {
  const spec = SCENES[id];
  const sources = SOURCES[id];
  if (!spec || !sources) return [];
  return spec.layers.map((layer) => sources[layer.index - 1]).filter(Boolean);
}

/**
 * Provenance, for the release checklist. `releaseApproved` is FALSE for the
 * CraftPix pack until the project owner has read its free-licence terms — the
 * same gate every other third-party pack in this app has been through.
 */
export const SCENE_LICENSE = Object.freeze(manifest.license);
