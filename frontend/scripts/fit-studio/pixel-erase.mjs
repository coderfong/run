import fs from 'node:fs';
import path from 'node:path';

const decodePng = (value) => {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value || '');
  if (!match) throw new Error('Expected a PNG data URL.');
  return Buffer.from(match[1], 'base64');
};

export function saveErasedArt({ frontend, asset, png }) {
  const assets = path.resolve(frontend, 'assets');
  const target = path.resolve(frontend, String(asset || ''));
  if (!target.startsWith(assets + path.sep)) throw new Error('Art must be inside frontend/assets.');
  if (path.extname(target).toLowerCase() !== '.png') throw new Error('Only PNG art can be erased.');
  if (!fs.existsSync(target)) throw new Error('Art file does not exist.');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rel = path.relative(assets, target);
  const backup = path.join(frontend, 'scripts', 'fit-studio', 'backups', 'pixel-erase', stamp, rel);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.copyFileSync(target, backup);
  fs.writeFileSync(target, decodePng(png));
  return { ok: true, asset: rel.split(path.sep).join('/'), backup: path.relative(frontend, backup).split(path.sep).join('/') };
}

export function saveBodyOverride({ frontend, slot, id, png }) {
  if (!/^[a-z0-9_]+$/.test(String(slot || '')) || !/^[a-z0-9_]+$/.test(String(id || ''))) {
    throw new Error('Invalid cosmetic key.');
  }
  const target = path.join(frontend, 'assets', 'character', 'body-overrides', slot, `${id}.png`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (fs.existsSync(target)) {
    const backup = path.join(frontend, 'scripts', 'fit-studio', 'backups', 'body-overrides', stamp, slot, `${id}.png`);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(target, backup);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, decodePng(png));
  return {
    ok: true,
    asset: path.relative(frontend, target).split(path.sep).join('/'),
    key: `${slot}:${id}`,
  };
}
