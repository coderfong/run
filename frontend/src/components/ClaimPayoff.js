// The payoff — the 4 seconds a 30-minute run is actually for.
//
// A claim used to end in a toast. This is the moment instead: your runner
// celebrating, the ground you took, the FACES you took it from, and the two
// ladders the claim moved. Everything here comes from the claim response, so
// it costs no extra round trip.
//
// The headline is earned, not decorative: if any of the runners you just hit
// had taken land off you before, this was a reclaim, and it says so.
//
// IT DOES NOT SCROLL. This was a ScrollView, and a celebration you have to
// scroll is not one — the faces are the point of the screen and they sat below
// the fold, the bars moved where nobody was looking, and the single button off
// the screen took a flick to reach. So the payoff is laid out to the height it
// actually has: `density()` prices every block that is present against the
// window once, and spends what is left on the character. Any error left over
// is absorbed by the stage, which grows into slack and shrinks out of a
// squeeze; nothing carrying a number moves.
//
// The other half of the fit was pricing two blocks honestly. The steal banner
// reserves 90pt of transparent air above its bar for the fireball, which this
// screen was paying for and getting nothing back (see STEAL_HEADROOM); and the
// XP block used to carry a 150pt animation stack of its own, on a screen whose
// level-up already plays full screen from ResultScreen.

import React, { useEffect, useMemo, useRef } from 'react';
import { Modal, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ShieldOff } from 'lucide-react-native';

import { brand, space, toon, toonType, useTheme, useThemedType } from '../theme';
import { Confetti, haptic } from '../ui/motion';
import { Framed, OutlinedText, ToonButton } from './ui';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';
import CharacterRig, { CharacterBust } from './character/CharacterRig';
import PortraitBorder from './PortraitBorder';
import AppIcon from './AppIcon';
import TerritoryStealBanner, { STEAL_HEADROOM } from './TerritoryStealBanner';
import XpProgress from './XpProgress';
import RankProgress from './rank/RankProgress';
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

// ---------------------------------------------------------------------------
// The fit.
//
// Every number below is the height a block occupies at full size, measured off
// the styles at the bottom of this file. They are ESTIMATES on purpose:
// measuring for real means rendering once at natural size and rescaling on the
// second frame, which on a screen that opens with confetti reads as the layout
// assembling in front of you. An estimate a few points out costs a few points
// of the character's floor and nothing else.
//
// THE SPLIT IS THE WHOLE TRICK. Some of this screen scales and some of it does
// not: a portrait, a margin and a hero number can all be drawn smaller, while
// a line of caption text, the steal banner's bar and the two ladder bars are
// the size they are. Solving one ratio against the WHOLE height is what makes
// a naive fit overflow — the fixed half does not shrink with it, so the layout
// comes out taller than the box it was fitted to. So the fixed heights are
// taken off the top and the ratio is solved against what is left.
//
// `k` is floored rather than unbounded: past about two thirds the frames stop
// looking like frames, and a payoff that fits with one face cut from it beats
// one that fits by becoming small.
// ---------------------------------------------------------------------------

// Scales with `k`.
const FLEX = {
  headline: 76,
  rig: 104,
  stageGap: 18, // above AND below the stage
  area: 72, // the hero number's own line plus its padding
  peoplePad: 32,
  peopleRow: 50, // a portrait and the air above it
  gap: 12, // between blocks
};

