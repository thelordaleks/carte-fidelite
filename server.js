// server.js — Cartes persistantes hors-ligne (SW + Manifest + API JSON)
import express from 'express';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import bwipjs from 'bwip-js';
import nodemailer from 'nodemailer';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cors());
app.use(morgan('dev'));
app.use('/static', express.static(path.join(__dirname, 'static')));

// === ENV ===
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || process.env.SECRET || '';
const TEMPLATE_FILE = process.env.TEMPLATE_FILE || path.join(__dirname, 'template.html');
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL.replace(/\/+$/,'') : '';
const PORT = Number(process.env.PORT || 3000);

// SMTP
const SMTP = {
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  from: process.env.SMTP_FROM
};

// === Turso (libSQL) ===
let db;
async function getDb() {
  if (db) return db;
  const { createClient } = await import('@libsql/client');
  db = createClient({
    url: process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL,
    authToken: process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN,
  });
  return db;
}

async function initDb() {
  const dbc = await getDb();
  await dbc.execute(`
    CREATE TABLE IF NOT EXISTS cards(
      code TEXT PRIMARY KEY,
      nom TEXT,
      prenom TEXT,
      email TEXT,
      telephone TEXT,
      points INTEGER DEFAULT 0,
      reduction INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );
  `);
}

// === Helpers ===
function absoluteBaseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function readFileOrFallback(file, fallback='') {
  try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceTokens(tpl, card, base) {
  // Remplacements simples (adapter au besoin selon ton template)
  const map = {
    '{{CODE}}': card.code || '',
    '{{NOM}}': card.nom || '',
    '{{PRENOM}}': card.prenom || '',
    '{{EMAIL}}': card.email || '',
    '{{TELEPHONE}}': card.telephone || '',
    '{{POINTS}}': String(card.points ?? ''),
    '{{REDUCTION}}': String(card.reduction ?? ''),
    '{{BARCODE_URL}}': `${base}/barcode/${encodeURIComponent(card.code)}`,
    '{{BASE_URL}}': base
  };
  let out = String(tpl);
  for (const [k, v] of Object.entries(map)) {
    out = out.replace(new RegExp(escapeRegExp(k), 'g'), v);
  }
  return out;
}

function toIntOrUndef(x) {
  if (x === null || x === undefined || x === '') return undefined;
  const n = Number(String(x).replace(',', '.'));
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function createTransporter() {
  if (!SMTP.host || !SMTP.user || !SMTP.pass || !SMTP.from) {
    // Mode "no-op" si SMTP non configuré. Utile en dev.
    return {
      async sendMail() { return { messageId: 'dev-noop' }; }
    };
  }
  return nodemailer.createTransport({
    host: SMTP.host,
    port: SMTP.port,
    secure: SMTP.port === 465,
    auth: { user: SMTP.user, pass: SMTP.pass }
  });
}

// === OFFLINE: snippet injecté dans la page carte ===
const OFFLINE_SNIPPET = `
<link rel="manifest" href="/manifest.webmanifest">
<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(()=>{});
    });
  }
</script>
`;

// === API: création/maj d’une carte ===
app.post('/api/create-card', async (req, res) => {
  try {
    const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
    if (ADMIN_TOKEN && auth !== ADMIN_TOKEN) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const body = req.body || {};
    const card = {
      code: String(body.code || '').trim(),
      nom: body.nom ? String(body.nom).trim() : null,
      prenom: body.prenom ? String(body.prenom).trim() : null,
      email: body.email ? String(body.email).trim() : null,
      telephone: body.telephone ? String(body.telephone).trim() : null,
      points: toIntOrUndef(body.points) ?? 0,
      reduction: toIntOrUndef(body.reduction) ?? 0,
    };
    if (!card.code) return res.status(400).json({ error: 'missing-code' });

    const dbc = await getDb();
    await dbc.execute({
      sql: `
        INSERT INTO cards(code, nom, prenom, email, telephone, points, reduction, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(code) DO UPDATE SET
          nom=excluded.nom,
          prenom=excluded.prenom,
          email=excluded.email,
          telephone=excluded.telephone,
          points=excluded.points,
          reduction=excluded.reduction,
          updated_at=datetime('now')
      `,
      args: [card.code, card.nom, card.prenom, card.email, card.telephone, card.points, card.reduction]
    });

    res.json({ ok: true, code: card.code });
  } catch (e) {
    console.error('create-card failed:', e);
    res.status(500).json({ error: 'create-failed', detail: String(e.message || e) });
  }
});

// === API: lire une carte (JSON) — pour rafraîchissements dynamiques ===
app.get('/api/card/:code', async (req, res) => {
  try {
    const dbc = await getDb();
    const r = await dbc.execute({ sql: 'SELECT * FROM cards WHERE code=?', args: [req.params.code] });
    if (!r.rows.length) return res.status(404).json({ error: 'not-found' });
    res.json(r.rows[0]);
  } catch (e) {
    console.error('read card failed:', e);
    res.status(500).json({ error: 'read-failed' });
  }
});

// === Rendu HTML de la carte ===
app.get('/c/:code', async (req, res) => {
  try {
    const dbc = await getDb();
    const r = await dbc.execute({ sql: 'SELECT * FROM cards WHERE code=?', args: [req.params.code] });
    if (!r.rows.length) return res.status(404).send('Carte inconnue');
    const card = r.rows[0];
    const base = absoluteBaseUrl(req);
    const tpl = readFileOrFallback(TEMPLATE_FILE, `
      <!doctype html><meta charset="utf-8">
      <title>Carte fidélité</title>
      <h1>Carte {{CODE}}</h1>
      <p>{{PRENOM}} {{NOM}}</p>
      <p>Points: <strong id="points">{{POINTS}}</strong></p>
      <p>Réduction: <strong id="reduction">{{REDUCTION}}</strong></p>
      <img alt="code-barres" src="{{BARCODE_URL}}" />
    `);
    const html = replaceTokens(tpl, card, base);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html + OFFLINE_SNIPPET);
  } catch (e) {
    console.error(e);
    res.status(500).send('render-failed');
  }
});

// === Code‑barres: PNG Code128, sans texte ===
app.get('/barcode/:txt', async (req, res) => {
  try {
    const png = await bwipjs.toBuffer({
      bcid: 'code128',
      text: req.params.txt,
      scale: 3,
      height: 12,
      includetext: false,
      backgroundcolor: 'FFFFFF'
    });
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  } catch {
    res.status(400).send('bad-barcode');
  }
});

// === Service Worker (hors-ligne) ===
const SW_SOURCE = `
const CACHE = 'card-cache-v1';
const toPrecache = ['/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(toPrecache)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

function shouldCache(req) {
  const u = new URL(req.url);
  if (req.method !== 'GET') return false;
  return u.pathname.startsWith('/c/')
      || u.pathname.startsWith('/barcode/')
      || u.pathname.startsWith('/static/')
      || u.pathname === '/manifest.webmanifest';
}

// Stratégie: Stale-While-Revalidate
self.addEventListener('fetch', (event) => {
  if (!shouldCache(event.request)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request);
    const networkFetch = fetch(event.request).then(resp => {
      if (resp && resp.status === 200) cache.put(event.request, resp.clone());
      return resp;
    }).catch(() => cached || new Response('Hors ligne', { status: 503, headers:{'Content-Type':'text/plain; charset=utf-8'} }));
    return cached || networkFetch;
  })());
});
`;
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(SW_SOURCE);
});

