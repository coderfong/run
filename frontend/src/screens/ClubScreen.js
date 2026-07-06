// Club tab — Phase 1/2 placeholder. Phase 5 replaces this with the full clan
// system (directory, create/join, member hub). Composed from UI primitives.

import React from 'react';
import { Shield } from 'lucide-react-native';

import { Screen, EmptyState } from '../components/ui';
import { useAccent } from '../hooks/useAccent';

export default function ClubScreen() {
  const accent = useAccent();
  return (
    <Screen center>
      <EmptyState
        icon={<Shield size={44} color={accent} strokeWidth={2} />}
        title="Clans are coming"
        body={
          'Real run clubs replace teams — create one, invite your crew, and take territory together.\n\nSolo land is grey. Clan land conquers.'
        }
      />
    </Screen>
  );
}
