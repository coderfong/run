/* Development integrity check for the cosmetic curation companion data. */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const babel = require('@babel/core');

const root = path.resolve(__dirname, '..');
const configRoot = path.join(root, 'src', 'config') + path.sep;
const originalJs = Module._extensions['.js'];

// Catalogue modules contain React Native asset requires. The validator only
// needs item metadata, so assets resolve to their filename. Reusing an image
// is intentionally neither inspected nor treated as an error.
for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
  Module._extensions[ext] = (mod, filename) => { mod.exports = filename; };
}
Module._extensions['.js'] = (mod, filename) => {
  if (!filename.startsWith(configRoot)) return originalJs(mod, filename);
  const source = fs.readFileSync(filename, 'utf8');
  const { code } = babel.transformSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  mod._compile(code, filename);
};

const { ITEMS } = require(path.join(configRoot, 'cosmetics.js'));
const {
  COSMETIC_ACQUISITION_TYPES,
  COSMETIC_CURATION,
  COSMETIC_STATUSES,
  COSMETIC_THEMES,
} = require(path.join(configRoot, 'cosmeticCuration.js'));

const rows = Object.entries(ITEMS).flatMap(([slot, items]) =>
  items.map((item) => ({ slot, id: item.id, label: item.label }))
);
const catalogueIds = new Set(rows.map(({ id }) => id));
const curationIds = Object.keys(COSMETIC_CURATION);
const errors = [];

const missing = [...catalogueIds].filter((id) => !Object.hasOwn(COSMETIC_CURATION, id));
const unknown = curationIds.filter((id) => !catalogueIds.has(id));
if (missing.length) errors.push(`missing curation IDs: ${missing.join(', ')}`);
if (unknown.length) errors.push(`nonexistent curation IDs: ${unknown.join(', ')}`);

const statuses = new Set(COSMETIC_STATUSES);
const themes = new Set(COSMETIC_THEMES);
const acquisitions = new Set(COSMETIC_ACQUISITION_TYPES);
for (const [id, item] of Object.entries(COSMETIC_CURATION)) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    errors.push(`${id}: curation entry must be an object`);
    continue;
  }
  if (!statuses.has(item.status)) errors.push(`${id}: invalid status ${JSON.stringify(item.status)}`);
  if (!themes.has(item.theme)) errors.push(`${id}: invalid theme ${JSON.stringify(item.theme)}`);
  if (!acquisitions.has(item.acquisitionType)) {
    errors.push(`${id}: invalid acquisitionType ${JSON.stringify(item.acquisitionType)}`);
  }
  if (item.collection !== null && typeof item.collection !== 'string') {
    errors.push(`${id}: collection must be a string or null`);
  }
  if (item.family !== null && typeof item.family !== 'string') {
    errors.push(`${id}: family must be a string or null`);
  }
  const expectedKeys = ['acquisitionType', 'collection', 'family', 'status', 'theme'];
  const keys = Object.keys(item).sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    errors.push(`${id}: schema keys are ${keys.join(', ')}`);
  }
}

function counts(values, keys = [...new Set(values)].sort()) {
  return Object.fromEntries(keys.map((key) => [key, values.filter((v) => v === key).length]));
}

const seen = new Map();
for (const row of rows) seen.set(row.id, [...(seen.get(row.id) || []), row.slot]);
const duplicateIds = [...seen].filter(([, slots]) => slots.length > 1);
const suspiciousIds = [...catalogueIds].filter((id) =>
  typeof id !== 'string' || !id.length || id.trim() !== id || !/^[a-z0-9_]+$/.test(id)
);

console.log(`cosmetic catalogue: ${rows.length} entries, ${catalogueIds.size} unique IDs`);
console.log('by status:', counts(Object.values(COSMETIC_CURATION).map(({ status }) => status), COSMETIC_STATUSES));
console.log('by theme:', counts(Object.values(COSMETIC_CURATION).map(({ theme }) => theme), COSMETIC_THEMES));
console.log('by slot:', counts(rows.map(({ slot }) => slot)));
console.log('duplicate cosmetic IDs:', duplicateIds.length
  ? duplicateIds.map(([id, slots]) => `${JSON.stringify(id)} (${slots.join(', ')})`).join('; ')
  : 'none');
console.log('suspicious cosmetic IDs:', suspiciousIds.length ? suspiciousIds.join(', ') : 'none');

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`curation valid: ${curationIds.length} records cover every live cosmetic ID`);
}