// === Manifest Web App ===
app.get('/manifest.webmanifest', (req, res) => {
  const base = absoluteBaseUrl(req);
  res.json({
    name: 'Carte fidélité',
    short_name: 'Carte',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#111111',
    icons: [
      { src: base + '/static/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: base + '/static/icon-512.png', sizes: '512x512', type: 'image/png' }
    ]
  });
});

// === Email (facultatif: envoi de carte) ===
app.post('/api/send-card', async (req, res) => {
  try {
    const { to, code } = req.body || {};
    if (!to || !code) return res.status(400).json({ error: 'missing-to-or-code' });

    const dbc = await getDb();
    const r = await dbc.execute({ sql: 'SELECT * FROM cards WHERE code=?', args: [code] });
    if (!r.rows.length) return res.status(404).json({ error: 'card-not-found' });
    const card = r.rows[0];

    const base = PUBLIC_BASE_URL || '';
    const link = base ? `${base}/c/${encodeURIComponent(code)}` : `/c/${encodeURIComponent(code)}`;

    const html = `
      <p>Bonjour ${card.prenom || ''} ${card.nom || ''},</p>
      <p>Voici votre carte fidélité: <a href="${link}">${link}</a></p>
      <p>Points: <strong>${card.points ?? 0}</strong> — Réduction: <strong>${card.reduction ?? 0}</strong></p>
    `;

    const transporter = createTransporter();
    const info = await transporter.sendMail({
      from: SMTP.from, to,
      subject: `Votre carte fidélité (${card.code})`,
      html
    });
    res.json({ ok: true, messageId: info.messageId });
  } catch (e) {
    console.error('send mail failed:', e);
    res.status(500).json({ error: 'send-failed', detail: String(e.message || e) });
  }
});

// === Boot ===
initDb().then(() => {
  app.listen(PORT, () => console.log('Listening on', PORT));
}).catch((e) => {
  console.error('DB init failed:', e);
  process.exit(1);
});
