// The payoff — the two seconds a 30-minute run is actually for.
//
// A claim used to end in a toast. This is the moment instead, and it reads top
// down in the order a runner cares about it:
//
//   ✓ TERRITORY CLAIMED        a compact banner, not a wall of pink
//   +0.38 km²  NEW LAND        the hero: what this run WON
//   [runner]                   celebrating right under it, not floating
//   steal / faces              who it was taken from, when it was taken
//   +88 XP  LEVEL 32  [===]    one progression block
//   [ CONTINUE ]               on to the standings
//   View rank progression      the detail, as a quiet link
//
// It used to open on a banner a third of the screen tall, stand the runner
// alone in the middle, and leave the number the whole screen is about at the
// bottom in a card of its own. The XP had been moved off the screen entirely,
// and the only button opened rank details instead of carrying on — which made
// the optional detail look like the way forward.
//
// The headline is earned, not decorative: if any of the runners you just hit
// had taken land off you before, this was a reclaim, and it says so.
//
// IT DOES NOT SCROLL. `density()` prices every block that is present against
// the window once, spends what is left on the character (up to a cap), and
// the column is centred in whatever remains, so spare height lands at the
// edges and never as a hole in the middle.
//
// THE SEQUENCE, ~2s: banner (0) → hero pops (200ms) → burst behind it (420) →
// runner celebrates (600) → XP counts and the bar fills (950) → rank up line
// (1300). The button is live from the first frame: nobody waits through it.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { Check, ShieldOff } from 'lucide-react-native';

import { brand, space, toon, toonType, useTheme, useThemedType } from '../theme';
import { Pop, Reveal, haptic } from '../ui/motion';
import { Framed, OutlinedText, ToonButton } from './ui';
import { ToonGhostButton } from './ui/ToonButton';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';
import { CharacterBust } from './character/CharacterRig';
import { RunnerFigure } from './identity/PlayerIdentity';
import PortraitBorder from './PortraitBorder';
import GameAnimation from './GameAnimation';
import TerritoryStealBanner, { STEAL_HEADROOM } from './TerritoryStealBanner';
import ClaimProgress, { CLAIM_PROGRESS_HEIGHT } from './claim/ClaimProgress';
import { tierByKey } from '../config/rankLadder';
import { fmtArea } from './RivalCard';

function headline(claim) {
  const victims = claim?.victims || [];
  if (victims.some((v) => v.reclaimed && !v.defended)) return 'YOU TOOK IT BACK';
  if (victims.some((v) => !v.defended)) return 'LAND TAKEN';
  if (victims.length) return 'GROUND HELD AGAINST YOU';
  // A claim dropped entirely on land the runner already held took nothing.
  // Saying "TERRITORY CLAIMED" over a +0.000 is the moment the whole screen
  // stops being believed. Under a square metre is a rounding artefact rather
  // than a border that moved.
  if (gained(claim) < 1) return 'TERRITORY REINFORCED';
  return 'TERRITORY CLAIMED';
}

// What this claim WON. `territory.area_m2` is the merged holding it joined —
// for a claim landing on the runner's own land that is mostly ground they have
// held for weeks, and celebrating it here credits one run with all of it. The
// fallback is only for a backend too old to send `gained_m2`.
function gained(claim) {
  if (claim?.gained_m2 != null) return claim.gained_m2;
  return claim?.territory?.area_m2 || 0;
}

// "0.38 km²" read aloud. A screen reader says "km squared" or spells it out.
function spokenArea(m2) {
  const text = fmtArea(m2).replace(' km²', '');
  return `${text} square kilometres`;
}

// ---------------------------------------------------------------------------
// The fit.
//
// Every number below is the height a block occupies at full size, measured off
// the styles at the bottom of this file. They are ESTIMATES on purpose:
// measuring for real means rendering once at natural size and rescaling on the
// second frame, which on a screen that opens with a burst reads as the layout
// assembling in front of you. An estimate a few points out costs a few points
// of the character and nothing else.
//
// THE SPLIT IS THE WHOLE TRICK. Some of this screen scales and some of it does
// not: the banner, a portrait, a margin and the hero number can all be drawn
// smaller, while a line of caption text, the steal banner's bar and the XP
// block are the size they are. Solving one ratio against the WHOLE height is
// what makes a naive fit overflow — the fixed half does not shrink with it —
// so the fixed heights are taken off the top and the ratio is solved against
// what is left.
// ---------------------------------------------------------------------------

