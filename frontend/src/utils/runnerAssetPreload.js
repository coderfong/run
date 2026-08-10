// Preload the layered local art referenced by API-returned runner cards before
// replacing a screen's skeletons. This is intentionally data-driven: only the
// outfits actually visible in the response are decoded.

import { BORDER_ART } from '../config/borderArt';
import { equippedImageSources } from '../config/cosmetics';
import { preloadImages } from './imagePreload';

export function runnerAssetSources(records = []) {
  return records.flat(Infinity).flatMap((record) => {
    if (!record || !record.avatar) return [];
    return [
      ...equippedImageSources(record.avatar),
      BORDER_ART[record.rank_key || record.rankKey || 'wood']?.src,
    ].filter(Boolean);
  });
}

export function preloadRunnerAssets(records = []) {
  return preloadImages(runnerAssetSources(records));
}