// Does not.
const FIXED = {
  areaSub: 18,
  // The banner's BAR. Its 90pt of fireball headroom is pulled back out below,
  // so the screen is not charged for a hole.
  stealBar: 46,
  peopleHead: 24,
  peopleMore: 18,
  held: 20,
  rank: 72,
  xp: 82,
  cta: 60,
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

// The sizes `k` produces. Every floor here is the point below which that thing
// stops doing its job — a 20pt hero number is not a hero number — which is why
// the fit is solved rather than calculated: the floors mean the arithmetic can
// come out a few points long, and a few points long is a scroll bar.
function sizes(k, pad) {
  const s = (n) => Math.round(n * k);
  return {
    k,
    pad,
    gap: s(FLEX.gap),
    // The rig's shoes overhang its layout box, so the floor under it can never
    // go to zero — but it is the first thing to give when the screen is short.
    rig: Math.max(66, s(FLEX.rig)),
    stageGap: Math.max(6, s(FLEX.stageGap)),
    headline: Math.max(58, s(FLEX.headline)),
    // Floored well above the captions around it: this is the number the whole
    // screen is about, and it stops being that below the high twenties.
    areaFont: Math.max(27, s(40)),
    areaPad: Math.max(6, s(space.md)),
    face: Math.max(30, s(38)),
    rowGap: Math.max(6, s(space.md)),
    cardPad: Math.max(10, s(space.lg)),
  };
}

function solve({ avail, pad, rows, extra, blocks }) {
  const gaps =
    (blocks.steal ? 1 : 0) +
    (rows > 0 ? 1 : 0) +
    (blocks.held ? 1 : 0) +
    (blocks.rank ? 1 : 0) +
    (blocks.xp ? 1 : 0);

  let flex = FLEX.headline + FLEX.rig + FLEX.stageGap * 2 + FLEX.area + gaps * FLEX.gap;
  if (rows > 0) flex += FLEX.peoplePad + rows * FLEX.peopleRow;

  let fixed = 0;
  if (blocks.reinforced) fixed += FIXED.areaSub;
  if (blocks.steal) fixed += FIXED.stealBar;
  if (rows > 0) fixed += FIXED.peopleHead;
  if (extra > 0) fixed += FIXED.peopleMore;
  if (blocks.held) fixed += FIXED.held;
  if (blocks.rank) fixed += FIXED.rank;
  if (blocks.xp) fixed += FIXED.xp;

  // The algebra gets close; the floors and the rounding are what it cannot
  // see, so the last few points are walked off rather than assumed away.
  let d = sizes(Math.max(MIN_K, Math.min(1, (avail - fixed) / flex)), pad);
  for (let guard = 0; guard < 24; guard += 1) {
    if (fittedHeight({ d, rows, extra, blocks }) <= avail || d.k <= MIN_K) break;
    d = sizes(Math.max(MIN_K, d.k - 0.02), pad);
  }
  return { ...d, show: blocks, fits: fittedHeight({ d, rows, extra, blocks }) <= avail };
}

/**
 * How big everything is, and what survives.
 *
 * SHRINKING IS NOT THE FIRST ANSWER. A small phone carrying a brawl — six
 * runners hit, a defence that held, land reinforced, both ladders moved — has
 * more to say than it has room for, and squeezing all of it makes every part
 * worse. So the two footnotes go first, cheapest first: the line about a
 * defence that held, then the line about ground reinforced. Both are context
 * on a screen whose subject is the ground that changed hands, and both are
 * still available on the run itself. Only once they are gone does the layout
 * start giving up size.
 */
function density({ winH, top, bottom, rows, extra, blocks }) {
  const pad = space.md;
  const avail = Math.max(320, winH - top - bottom - FIXED.cta - space.md - pad * 2);

  const shed = [
    blocks,
    { ...blocks, held: false },
    { ...blocks, held: false, reinforced: false },
  ];
  let last = null;
  for (let i = 0; i < shed.length; i += 1) {
    last = solve({ avail, pad, rows, extra, blocks: shed[i] });
    if (last.fits) return last;
  }
  // Nothing fits even stripped: the floor wins and the stage absorbs the rest.
  // Reachable only on a window shorter than any phone ships with.
  return last;
}

// The height the layout above actually comes out at, for a given density — the
// same sum the fit is solved against, read back. It lives here so it can never
// drift from the numbers it is checking.
export function fittedHeight({ d, rows, extra, blocks }) {
  const gaps =
    (blocks.steal ? 1 : 0) +
    (rows > 0 ? 1 : 0) +
    (blocks.held ? 1 : 0) +
    (blocks.rank ? 1 : 0) +
    (blocks.xp ? 1 : 0);

  let h = d.headline + d.stageGap * 2 + d.rig + Math.round(d.areaFont * 1.2) + d.areaPad * 2;
  h += gaps * d.gap;
  if (blocks.reinforced) h += FIXED.areaSub;
  if (blocks.steal) h += FIXED.stealBar;
  if (rows > 0) h += FIXED.peopleHead + d.cardPad * 2 + rows * (d.face + d.rowGap);
  if (extra > 0) h += FIXED.peopleMore;
  if (blocks.held) h += FIXED.held;
  if (blocks.rank) h += FIXED.rank;
  if (blocks.xp) h += FIXED.xp;
  return h;
}

// Exported for the same reason: the fit is arithmetic, and arithmetic can be
// tested on every screen size without rendering one of them.
export { density, faceCap };

export default function ClaimPayoff({ visible, claim, myAvatar, onClose, onViewLeaderboard }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const rigRef = useRef(null);

  useEffect(() => {
    if (!visible) return undefined;
    haptic.success();
    const t = setTimeout(() => rigRef.current?.play('celebrate'), 400);
    return () => clearTimeout(t);
  }, [visible]);

  const victims = claim?.victims || [];
  const taken = victims.filter((v) => !v.defended);
  const held = victims.filter((v) => v.defended);
  const faces = taken.slice(0, faceCap(winH));
  const unshown = taken.length - faces.length;

  const area = gained(claim);
  const reinforced = claim?.reinforced_m2 || 0;
  const stolenArea = taken.reduce((sum, v) => sum + (v.area_m2 || 0), 0);
  // Rated claims only. A neutral expansion leaves the ladder exactly where it
  // was, and a bar that travels nowhere is worse than no bar — it says the
  // claim was judged and found to be worth nothing.
  const rated = claim?.solo_elo != null && (claim?.solo_elo_delta || 0) !== 0;
  const xpGained = claim?.xp_gained || 0;

  const d = useMemo(
    () =>
      density({
        winH,
        top: insets.top,
        bottom: insets.bottom,
        rows: faces.length,
        extra: unshown,
        blocks: {
          reinforced: reinforced >= 1,
          steal: taken.length > 0,
          held: held.length > 0,
          rank: rated,
          xp: xpGained > 0,
        },
      }),
    [
      winH,
      insets.top,
      insets.bottom,
      faces.length,
      unshown,
      reinforced,
      taken.length,
      held.length,
      rated,
      xpGained,
    ]
  );

  if (!claim) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <Confetti count={34} />

        <View style={[styles.column, { paddingTop: insets.top + d.pad, paddingBottom: d.pad }]}>
          <Framed
            frame={frameVariant('featured', headline(claim))}
            tint={toon.ink}
            fill={brand.pink}
            weight={INK.bold}
            pose={framePose(headline(claim))}
            inset={false}
            style={{ minHeight: d.headline }}
            contentStyle={styles.headlineInner}
          >
            <OutlinedText style={[toonType.hero, styles.headline]} outline={toon.ink} width={3} fit minimumFontScale={0.62}>
              {headline(claim)}
            </OutlinedText>
          </Framed>

          {/* The slack in the layout is spent HERE. On a tall screen the
              character gets a floor to celebrate on; on a short one this is
              the only thing that gives, which is the right thing to give —
              every other block on this screen is carrying a number. */}
          <View style={[styles.stage, { minHeight: d.rig, marginVertical: d.stageGap }]}>
            <CharacterRig ref={rigRef} equipped={myAvatar} size={d.rig} animate />
          </View>

          <Framed
            frame={frameVariant('heading', 'claimed-area')}
            tint={toon.ink}
            fill={colors.card}
            weight={INK.base}
            pose={framePose('claimed-area')}
            inset={false}
            style={styles.areaFrame}
            contentStyle={[styles.areaInner, { paddingVertical: d.areaPad }]}
          >
            <OutlinedText
              style={[
                toonType.hero,
                { color: brand.teal, fontSize: d.areaFont, lineHeight: Math.round(d.areaFont * 1.2) },
              ]}
              outline={toon.ink}
              width={3}
            >
              {`+${fmtArea(area)}`}
            </OutlinedText>
            {/* Ground the claim landed on that was already theirs. It wins no
                border, so it is never inside the + above — but it stacks that
                land's strength and buys it time, which is worth naming rather
                than leaving the runner to wonder where the rest went. */}
            {d.show.reinforced && (
              <Text style={[type.caption, styles.areaSub, { color: colors.textDim }]}>
                {`${fmtArea(reinforced)} of your own land reinforced`}
              </Text>
            )}
          </Framed>

          {/* the steal itself, played out: bomb, blast, their heads thrown out
              of it and landing back in a row pulling a sad face.
              Pulled up by its own headroom so the blast plays OVER the number
              above it instead of over a reserved hole — the bar itself does not
              move, and the screen gets 90pt back. */}
          {visible && taken.length > 0 && (
            <TerritoryStealBanner
              trigger={claim.territory?.id || claim.run_id || 'steal'}
              victims={taken}
              amount={fmtArea(stolenArea)}
              style={[styles.stealBanner, { marginTop: d.gap - STEAL_HEADROOM }]}
            />
          )}

          {/* the faces — the whole point of the rebuild */}
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
              {/* `label` (13pt, no line-height) was sized for a short chip
                  caption, not a sentence carrying a username — against a white
                  card with only a 1.5pt outline it read as a thin grey line
                  more than a headline. `sub` plus a heavier outline and a
                  two-line allowance keeps a long or clipped-looking name from
                  crowding the frame's edge. */}
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
                  claim hit, and this says how many of them are standing off
                  screen. */}
              {unshown > 0 ? (
                <Text style={[type.caption, styles.moreLine, { color: colors.textDim }]}>
                  {`and ${unshown} more`}
                </Text>
              ) : null}
            </Framed>
          )}

          {/* attacks that bounced — honest, and it sets up the rematch. The
              first thing dropped when the screen runs out of room; see
              `density`. */}
          {d.show.held && (
            <View style={[styles.heldHead, { marginTop: d.gap }]}>
              <ShieldOff size={16} color={colors.textMuted} />
              <Text style={[type.caption, { color: colors.textMuted }]}>
                {held.length === 1
                  ? `DEFENDED · ${held[0].username} held their ground`
                  : `DEFENDED · ${held.length} runners held their ground`}
              </Text>
            </View>
          )}

          {/* THE TWO LADDERS, AS MOVEMENT.
              This was two lines of receipt — "+21 rank points · 2,471 total"
              and a "+205 XP" over a bar that filled from empty. Neither said
              the thing a claim is judged on, which is whether it moved you.
              Rank goes first because it is the one that can FALL, and because
              it is what the faces above were a fight over. */}
          {rated && (
            <RankProgress
              points={claim.solo_elo}
              delta={claim.solo_elo_delta}
              style={{ marginTop: d.gap }}
            />
          )}

          {xpGained > 0 && (
            <XpProgress
              xp={claim.xp}
              gained={xpGained}
              accent={brand.teal}
              style={{ marginTop: d.gap }}
            />
          )}
        </View>

        {/* One way on, and it goes forward. A Done ghost button used to sit
            under this, which made the payoff a fork between two ways off the
            same screen — and the standings behind it, the part that says what
            the claim was worth against everybody else, was the one people
            skipped. The standings carry their own Done. */}
        <View style={[styles.actions, { paddingBottom: insets.bottom + space.md }]}>
          <ToonButton
            title="See the leaderboard"
            variant="teal"
            icon={<AppIcon name="trophy" size={22} />}
            onPress={onViewLeaderboard}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Everything above the button, in the height it has. No scroll: see the
  // header. Blocks lay out top down and the stage takes the slack.
  column: { flex: 1, paddingHorizontal: space.gutter, alignItems: 'stretch' },
  headlineInner: { flex: 1, justifyContent: 'center', paddingHorizontal: space.md, paddingVertical: space.sm },
  headline: { color: '#fff', textAlign: 'center' },
  // Grows into whatever the priced blocks did not use, and shrinks out of a
  // squeeze — but never below the rig it is holding.
  stage: { flexGrow: 1, flexShrink: 1, alignItems: 'center', justifyContent: 'center' },
  areaFrame: { alignSelf: 'center', minWidth: 230 },
  areaInner: { alignItems: 'center', paddingHorizontal: space.lg },
  // A footnote under the hero number, not a second number.
  areaSub: { marginTop: 4, textAlign: 'center' },
  // The banner throws heads outside its own bounds, so it never clips.
  stealBanner: { overflow: 'visible' },
  peopleHeadline: { marginBottom: 2 },
  moreLine: { marginTop: 6, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  heldHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  actions: { paddingHorizontal: space.gutter },
});