// Scales with `k`.
const FLEX = {
  banner: 56,
  hero: 62, // the hero number's own line
  rig: 124,
  peoplePad: 32,
  peopleRow: 50, // a portrait and the air above it
  gap: 16, // between blocks
};

// Does not.
const FIXED = {
  heroLabel: 18,
  areaSub: 18,
  // The banner's BAR. Its 90pt of fireball headroom is pulled back out below,
  // so the screen is not charged for a hole.
  stealBar: 46,
  peopleHead: 24,
  peopleMore: 18,
  held: 20,
  xp: CLAIM_PROGRESS_HEIGHT,
  rankUp: 24,
  cta: 60,
  // The quiet "View rank progression" link under the button.
  link: 40,
};

// How many faces a screen has room to actually show. Everyone hit is still
// counted on the line above them — this is the number that gets a portrait,
// and one face nobody has to reach for is worth more than four they do.
function faceCap(winH) {
  if (winH >= 800) return 3;
  if (winH >= 700) return 2;
  return 1;
}

const MIN_K = 0.62;

// The most of the window the runner may grow into from slack. Exported so the
// fit test states the same number.
export const RIG_CAP_OF_WINDOW = 0.26;

// The sizes `k` produces. Every floor here is the point below which that thing
// stops doing its job — a 30pt hero number is not a hero number — which is why
// the fit is solved rather than calculated: the floors mean the arithmetic can
// come out a few points long, and a few points long is a scroll bar.
function sizes(k, pad) {
  const s = (n) => Math.round(n * k);
  return {
    k,
    pad,
    gap: Math.max(8, s(FLEX.gap)),
    banner: Math.max(42, s(FLEX.banner)),
    // The rig's shoes overhang its layout box, so the floor under it can never
    // go to zero — but it is the first thing to give when the screen is short.
    rig: Math.max(72, s(FLEX.rig)),
    // Floored well above everything around it: this is the number the whole
    // screen is about.
    areaFont: Math.max(34, s(52)),
    face: Math.max(30, s(38)),
    rowGap: Math.max(6, s(space.md)),
    cardPad: Math.max(10, s(space.lg)),
  };
}

function gapCount(rows, blocks) {
  // hero→rig, rig→(whatever follows) are always there; the rest by presence.
  return (
    2 +
    (blocks.steal ? 1 : 0) +
    (rows > 0 ? 1 : 0) +
    (blocks.held ? 1 : 0) +
    (blocks.xp ? 1 : 0) +
    (blocks.rankUp ? 1 : 0)
  );
}

function solve({ avail, pad, rows, extra, blocks, rigCap }) {
  const gaps = gapCount(rows, blocks);

  let flex = FLEX.banner + FLEX.hero + FLEX.rig + gaps * FLEX.gap;
  if (rows > 0) flex += FLEX.peoplePad + rows * FLEX.peopleRow;

  let fixed = FIXED.heroLabel;
  if (blocks.reinforced) fixed += FIXED.areaSub;
  if (blocks.steal) fixed += FIXED.stealBar;
  if (rows > 0) fixed += FIXED.peopleHead;
  if (extra > 0) fixed += FIXED.peopleMore;
  if (blocks.held) fixed += FIXED.held;
  if (blocks.xp) fixed += FIXED.xp;
  if (blocks.rankUp) fixed += FIXED.rankUp;

  // The algebra gets close; the floors and the rounding are what it cannot
  // see, so the last few points are walked off rather than assumed away.
  let d = sizes(Math.max(MIN_K, Math.min(1, (avail - fixed) / flex)), pad);
  for (let guard = 0; guard < 24; guard += 1) {
    if (fittedHeight({ d, rows, extra, blocks }) <= avail || d.k <= MIN_K) break;
    d = sizes(Math.max(MIN_K, d.k - 0.02), pad);
  }

  // Room to spare goes to the CHARACTER, up to a cap, rather than into a gap:
  // a runner a little bigger is a better use of a tall phone than air. What
  // is left after the cap is split above and below the whole column.
  const slack = avail - fittedHeight({ d, rows, extra, blocks });
  if (slack > 0 && d.rig < rigCap) d = { ...d, rig: d.rig + Math.min(slack, rigCap - d.rig) };

  return { ...d, show: blocks, fits: fittedHeight({ d, rows, extra, blocks }) <= avail };
}

