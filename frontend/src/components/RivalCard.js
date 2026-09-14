// The rivalry card — a map diff turned into a person.
//
// "Your territory decreased 0.3 km²" tells you nothing you can act on. This
// says WHO, HOW MUCH, WHERE and WHEN, puts both runners' characters face to
// face, and ends in a verb: TAKE IT BACK.
//
// Everything is phrased from the viewer's side (the API does that too), so
// `you_took_m2` is always land you took off them.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { brand, nbTextOn, space, toon, toonRadius, toonType, useTheme, useThemedType } from '../theme';
import { haptic, PressableScale } from '../ui/motion';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';
import { Framed, ToonButton, ToonCard, ToonGhostButton } from './ui';
import { CharacterBust } from './character/CharacterRig';
import PortraitBorder from './PortraitBorder';
import { useAvatar } from '../state/avatar';
import { sinceServer } from '../utils/time';

// Territory uses one unit throughout the app. Small claims receive a third
// decimal instead of switching the player into a different unit.
export function fmtArea(m2) {
  const km2 = Math.max(0, Number(m2) || 0) / 1e6;
  return `${km2.toFixed(km2 >= 0.1 ? 2 : 3)} km²`;
}

export function ago(iso) {
  if (!iso) return '';
  const mins = Math.max(0, Math.round(sinceServer(iso) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

// What the last beat was, in the second person.
function headline(rival) {
  const e = rival.last_event;
  if (!e) return null;
  const when = ago(e.at);
  switch (e.kind) {
    case 'they_took':
      return `${rival.username} took ${fmtArea(e.area_m2)} from you · ${when}`;
    case 'you_took':
      return `You took ${fmtArea(e.area_m2)} from ${rival.username} · ${when}`;
    case 'you_held':
      return `You held ${fmtArea(e.area_m2)} against ${rival.username} · ${when}`;
    default:
      return `${rival.username} held ${fmtArea(e.area_m2)} against you · ${when}`;
  }
}

// The split bar: your share of the head-to-head land vs theirs. Falls back to
// 50/50 before either side has taken anything.
function VersusBar({ mine, theirs }) {
  const total = (mine || 0) + (theirs || 0);
  const myShare = total > 0 ? mine / total : 0.5;
  return (
    <View style={styles.bar}>
      <View style={{ flex: Math.max(0.06, myShare) }}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#22c55e' }]} />
      </View>
      <View style={{ flex: Math.max(0.06, 1 - myShare) }}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#ef4444' }]} />
      </View>
    </View>
  );
}

function Side({ label, avatar, rankKey, area, times, align = 'left' }) {
  const { colors } = useTheme();
  const type = useThemedType();
  return (
    <View style={[styles.side, align === 'right' && { flexDirection: 'row-reverse' }]}>
      {/* No fixed clipping box around the bust — the frame is wider than the
          portrait, and a 44px overflow:hidden wrapper sheared it off. */}
      <PortraitBorder borderKey={rankKey || 'wood'} size={44}>
        <CharacterBust equipped={avatar} size={44} bg={colors.cardAlt} />
      </PortraitBorder>
      <View style={{ flex: 1, alignItems: align === 'right' ? 'flex-end' : 'flex-start' }}>
        {/* toonType.sub centres by default — each side has to own its edge */}
        <Text
          style={[toonType.sub, { fontSize: 15, color: colors.text, textAlign: align }]}
          numberOfLines={1}
        >
          {label}
        </Text>
        <Text style={[type.caption, { marginTop: 1, textAlign: align }]}>
          {fmtArea(area)}
          {times ? ` · ${times}×` : ''}
        </Text>
      </View>
    </View>
  );
}

export default function RivalCard({
  rival,
  myAvatar,
  onTakeBack,
  onViewLand,
  onPress,
  compact = false,
  style,
}) {
  const { colors } = useTheme();
  const type = useThemedType();
  // Read straight from the avatar context rather than adding a prop beside
  // `myAvatar` — every caller already sources that from the same place, so a
  // second prop is one more thing four call sites can forget to pass.
  const { rankKey: myRankKey } = useAvatar();
  const behind = rival.net_m2 < 0;
  const line = headline(rival);

  // The card's BODY opens the rivalry; the two buttons underneath keep their
  // own jobs, which is why this wraps the body rather than the whole card.
  // `onPress` used to be a FALLBACK for `onTakeBack`, so a caller passing both
  // never saw it fire — hence the explicit split here.
  const Body = onPress ? PressableScale : View;
  const bodyProps = onPress
    ? {
        onPress: () => { haptic.light(); onPress(); },
        accessibilityRole: 'button',
        accessibilityLabel: `Rivalry with ${rival.username}. Open the head to head`,
      }
    : {};

  return (
    <ToonCard style={style} padded={false}>
      <Body style={styles.body} {...bodyProps}>
        <View style={styles.eyebrowRow}>
          {/* A FILLED tag, not tinted outlined text. The word used to be bright
              teal with a thin ink outline, which all but vanished on the card;
              a solid state-coloured plate with bold ink-or-white text (whichever
              reads on the fill) makes the rivalry unmistakable. */}
          {(() => {
            const tagFill = behind ? '#ef4444' : brand.teal;
            return (
              <Framed
                frame={frameVariant('chip', behind ? 'rivalry:attack' : 'rivalry:on')}
                fill={tagFill}
                on={tagFill}
                weight={INK.thin}
                pose={framePose(behind ? 'rivalry:attack' : 'rivalry:on')}
                inset={2}
              >
                <Text style={[toonType.label, styles.eyebrowBadgeText, { color: nbTextOn(tagFill) }]}>
                  {behind ? '⚔ UNDER ATTACK' : '🔥 RIVALRY'}
                </Text>
              </Framed>
            );
          })()}
          {rival.clan_tag ? (
            <Text style={[type.caption, { color: rival.clan_color?.stroke || colors.textDim }]}>
              [{rival.clan_tag}]
            </Text>
          ) : null}
        </View>

        <View style={styles.sides}>
          <Side
            label="You"
            avatar={myAvatar}
            rankKey={myRankKey}
            area={compact ? rival.your_land_m2 : rival.you_took_m2}
            times={compact ? 0 : rival.you_took_times}
          />
          <Text style={[type.caption, styles.vs]}>vs</Text>
          <Side
            label={rival.username}
            avatar={rival.avatar}
            rankKey={rival.rank_key}
            area={compact ? rival.their_land_m2 : rival.they_took_m2}
            times={compact ? 0 : rival.they_took_times}
            align="right"
          />
        </View>

        <VersusBar mine={rival.you_took_m2} theirs={rival.they_took_m2} />

        {line ? (
          <Text style={[type.bodySm, { color: colors.textMuted, marginTop: space.sm }]}>{line}</Text>
        ) : null}
      </Body>

      <View style={styles.actions}>
        {onViewLand ? (
          <ToonGhostButton title="VIEW LAND" onPress={onViewLand} color={colors.textMuted} />
        ) : null}
        <ToonButton
          title={behind ? 'TAKE IT BACK' : 'EXPAND YOUR LEAD'}
          size="sm"
          variant={behind ? 'primary' : 'teal'}
          onPress={onTakeBack || onPress}
          style={{ flex: 1 }}
        />
      </View>
    </ToonCard>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space.lg, paddingTop: space.md },
  eyebrowRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  // The filled rivalry tag: a drawn box in the state colour. Its padding is the
  // frame's own measured ink clearance, so the air either side lives on the
  // text — same arrangement as every other chip.
  eyebrowBadgeText: { fontSize: 12, letterSpacing: 0.8, paddingHorizontal: 5 },

  sides: { flexDirection: 'row', alignItems: 'center', marginTop: space.md, gap: space.sm },
  side: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  vs: { textTransform: 'uppercase', letterSpacing: 1 },

  bar: {
    flexDirection: 'row',
    height: 16,
    borderRadius: toonRadius.pill,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: toon.ink,
    marginTop: space.md,
  },

  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    paddingTop: space.md,
  },
});
