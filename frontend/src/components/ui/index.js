// UI primitives barrel. Screens import from here:
//   import { Screen, Card, Row, Button, StatValue, Pill, SectionHeader,
//            EmptyState, Skeleton, Sheet } from '../components/ui';

export { default as Screen } from './Screen';
// The night page's dot grid. Screen draws it already; pages that paint their
// own `colors.bg` drop it in as their first child.
export { default as PageTexture } from './PageTexture';
export { default as Card } from './Card';
export { default as Row } from './Row';
export { default as StatValue } from './StatValue';
export { default as Pill } from './Pill';
export { default as Button } from './Button';
export { default as SectionHeader, SectionLabel } from './SectionHeader';
// A section that starts folded away, with SectionHeader's own drawn label as
// its tappable head. The You page is built out of these.
export { default as AccordionSection } from './Accordion';
export { default as EmptyState } from './EmptyState';
export { default as Skeleton } from './Skeleton';
// The page indicator under a paged carousel (Home's hero and quick actions).
export { default as PageDots } from './PageDots';
export { default as Sheet } from './Sheet';
export { default as Segmented } from './Segmented';
// A TextInput that shows its focus ring. Drop-in: it keeps the caller's own
// field style and adds only the ring. See "FOCUS ALWAYS VISIBLE" in theme/nb.js.
export { default as Input } from './Input';
// Hand-drawn box frames (assets/frames, cut by scripts/animations/cut_frames.py).
export { default as Framed } from './Framed';
// Neo-brutalist hard drop shadow (a real offset rectangle, so Android gets it
// too). Tokens in src/theme/nb.js.
export { default as HardShadow } from './HardShadow';
export { default as BackButton } from './BackButton';
export { default as OverflowMenu } from './OverflowMenu';
// The brutalist sticker marks — burst, star, sparkle, daisy, blob, bolt, arrow,
// cross, disc, squiggle. Inline SVG rather than art, so they cost no asset
// slots and can take a colour at the call site.
export { default as Shape, SHAPES } from './Shapes';
// Game-style ("toon") surface — tokens in src/theme/toon.js.
export { default as OutlinedText } from './OutlinedText';
export { default as ToonButton, ToonGhostButton } from './ToonButton';
export {
  ToonCard,
  ToonHeader,
  ToonRow,
  ToonRowGroup,
  ProgressTrack,
  SlotDots,
  GetStartedCard,
  // The copy colour on a `panel` ToonHeader — pages styling their own controls
  // inside one (the season board chips) need it to match.
  PANEL_INK,
} from './toon';