/**
 * How big everything is, and what survives.
 *
 * SHRINKING IS NOT THE FIRST ANSWER. A small phone carrying a brawl — six
 * runners hit, a defence that held, land reinforced, a promotion — has more to
 * say than it has room for, and squeezing all of it makes every part worse. So
 * the footnotes go first, cheapest first: the line about a defence that held,
 * then the line about ground reinforced, then the rank up line (the full
 * screen ceremony plays it right after anyway). Never the ground won, the
 * faces, or the XP. Only once they are gone does the layout start giving up
 * size.
 */
function density({ winH, top, bottom, rows, extra, blocks }) {
  const pad = space.md;
  const avail = Math.max(
    320,
    winH - top - bottom - FIXED.cta - FIXED.link - space.md - pad * 2
  );
  // The character never takes more than about a quarter of the phone. It is
  // the full outfit now (RunnerFigure fits hat to shoes INTO this height), so
  // spare room is worth more here than anywhere else on the screen.
  const rigCap = Math.max(FLEX.rig, Math.round(winH * RIG_CAP_OF_WINDOW));

  const shed = [
    blocks,
    { ...blocks, held: false },
    { ...blocks, held: false, reinforced: false },
    { ...blocks, held: false, reinforced: false, rankUp: false },
  ];
  let last = null;
  for (let i = 0; i < shed.length; i += 1) {
    last = solve({ avail, pad, rows, extra, blocks: shed[i], rigCap });
    if (last.fits) return last;
  }
  // Nothing fits even stripped: the floor wins. Reachable only on a window
  // shorter than any phone ships with.
  return last;
}

// The height the layout above actually comes out at, for a given density — the
// same sum the fit is solved against, read back. It lives here so it can never
// drift from the numbers it is checking.
export function fittedHeight({ d, rows, extra, blocks }) {
  let h = d.banner + Math.round(d.areaFont * 1.2) + FIXED.heroLabel + d.rig;
  h += gapCount(rows, blocks) * d.gap;
  if (blocks.reinforced) h += FIXED.areaSub;
  if (blocks.steal) h += FIXED.stealBar;
  if (rows > 0) h += FIXED.peopleHead + d.cardPad * 2 + rows * (d.face + d.rowGap);
  if (extra > 0) h += FIXED.peopleMore;
  if (blocks.held) h += FIXED.held;
  if (blocks.xp) h += FIXED.xp;
  if (blocks.rankUp) h += FIXED.rankUp;
  return h;
}

// Exported for the same reason: the fit is arithmetic, and arithmetic can be
// tested on every screen size without rendering one of them.
export { density, faceCap };

// Three short strokes each side of the runner's head: the doodle "yay" lines
// a comic draws round a character celebrating. Drawn, not an asset, so they
// take the palette and cost nothing. Kept to the SIDES (no stroke straight up)
// so none of them lands on the head or a hat.
function CheerMarks({ size }) {
  const w = size * 1.5;
  const h = size * 0.45;
  const cx = w / 2;
  const cy = size * 0.3;
  const r0 = size * 0.36;
  const r1 = size * 0.52;
  const lines = [-165, -145, -125, -55, -35, -15].map((deg, i) => {
    const a = (deg * Math.PI) / 180;
    return {
      d: `M ${cx + Math.cos(a) * r0} ${cy + Math.sin(a) * r0} L ${cx + Math.cos(a) * r1} ${cy + Math.sin(a) * r1}`,
      color: i % 2 ? brand.teal : brand.pink,
    };
  });
  return (
    <Svg width={w} height={h} pointerEvents="none">
      {lines.map((l) => (
        <Path key={l.d} d={l.d} stroke={l.color} strokeWidth={3.5} strokeLinecap="round" />
      ))}
    </Svg>
  );
}

