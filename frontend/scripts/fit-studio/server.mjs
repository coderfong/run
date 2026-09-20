// Fit Studio — local server for the drag-and-resize fitting tool.
//
//   node scripts/fit-studio/server.mjs      then open http://localhost:5178
//
// Serves the editor, the catalogue manifest, and the art itself; takes the
// dragged fits back over POST and can write them into the catalogue.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import url from 'node:url';

import { buildManifest, FRONTEND } from './manifest.mjs';
import { applyOverrides, OVERRIDES_FILE } from './apply-fit.mjs';
import { deleteItem } from './delete-item.mjs';
import { removeCollar, collarArt, origFile, savePaint } from './collar.mjs';
import { saveBodyOverride, saveErasedArt } from './pixel-erase.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const PORT = Number(process.env.FIT_PORT || 5178);

const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json' };

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      // Generous, because a repainted collar posts whole PNGs as base64.
      if (data.length > 3.2e7) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (pathname === '/' || pathname === '/index.html') {
      return send(res, 200, fs.readFileSync(path.join(HERE, 'index.html')), TYPES['.html']);
    }

    if (pathname === '/manifest.json') {
      return send(res, 200, JSON.stringify(await buildManifest()));
    }

    if (pathname === '/overrides.json') {
      const body = fs.existsSync(OVERRIDES_FILE) ? fs.readFileSync(OVERRIDES_FILE, 'utf8') : '{}';
      return send(res, 200, body);
    }

    if (pathname === '/save' && req.method === 'POST') {
      const body = await readBody(req);
      JSON.parse(body); // reject anything that is not valid JSON before it hits disk
      fs.writeFileSync(OVERRIDES_FILE, body, 'utf8');
      return send(res, 200, JSON.stringify({ ok: true, at: Date.now() }));
    }

    if (pathname === '/apply' && req.method === 'POST') {
      const body = await readBody(req);
      const dryRun = !!JSON.parse(body || '{}').dryRun;
      const result = await applyOverrides({ dryRun });
      return send(res, 200, JSON.stringify(result));
    }

    if (pathname === '/delete' && req.method === 'POST') {
      const { slot, id, removeArt, force, newDefault } = JSON.parse(await readBody(req) || '{}');
      const result = await deleteItem({ slot, id, removeArt: !!removeArt, force: !!force, newDefault: newDefault || null });
      if (result.ok) console.log(`deleted ${slot}:${id}${result.artMoved.length ? ` (+${result.artMoved.length} art file(s) to deleted-art/)` : ''}`);
      return send(res, 200, JSON.stringify(result));
    }

    if (pathname === '/collar-remove' && req.method === 'POST') {
      const { id } = JSON.parse(await readBody(req) || '{}');
      const result = removeCollar({ id });
      if (result.ok) console.log(`collar back piece removed from ${id} (${result.stem})`);
      return send(res, 200, JSON.stringify(result));
    }

    if (pathname === '/collar-art') {
      const id = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('id');
      return send(res, 200, JSON.stringify(collarArt({ id })));
    }

    // The shoe before any cut, which is what the brush paints on. It lives in
    // scripts/backups/, outside the tree /art/ is allowed to reach.
    if (pathname.startsWith('/collar-orig/')) {
      const file = origFile(path.basename(decodeURIComponent(pathname.slice('/collar-orig/'.length))));
      if (!file || !fs.existsSync(file)) return send(res, 404, 'not found', 'text/plain');
      res.writeHead(200, { 'Content-Type': TYPES['.png'], 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(file));
    }

    if (pathname === '/collar-paint' && req.method === 'POST') {
      const { id, pieces } = JSON.parse(await readBody(req) || '{}');
      const result = savePaint({ id, pieces });
      if (result.ok) {
        console.log(`collar repainted on ${id} (${result.stem}): ${result.wrote.join(', ')}` +
          (result.catalogue === 'unchanged' ? '' : ` [catalogue ${result.catalogue}]`));
      }
      return send(res, 200, JSON.stringify(result));
    }

    if (pathname === '/erase-save' && req.method === 'POST') {
      const { asset, png, kind, slot, id } = JSON.parse(await readBody(req) || '{}');
      const result = kind === 'body'
        ? saveBodyOverride({ frontend: FRONTEND, slot, id, png })
        : saveErasedArt({ frontend: FRONTEND, asset, png });
      console.log(`pixel erase saved: ${result.asset}${result.backup ? ` (backup: ${result.backup})` : ''}`);
      return send(res, 200, JSON.stringify(result));
    }

    // Art. Everything under frontend/assets, nothing above it.
    if (pathname.startsWith('/art/')) {
      const target = path.resolve(FRONTEND, decodeURIComponent(pathname.slice('/art/'.length)));
      const assets = path.join(FRONTEND, 'assets');
      if (!target.startsWith(assets) || !fs.existsSync(target)) return send(res, 404, 'not found', 'text/plain');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(target)] || 'application/octet-stream' });
      return res.end(fs.readFileSync(target));
    }

    return send(res, 404, 'not found', 'text/plain');
  } catch (err) {
    console.error(err);
    return send(res, 500, JSON.stringify({ error: String(err && err.message ? err.message : err) }));
  }
});

server.listen(PORT, () => {
  console.log(`Fit Studio  →  http://localhost:${PORT}`);
  console.log(`art from     ${path.join(FRONTEND, 'assets')}`);
});
