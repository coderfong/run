// The map's layer picker: what the board is showing, free and PRO.
//
// TWO TAPS, NOT ONE. Tapping a locked layer does NOT open the paywall. It
// opens the layer's own explanation — what it would show, and how many things
// it would be pointing at in the view the runner is looking at right now. Only
// a second, deliberate tap on that explanation opens the sheet.
//
// That first tap is the whole difference between a feature and an advert. A
// padlock that throws a purchase modal teaches people not to touch padlocks;
// a padlock that explains itself, with a real number attached to ground they
// can see, is the pitch. It also means the paywall is only ever reached by
// somebody who has just read what they would be buying.
//
// THE COUNT IS REAL. It is computed from the polygons already on screen, by
// the same `match` the layer would use if it were unlocked (src/map/
// intelligence.js). It is not an estimate and it is not decoration. A layer
// whose data the backend does not return yet says so plainly and offers
// nothing — see the `available: false` branch.

import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Check, Lock } from 'lucide-react-native';

import { GOLD } from '../../config/pro';
import { LAYERS, territoriesForLayer } from '../../map/intelligence';
import { useProVisible } from '../../pro/storeAvailable';
import { radius, space, useTheme, useThemedType } from '../../theme';
import { Sheet, ToonButton } from '../ui';

export default function MapLayersSheet({
  visible,
  onClose,
  active,
  onSelect,
  territories,
  userId,
  isPro,
  onPreviewLayer,
  onUnlock,
  onShowClubs,
}) {
  const { colors } = useTheme();
  const type = useThemedType();
  const canShowPro = useProVisible();
  // Which locked layer is currently explaining itself. Reset on close so the
  // sheet never reopens mid-explanation.
  const [expanded, setExpanded] = useState(null);

  const close = () => {
    setExpanded(null);
    onClose?.();
  };

  const ctx = { userId };

  return (
    <Sheet visible={visible} onClose={close}>
      <Text style={[type.heading, { marginBottom: 4 }]}>Map layers</Text>
      <Text style={[type.caption, { color: colors.textMuted, marginBottom: space.md }]}>
        What the board is drawing. Every claim stays visible on all of them.
      </Text>

      {LAYERS.map((layer) => {
        const locked = layer.pro && !isPro && canShowPro;
        // A PRO layer with the store switched off behaves as free rather than
        // as a dead padlock — there is nothing to sell, so gating it would
        // only remove a working feature.
        const selectable = !locked;
        const on = active === layer.key;
        const rows = layer.available ? territoriesForLayer(layer, territories, ctx) : [];
        const isOpen = expanded === layer.key;

        return (
          <View key={layer.key}>
            <TouchableOpacity
              style={[
                styles.row,
                { borderColor: on ? (layer.tint || GOLD) : colors.border, backgroundColor: colors.card },
              ]}
              onPress={() => {
                if (selectable) {
                  onSelect?.(layer.key);
                  close();
                  return;
                }
                // First tap: explain. Never the paywall.
                setExpanded(isOpen ? null : layer.key);
                onPreviewLayer?.(layer, rows.length);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={
                locked ? `${layer.label}, PASER PRO. ${layer.blurb}` : layer.label
              }
            >
              <View style={[styles.swatch, { backgroundColor: layer.tint || colors.textDim }]} />
              <View style={{ flex: 1 }}>
                <Text style={type.bodySmBold}>{layer.label}</Text>
                <Text style={[type.caption, { color: colors.textMuted }]} numberOfLines={2}>
                  {layer.blurb}
                </Text>
              </View>
              {on ? <Check size={18} color={layer.tint || colors.text} strokeWidth={3} /> : null}
              {locked ? <Lock size={15} color={colors.textDim} strokeWidth={2.5} /> : null}
            </TouchableOpacity>

            {isOpen ? (
              <View style={[styles.explain, { borderColor: GOLD, backgroundColor: colors.card }]}>
                {layer.available ? (
                  <>
                    <Text style={[type.bodySmBold, { color: colors.text }]}>
                      {layer.summarise ? layer.summarise(rows) : `${rows.length} in view`}
                    </Text>
                    <Text style={[type.caption, { color: colors.textMuted, marginTop: 4 }]}>
                      PASER PRO draws these on the board and keeps them there while you move
                      around. Everything you can already see stays free.
                    </Text>
                    <ToonButton
                      title="See the plans"
                      variant="gold"
                      size="sm"
                      onPress={() => {
                        setExpanded(null);
                        close();
                        onUnlock?.(layer);
                      }}
                      style={{ marginTop: space.sm }}
                    />
                  </>
                ) : (
                  // Declared, not available. It says so rather than drawing
                  // something plausible, and there is deliberately nothing to
                  // buy here — selling a layer that cannot render would be the
                  // worst version of this whole feature.
                  <Text style={[type.caption, { color: colors.textMuted }]}>
                    Not available yet. This one needs capture history the map does not carry,
                    and it will arrive for everyone with PRO when it does.
                  </Text>
                )}
              </View>
            ) : null}
          </View>
        );
      })}

      {/* The clubs legend used to hang off this same button, so it keeps a way
          in rather than disappearing when layers took the slot. It is a legend
          for the board, which is what a layer sheet is for. */}
      {onShowClubs ? (
        <TouchableOpacity
          onPress={() => {
            close();
            onShowClubs();
          }}
          style={styles.footer}
          accessibilityRole="button"
        >
          <Text style={[type.captionMedium, { color: colors.textMuted, textDecorationLine: 'underline' }]}>
            Clubs in view
          </Text>
        </TouchableOpacity>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 2,
    borderRadius: radius.card,
    padding: space.md,
    marginBottom: space.sm,
    minHeight: 64,
  },
  swatch: { width: 12, height: 12, borderRadius: 6 },
  explain: {
    borderWidth: 2,
    borderRadius: radius.card,
    padding: space.md,
    marginBottom: space.sm,
    marginTop: -4,
  },
  footer: { alignItems: 'center', paddingVertical: space.sm },
});
