import React from 'react';

import CaptureStylePlayer from './CaptureStylePlayer';
import { buildDefensePlan, resolveDefenseStyle } from './defenseStyles';

function DefenseStylePlayer(props) {
  return (
    <CaptureStylePlayer
      {...props}
      resolveStyle={resolveDefenseStyle}
      buildPlan={buildDefensePlan}
      onTerritoryReveal={undefined}
    />
  );
}

export default React.memo(DefenseStylePlayer);
