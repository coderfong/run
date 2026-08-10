// The economy contract, client side.
//
// Asserts `src/config/economy.js` satisfies every vector in
// `../../economy-contract.json` — the same file `backend/test_economy_contract.py`
// checks the server against. Between them, the two implementations cannot
// drift apart without a test going red, which is the whole point: the running
// screen previewed a retired claim formula for months and nothing compared it
// to the server's.
//
// Deliberately dependency-free. There is no test runner in this project yet,
// and the guard for the bug that actually shipped should not be blocked on
// adding one. `economy.js` is ESM inside a CommonJS package, so plain Node
// cannot import it directly — it is copied to a temp .mjs (it has no imports
// of its own, so nothing else needs resolving) and imported from there.
//
//   node scripts/check-economy-contract.mjs

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODULE = path.join(here, '..', 'src', 'config', 'economy.js');
const CONTRACT = path.join(here, '..', '..', 'economy-contract.json');

const failures = [];
let passes = 0;

function check(label, ok, detail = '') {
  if (ok) passes += 1;
  else failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
}

function eq(label, got, want, tol = 0.5) {
  check(label, Math.abs(got - want) <= tol, `got ${got} want ${want}`);
}

async function loadEconomy() {
  const dir = mkdtempSync(path.join(tmpdir(), 'paser-econ-'));
  const copy = path.join(dir, 'economy.mjs');
  writeFileSync(copy, readFileSync(MODULE, 'utf8'));
  try {
    return await import(pathToFileURL(copy).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const E = await loadEconomy();
const c = JSON.parse(readFileSync(CONTRACT, 'utf8'));

console.log(`economy contract v${c.economy_version} — client side`);

check(
  `ECONOMY_VERSION is ${c.economy_version}`,
  E.ECONOMY_VERSION === c.economy_version,
  E.ECONOMY_VERSION
);

// --- constants (camelCase here, snake_case on the wire) --------------------
const snakeToCamel = (s) => s.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
for (const [name, want] of Object.entries(c.constants)) {
  const key = snakeToCamel(name);
  check(`ECONOMY.${key} === ${want}`, E.ECONOMY[key] === want, E.ECONOMY[key]);
}

// --- the curve, from a standing start --------------------------------------
for (const row of c.claim_area_m2) {
  eq(`claimAreaM2(${row.distance_m} m)`, E.claimAreaM2(row.distance_m), row.expected);
}

// --- the DAILY entitlement: splitting a run must not multiply land ---------
for (const row of c.daily_entitlement) {
  let total = 0;
  let before = 0;
  for (const leg of row.splits) {
    total += E.entitledAreaM2(before, leg);
    before += leg;
  }
  eq(`entitlement — ${row.label}`, total, row.expected_total, 1.0);
}

// --- qualification ----------------------------------------------------------
for (const row of c.run_tier) {
  const got = E.runTier(row.distance_m, row.duration_s, row.unique_m);
  check(
    `runTier(${row.distance_m} m, ${row.duration_s} s, ${row.unique_m} m unique) === ${row.expected}`,
    got === row.expected,
    got
  );
}

// --- payouts ----------------------------------------------------------------
for (const row of c.run_coins) {
  eq(`runCoins(${row.distance_m} m)`, E.runCoins(row.distance_m), row.expected);
}
for (const row of c.run_energy) {
  eq(`runEnergy(${row.distance_m} m)`, E.runEnergy(row.distance_m), row.expected);
}

// --- claim pricing ----------------------------------------------------------
for (const row of c.claim_cost) {
  const got = E.claimCost(row.action, row.first_of_day);
  check(
    `claimCost(${row.action}, first=${row.first_of_day}) === ${row.expected}`,
    got === row.expected,
    got
  );
}

console.log(`\n${passes} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`  FAIL ${f}`);
  process.exit(1);
}
console.log('ECONOMY CONTRACT UPHELD (client)');
