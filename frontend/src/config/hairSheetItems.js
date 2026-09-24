// GENERATED — silhouette hair sheets (scripts/install-hair-sheets.py).
//
// Cut from three sheets of black hairstyle silhouettes. The source art carried
// white highlight strokes of wildly different weights; those are filled so
// every style reads as one flat mass, matching the rest of the slot. Any jaw
// outline drawn around the face was stripped — the rig draws its own head.
//
// Colourable: `art` is the 10 HAIR_COLORS variants, same as the hand-authored
// hair. Placement was solved per style off the face opening (or off the skull
// width, for cuts that sit on the head rather than framing it).

const free = null;
const runs = (n, label) => ({ stat: 'runs_count', value: n, label });
const level = (n) => ({ stat: 'level', value: n, label: `Reach level ${n}` });

export const HAIR_SHEETS = [
  { id: 'hs11', label: 'Slick cap', art: [require('../../assets/character/hair/hairS11_0.png'), require('../../assets/character/hair/hairS11_1.png'), require('../../assets/character/hair/hairS11_2.png'), require('../../assets/character/hair/hairS11_3.png'), require('../../assets/character/hair/hairS11_4.png'), require('../../assets/character/hair/hairS11_5.png'), require('../../assets/character/hair/hairS11_6.png'), require('../../assets/character/hair/hairS11_7.png'), require('../../assets/character/hair/hairS11_8.png'), require('../../assets/character/hair/hairS11_9.png')], layout: { w: 0.7940, top: -0.0274, dx: 0.0070 }, rarity: 'common', unlock: free },
  { id: 'hs15', label: 'Crest', art: [require('../../assets/character/hair/hairS15_0.png'), require('../../assets/character/hair/hairS15_1.png'), require('../../assets/character/hair/hairS15_2.png'), require('../../assets/character/hair/hairS15_3.png'), require('../../assets/character/hair/hairS15_4.png'), require('../../assets/character/hair/hairS15_5.png'), require('../../assets/character/hair/hairS15_6.png'), require('../../assets/character/hair/hairS15_7.png'), require('../../assets/character/hair/hairS15_8.png'), require('../../assets/character/hair/hairS15_9.png')], layout: { w: 0.6954, top: -0.0816, dx: -0.0057 }, rarity: 'common', unlock: free },
  { id: 'hs22', label: 'Tousled crop', art: [require('../../assets/character/hair/hairS22_0.png'), require('../../assets/character/hair/hairS22_1.png'), require('../../assets/character/hair/hairS22_2.png'), require('../../assets/character/hair/hairS22_3.png'), require('../../assets/character/hair/hairS22_4.png'), require('../../assets/character/hair/hairS22_5.png'), require('../../assets/character/hair/hairS22_6.png'), require('../../assets/character/hair/hairS22_7.png'), require('../../assets/character/hair/hairS22_8.png'), require('../../assets/character/hair/hairS22_9.png')], layout: { w: 0.9458, top: -0.0868, dx: 0.0003 }, rarity: 'common', unlock: free },
  { id: 'hs25', label: 'Curly updo', art: [require('../../assets/character/hair/hairS25_0.png'), require('../../assets/character/hair/hairS25_1.png'), require('../../assets/character/hair/hairS25_2.png'), require('../../assets/character/hair/hairS25_3.png'), require('../../assets/character/hair/hairS25_4.png'), require('../../assets/character/hair/hairS25_5.png'), require('../../assets/character/hair/hairS25_6.png'), require('../../assets/character/hair/hairS25_7.png'), require('../../assets/character/hair/hairS25_8.png'), require('../../assets/character/hair/hairS25_9.png')], layout: { w: 0.7907, top: -0.1303, dx: 0.0026 }, bulky: true, rarity: 'common', unlock: free },
  { id: 'hs26', label: 'Pigtails', art: [require('../../assets/character/hair/hairS26_0.png'), require('../../assets/character/hair/hairS26_1.png'), require('../../assets/character/hair/hairS26_2.png'), require('../../assets/character/hair/hairS26_3.png'), require('../../assets/character/hair/hairS26_4.png'), require('../../assets/character/hair/hairS26_5.png'), require('../../assets/character/hair/hairS26_6.png'), require('../../assets/character/hair/hairS26_7.png'), require('../../assets/character/hair/hairS26_8.png'), require('../../assets/character/hair/hairS26_9.png')], layout: { w: 1.1753, top: -0.0288, dx: 0.0032 }, rarity: 'common', unlock: free },
];