export default function ClaimPayoff({
  visible,
  claim,
  myAvatar,
  onClose,
  // The way forward: on to the standings. `onViewLeaderboard` is the older
  // name for the same thing.
  onContinue,
  onViewLeaderboard,
  // The optional detail. Shown as a link, never as the main button.
  onViewRankProgression,
  // Fired by the XP bar as it rolls through a level; see ClaimProgress.
  onLevelUp,
}) {
  const { colors } = useTheme();
  const type = useThemedType();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const rigRef = useRef(null);
  const [burst, setBurst] = useState(false);
  const [cheer, setCheer] = useState(false);

  useEffect(() => {
    if (!visible) return undefined;
    // The claim landing. The level bar is allowed one more, on a level up.
    haptic.success();
    const timers = [
      setTimeout(() => setBurst(true), 420),
      setTimeout(() => {
        rigRef.current?.play('celebrate');
        setCheer(true);
      }, 600),
    ];
    return () => {
      timers.forEach(clearTimeout);
      setBurst(false);
      setCheer(false);
    };
  }, [visible]);

  const victims = claim?.victims || [];
  const taken = victims.filter((v) => !v.defended);
  const held = victims.filter((v) => v.defended);
  const faces = taken.slice(0, faceCap(winH));
  const unshown = taken.length - faces.length;

  const area = gained(claim);
  const reinforced = claim?.reinforced_m2 || 0;
  // A claim that won nothing new still did something: it reinforced. That is
  // the number, then, rather than a +0.000.
  const reinforceOnly = area < 1 && reinforced >= 1;
  const stolenArea = taken.reduce((sum, v) => sum + (v.area_m2 || 0), 0);
  const xpGained = claim?.xp_gained || 0;
  const hasXp = xpGained > 0 && typeof claim?.xp === 'number';
  // Only when the server says the tier moved up. Never worked out here.
  const rankUp = claim?.rank_up
    ? { from: tierByKey(claim.rank_key_before).label, to: tierByKey(claim.rank_key_after).label }
    : null;

  const d = useMemo(
    () =>
      density({
        winH,
        top: insets.top,
        bottom: insets.bottom,
        rows: faces.length,
        extra: unshown,
        blocks: {
          reinforced: !reinforceOnly && reinforced >= 1,
          steal: taken.length > 0,
          held: held.length > 0,
          xp: hasXp,
          rankUp: !!rankUp,
        },
      }),
    [
      winH,
      insets.top,
      insets.bottom,
      faces.length,
      unshown,
      reinforceOnly,
      reinforced,
      taken.length,
      held.length,
      hasXp,
      rankUp,
    ]
  );

  if (!claim) return null;

  const title = headline(claim);
  const heroM2 = reinforceOnly ? reinforced : area;
  const heroLabel = reinforceOnly ? 'REINFORCED' : 'NEW LAND';
  const next = onContinue || onViewLeaderboard;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <View style={[styles.column, { paddingTop: insets.top + d.pad, paddingBottom: d.pad }]}>
          {/* 1. SUCCESS. Sized to its words, not to the screen. */}
          <Reveal
            from="down"
            duration={260}
            style={styles.bannerWrap}
            accessible
            accessibilityRole="header"
            accessibilityLabel={`${title.charAt(0)}${title.slice(1).toLowerCase()}.`}
          >
            <Framed
              frame={frameVariant('featured', title)}
              tint={toon.ink}
              fill={brand.pink}
              weight={INK.bold}
              pose={framePose(title)}
              inset={false}
              style={{ minHeight: d.banner }}
              contentStyle={styles.bannerInner}
            >
              {title !== 'GROUND HELD AGAINST YOU' && (
                <Check size={Math.round(d.banner * 0.42)} color="#fff" strokeWidth={4} />
              )}
              <OutlinedText
                style={[toonType.headline, styles.bannerText, { fontSize: Math.round(d.banner * 0.42), lineHeight: Math.round(d.banner * 0.56) }]}
                outline={toon.ink}
                width={2.5}
                fit
                minimumFontScale={0.6}
                containerStyle={styles.bannerTextBox}
              >
                {title}
              </OutlinedText>
            </Framed>
          </Reveal>

          {/* 2. WHAT YOU WON. The hero: no card round it, a burst behind it. */}
          <View
            style={[styles.hero, { marginTop: d.gap }]}
            accessible
            accessibilityLabel={
              reinforceOnly
                ? `${spokenArea(heroM2)} of your land reinforced.`
                : `${spokenArea(heroM2)} of new land claimed.`
            }
          >
            <View style={styles.burst} pointerEvents="none">
              <GameAnimation name="rewardBurst" size={Math.round(d.areaFont * 3.4)} visible={burst} />
            </View>
            <Reveal from="none" delay={200} duration={160}>
              <Pop trigger={visible ? 1 : 0} from={0.6} delay={200}>
                <OutlinedText
                  style={[
                    toonType.hero,
                    { color: brand.teal, fontSize: d.areaFont, lineHeight: Math.round(d.areaFont * 1.2) },
                  ]}
                  outline={toon.ink}
                  width={3}
                >
                  {`+${fmtArea(heroM2)}`}
                </OutlinedText>
              </Pop>
            </Reveal>
            <Text style={[type.labelSm, styles.heroLabel, { color: colors.textMuted }]}>{heroLabel}</Text>
            {/* Ground the claim landed on that was already theirs. It wins no
                border, so it is never inside the + above — but it stacks that
                land's strength and buys it time, which is worth naming rather
                than leaving the runner to wonder where the rest went. */}
            {d.show.reinforced && (
              <Text style={[type.caption, styles.areaSub, { color: colors.textDim }]}>
                {`${fmtArea(reinforced)} of your own land reinforced`}
              </Text>
            )}
          </View>

          {/* 3. THE RUNNER, celebrating right under the number it earned.
              The whole outfit, fitted INTO `d.rig` (hat to shoes). This used
              to hand `d.rig` to CharacterRig as its size, which is the BODY'S
              WIDTH, so the runner drew nearly three times taller than its
              stage and stood up over the ground number above it. */}
          <View style={[styles.stage, { height: d.rig, marginTop: d.gap }]}>
            <View style={styles.cheer} pointerEvents="none">
              {cheer && (
                <Pop trigger={1} from={0.4}>
                  <CheerMarks size={d.rig} />
                </Pop>
              )}
            </View>
            <RunnerFigure ref={rigRef} equipped={myAvatar} height={d.rig} animate />
          </View>

          {/* the steal itself, played out: bomb, blast, their heads thrown out
              of it and landing back in a row pulling a sad face. Pulled up by
              its own headroom so the blast plays over the runner instead of
              over a reserved hole. */}
          {visible && taken.length > 0 && (
            <TerritoryStealBanner
              trigger={claim.territory?.id || claim.run_id || 'steal'}
              victims={taken}
              amount={fmtArea(stolenArea)}
              style={[styles.stealBanner, { marginTop: d.gap - STEAL_HEADROOM }]}
            />
          )}

          {/* the faces */}
          {faces.length > 0 && (
            <Framed
              frame={frameVariant('box', 'people-you-took-land-from')}
              tint={brand.pink}
              fill={colors.card}
              weight={INK.thin}
              pose={framePose('people-you-took-land-from')}
              inset={false}
              style={{ marginTop: d.gap }}
              contentStyle={{ padding: d.cardPad }}
            >
              <OutlinedText
                style={[toonType.sub, styles.peopleHeadline, { color: brand.pink }]}
                outline={toon.ink}
                width={2}
                numberOfLines={2}
              >
                {taken.length === 1
                  ? `CAPTURED FROM ${String(taken[0].username || 'A RUNNER').toUpperCase()}`
                  : `CAPTURED FROM ${taken.length} RUNNERS`}
              </OutlinedText>
              {faces.map((v) => (
                <View key={v.user_id} style={[styles.row, { gap: d.rowGap, marginTop: d.rowGap }]}>
                  <PortraitBorder borderKey={v.rank_key || 'wood'} size={d.face}>
                    <CharacterBust
                      equipped={v.avatar}
                      size={d.face}
                      ring={v.clan_color?.stroke}
                      bg={colors.cardAlt}
                    />
                  </PortraitBorder>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.bodyBold, { color: colors.text }]} numberOfLines={1}>
                      {v.username}
                    </Text>
                    {v.reclaimed ? (
                      <Text style={[type.caption, { color: brand.pink }]}>
                        took your land before, evened up
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[toonType.sub, { fontSize: 15, color: brand.teal }]}>
                    −{fmtArea(v.area_m2)}
                  </Text>
                </View>
              ))}
              {/* Nobody is dropped silently: the line above counts everyone the
                  claim hit, and this says how many of them are off screen. */}
              {unshown > 0 ? (
                <Text style={[type.caption, styles.moreLine, { color: colors.textDim }]}>
                  {`and ${unshown} more`}
                </Text>
              ) : null}
            </Framed>
          )}

          {/* attacks that bounced — honest, and it sets up the rematch. The
              first thing dropped when the screen runs out of room. */}
          {d.show.held && (
            <View style={[styles.heldHead, { marginTop: d.gap }]}>
              <ShieldOff size={16} color={colors.textMuted} />
              <Text style={[type.caption, { color: colors.textMuted }]}>
                {held.length === 1
                  ? `${held[0].username} held their ground`
                  : `${held.length} runners held their ground`}
              </Text>
            </View>
          )}

          {/* 4. HOW IT MOVED YOU. After the win, never above it. */}
          {hasXp && (
            <Reveal from="down" delay={900} duration={240} style={{ marginTop: d.gap }}>
              <ClaimProgress
                xp={claim.xp}
                gained={xpGained}
                delay={950}
                onLevelUp={onLevelUp}
              />
            </Reveal>
          )}

          {d.show.rankUp && rankUp && (
            <Reveal
              from="none"
              delay={1300}
              style={[styles.rankUp, { marginTop: d.gap }]}
              accessible
              accessibilityLabel={`Rank up. ${rankUp.from} to ${rankUp.to}.`}
            >
              <Text style={[type.bodySmBold, styles.rankUpTag, { color: brand.pink }]}>RANK UP!</Text>
              <Text style={[type.bodySmBold, { color: colors.text }]}>{`${rankUp.from} → ${rankUp.to}`}</Text>
            </Reveal>
          )}
        </View>

        {/* 5. ON. The standings are the next beat of the celebration and carry
            their own Done, so the main button goes there. Rank detail is a
            side trip, and looks like one. */}
        <View style={[styles.actions, { paddingBottom: insets.bottom + space.sm }]}>
          <ToonButton
            title="Continue"
            variant="primary"
            accessibilityLabel="Continue"
            onPress={next}
          />
          {onViewRankProgression ? (
            <ToonGhostButton
              title="View rank progression →"
              color={colors.textMuted}
              onPress={onViewRankProgression}
              style={styles.link}
            />
          ) : (
            <View style={{ height: FIXED.link }} />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Everything above the button, centred in the height it has, so any spare
  // room sits at the edges and never opens a hole between two blocks.
  column: {
    flex: 1,
    paddingHorizontal: space.gutter,
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  bannerWrap: { alignSelf: 'center', maxWidth: '88%' },
  bannerInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: space.lg,
    paddingVertical: space.xs,
  },
  bannerTextBox: { flexShrink: 1 },
  bannerText: { color: '#fff', textAlign: 'center' },
  hero: { alignItems: 'center' },
  // The burst sits dead centre on the number and spills past its box.
  burst: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  heroLabel: { letterSpacing: 1.6, marginTop: -2, textAlign: 'center' },
  // A footnote under the hero, not a second number.
  areaSub: { marginTop: 2, textAlign: 'center' },
  stage: { alignItems: 'center', justifyContent: 'flex-end' },
  cheer: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
  // The banner throws heads outside its own bounds, so it never clips.
  stealBanner: { overflow: 'visible' },
  peopleHeadline: { marginBottom: 2 },
  moreLine: { marginTop: 6, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  heldHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  rankUp: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  rankUpTag: { letterSpacing: 0.8 },
  actions: { paddingHorizontal: space.gutter },
  link: { height: FIXED.link, justifyContent: 'center' },
});
