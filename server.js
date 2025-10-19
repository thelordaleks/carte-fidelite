// server.js — Cartes fidélité PWA (SW + Manifest) + API + Email + Codes-barres
// Node 18+ recommandé (global fetch, ESM)

import express from 'express';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import bwipjs from 'bwip-js';
import nodemailer from 'nodemailer';
import { fileURLToPath } from 'url';

// --- Boot env
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(cors());
app.use(morgan('dev'));
app.use('/static', express.static(path.join(__dirname, 'static'), { maxAge: '30d', etag: true }));

// --- ENV
const PORT = Number(process.env.PORT || 3000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || process.env.SECRET || '';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const TEMPLATE_FILE = process.env.TEMPLATE_FILE || path.join(__dirname, 'template.html');

// --- DB (Turso/libSQL)
let db;
async function getDb() {
  if (db) return db;
  const { createClient } = await import('@libsql/client');
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) {
    console.warn('[DB] TURSO_DATABASE_URL manquant — la base ne sera pas initialisée.');
  }
  db = createClient({ url, authToken });
  return db;
}

async function initDb() {
  const dbc = await getDb();
  if (!dbc) return;
  await dbc.execute(`
    CREATE TABLE IF NOT EXISTS cards (
      code TEXT PRIMARY KEY,
      prenom TEXT,
      nom TEXT,
      email TEXT,
      points INTEGER DEFAULT 0,
      reduction INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )
  `);
  // Index secondaire utile si besoin d’email
  await dbc.execute(`CREATE INDEX IF NOT EXISTS idx_cards_email ON cards(email)`);
}

// --- Helpers généraux
function absoluteBaseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function requireAdmin(req, res, next) {
  const tok = req.headers['x-admin-token'];
  if (!tok || tok !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'unauthorized-admin' });
  }
  next();
}

function nowIso() {
  return new Date().toISOString();
}

// Remplace {{PLACEHOLDER}} dans le template
function replaceTokens(html, map) {
  let out = html;
  for (const [k, v] of Object.entries(map)) {
    const re = new RegExp(`{{\\s*${k}\\s*}}`, 'g');
    out = out.replace(re, v == null ? '' : String(v));
  }
  return out;
}

// Charge template.html ou fallback minimal
function loadTemplate() {
  try {
    return fs.readFileSync(TEMPLATE_FILE, 'utf8');
  } catch {
    // Fallback si le fichier n’existe pas
    return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
  <title>Carte {{CODE}}</title>
  <link rel="manifest" href="/manifest.webmanifest">
  <meta name="theme-color" content="#0d9488">
  <link rel="apple-touch-icon" href="/static/icon-192.png">
  <style>
    :root { color-scheme: light dark; }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0 auto; padding: 24px; max-width: 640px; }
    .card { border: 1px solid #e5e7eb22; border-radius: 12px; padding: 20px; backdrop-filter: blur(4px); }
    h1 { font-size: 20px; margin: 0 0 12px; }
    .row { display: flex; gap: 16px; align-items: center; }
    .kpi { background: #0d948833; border-radius: 10px; padding: 12px 14px; }
    .muted { color: #6b7280; font-size: 13px; }
    .barcode { margin-top: 16px; }
    button { padding: 10px 14px; border-radius: 10px; border: 0; background: #0d9488; color: white; font-weight: 600; }
    .actions { display:flex; gap:10px; margin-top:14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Carte fidélité — {{PRENOM}} {{NOM}}</h1>
    <div class="muted">Code: <strong id="code">{{CODE}}</strong></div>
    <div class="row" style="margin-top:10px;">
      <div class="kpi">Points: <strong id="points">{{POINTS}}</strong></div>
      <div class="kpi">Réduction: <strong id="reduction">{{REDUCTION}}</strong></div>
    </div>
    <div class="barcode">
      <img alt="code-barres" id="barcode" src="/barcode/{{CODE}}.png" width="320" height="80" />
    </div>
    <div class="actions">
      <button id="refresh">Rafraîchir</button>
      <button id="install" style="display:none;">Installer</button>
    </div>
    <p class="muted" id="status"></p>
  </div>

  <script>
  // Enregistrement SW
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(console.error);
    });
  }
  // PWA install prompt
  let deferred;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; const b = document.getElementById('install'); b.style.display = 'inline-block'; b.onclick = async () => { if (deferred) { deferred.prompt(); deferred = null; b.style.display='none'; } }; });

  // Rafraîchir depuis /api/card/:code quand le réseau revient
  const code = document.getElementById('code').textContent.trim();
  document.getElementById('refresh').addEventListener('click', fetchCard);
  async function fetchCard() {
    const s = document.getElementById('status');
    try {
      s.textContent = 'Mise à jour…';
      const r = await fetch('/api/card/' + encodeURIComponent(code), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      document.getElementById('points').textContent = data.points ?? 0;
      document.getElementById('reduction').textContent = data.reduction ?? 0;
      s.textContent = 'À jour (' + new Date().toLocaleString() + ')';
    } catch(e) {
      s.textContent = 'Hors-ligne ou erreur réseau';
    }
  }
  </script>
</body>
</html>`;
  }
}

// --- EMAIL — transport multi-fournisseurs + debug
function currentMailProvider() {
  if (process.env.SENDGRID_API_KEY) return 'sendgrid';
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.MAILGUN_KEY && process.env.MAILGUN_DOMAIN) return 'mailgun';
  if (process.env.BREVO_API_KEY) return 'brevo';
  return 'smtp';
}

function createSmtpTransport() {
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    logger: true,
    debug: true
  });
}

function serializeMailError(e) {
  const out = {
    name: e?.name, message: e?.message, code: e?.code,
    responseCode: e?.responseCode, command: e?.command
  };
  if (e?.response) out.response = String(e.response).slice(0, 2000);
  if (e?.stack) out.stack = String(e.stack).split('\n').slice(0, 6).join('\n');
  return out;
}

async function httpError(provider, r) {
  const text = await r.text().catch(() => '');
  const err = new Error(`${provider} HTTP ${r.status} ${r.statusText}`);
  err.code = r.status;
  err.response = text.slice(0, 2000);
  return err;
}

async function sendEmail({ to, subject, html, text }) {
  const provider = currentMailProvider();
  try {
    if (provider === 'smtp') {
      const t = createSmtpTransport();
      const info = await t.sendMail({ from: process.env.SMTP_FROM, to, subject, html, text });
      return { ok: true, id: info.messageId, provider };
    }
    if (provider === 'sendgrid') {
      const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: process.env.SMTP_FROM },
          subject,
          content: [{ type: 'text/html', value: html }]
        })
      });
      if (!r.ok) throw await httpError('sendgrid', r);
      return { ok: true, id: r.headers.get('x-message-id') || null, provider };
    }
    if (provider === 'resend') {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.SMTP_FROM, to, subject, html })
      });
      if (!r.ok) throw await httpError('resend', r);
      const data = await r.json().catch(() => ({}));
      return { ok: true, id: data?.id || null, provider };
    }
    if (provider === 'mailgun') {
      const mgDomain = process.env.MAILGUN_DOMAIN;
      const auth = Buffer.from(`api:${process.env.MAILGUN_KEY}`).toString('base64');
      const base = process.env.MAILGUN_BASE || 'https://api.mailgun.net';
      const r = await fetch(`${base}/v3/${mgDomain}/messages`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}` },
        body: new URLSearchParams({ from: process.env.SMTP_FROM, to, subject, html })
      });
      if (!r.ok) throw await httpError('mailgun', r);
      const data = await r.json().catch(() => ({}));
      return { ok: true, id: data?.id || null, provider };
    }
    if (provider === 'brevo') {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: { email: process.env.SMTP_FROM }, to: [{ email: to }], subject, htmlContent: html })
      });
      if (!r.ok) throw await httpError('brevo', r);
      const data = await r.json().catch(() => ({}));
      return { ok: true, id: data?.messageId || data?.messageIds?.[0] || null, provider };
    }
    throw new Error('no-mail-provider');
  } catch (e) {
    return { ok: false, provider, error: serializeMailError(e) };
  }
}

// --- Routes simples
app.get('/', (_req, res) => res.type('text/plain').send('OK'));

// --- Page carte /c/:code (rend le template + injection des données)
app.get('/c/:code', async (req, res) => {
  try {
    const code = req.params.code;
    const dbc = await getDb();
    const r = await dbc.execute({ sql: 'SELECT * FROM cards WHERE code=?', args: [code] });
    const card = r.rows[0] || { code, prenom: '', nom: '', points: 0, reduction: 0 };

    const html = replaceTokens(loadTemplate(), {
      CODE: card.code,
      PRENOM: card.prenom || '',
      NOM: card.nom || '',
      POINTS: card.points ?? 0,
      REDUCTION: card.reduction ?? 0
    });
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(html);
  } catch (e) {
    console.error('GET /c error', e);
    res.status(500).send('Erreur serveur');
  }
});

// --- API JSON Cartes
app.get('/api/card/:code', async (req, res) => {
  try {
    const dbc = await getDb();
    const r = await dbc.execute({ sql: 'SELECT * FROM cards WHERE code=?', args: [req.params.code] });
    if (!r.rows.length) return res.status(404).json({ error: 'card-not-found' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'db-error', detail: String(e.message || e) });
  }
});

// Création (ou upsert) — protégé admin
app.post('/api/create-card', requireAdmin, async (req, res) => {
  try {
    const { code, prenom, nom, email, points = 0, reduction = 0 } = req.body || {};
    if (!code) return res.status(400).json({ error: 'missing-code' });
    const dbc = await getDb();
    await dbc.execute({
      sql: `INSERT INTO cards(code, prenom, nom, email, points, reduction, created_at, updated_at)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(code) DO UPDATE SET prenom=excluded.prenom, nom=excluded.nom, email=excluded.email,
                points=excluded.points, reduction=excluded.reduction, updated_at=excluded.updated_at`,
      args: [code, prenom || '', nom || '', email || '', points, reduction, nowIso(), nowIso()]
    });
    const r = await dbc.execute({ sql: 'SELECT * FROM cards WHERE code=?', args: [code] });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'db-error', detail: String(e.message || e) });
  }
});

// Mise à jour champs (points, reduction, nom, etc.) — protégé admin
app.post('/api/update-card', requireAdmin, async (req, res) => {
  try {
    const { code, ...fields } = req.body || {};
    if (!code) return res.status(400).json({ error: 'missing-code' });
    const allowed = ['prenom', 'nom', 'email', 'points', 'reduction'];
    const set = [];
    const args = [];
    for (const k of allowed) {
      if (k in fields) { set.push(`${k}=?`); args.push(fields[k]); }
    }
    if (!set.length) return res.status(400).json({ error: 'no-updatable-fields' });
    set.push('updated_at=?'); args.push(nowIso());
    args.push(code);
    const dbc = await getDb();
    await dbc.execute({ sql: `UPDATE cards SET ${set.join(', ')} WHERE code=?`, args });
    const r = await dbc.execute({ sql: 'SELECT * FROM cards WHERE code=?', args: [code] });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'db-error', detail: String(e.message || e) });
  }
});

// Envoi de mail avec lien carte
app.post('/api/send-card', async (req, res) => {
  try {
    const { to, code } = req.body || {};
    if (!to || !code) return res.status(400).json({ error: 'missing-to-or-code' });

    const dbc = await getDb();
    const r = await dbc.execute({ sql: 'SELECT * FROM cards WHERE code=?', args: [code] });
    if (!r.rows.length) return res.status(404).json({ error: 'card-not-found' });
    const card = r.rows[0];

    const base = absoluteBaseUrl(req);
    const link = `${base}/c/${encodeURIComponent(code)}`;
    const html = `
      <p>Bonjour ${card.prenom || ''} ${card.nom || ''},</p>
      <p>Voici votre carte fidélité: <a href="${link}">${link}</a></p>
      <p>Points: <strong>${card.points ?? 0}</strong> — Réduction: <strong>${card.reduction ?? 0}</strong></p>
    `;

    const sent = await sendEmail({ to, subject: `Votre carte fidélité (${card.code})`, html });
    if (!sent.ok) return res.status(502).json({ error: 'mail-send-failed', detail: sent });
    res.json({ ok: true, messageId: sent.id, provider: sent.provider });
  } catch (e) {
    res.status(500).json({ error: 'send-failed', detail: serializeMailError(e) });
  }
});

// Debug email: vérification auth (protégé)
app.get('/api/_mail-verify', requireAdmin, async (_req, res) => {
  const provider = currentMailProvider();
  try {
    if (provider === 'smtp') {
      const t = createSmtpTransport();
      const ok = await t.verify().then(() => true).catch(() => false);
      return res.json({
        ok, provider,
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || Number(process.env.SMTP_PORT || 587) === 465,
        userDefined: !!process.env.SMTP_USER
      });
    }
    const info = { ok: true, provider };
    if (provider === 'sendgrid') info.keyLooksValid = /^SG\./.test(process.env.SENDGRID_API_KEY || '');
    if (provider === 'resend')   info.keyLooksValid = /^re_/.test(process.env.RESEND_API_KEY || '');
    if (provider === 'mailgun')  info.keyLooksValid = /^key-/.test(process.env.MAILGUN_KEY || '');
    if (provider === 'brevo')    info.keyLooksValid = /^xkeysib-/.test(process.env.BREVO_API_KEY || '');
    return res.json(info);
  } catch (e) {
    return res.status(500).json({ ok: false, provider, error: serializeMailError(e) });
  }
});

// Debug email: envoi test (protégé)
app.post('/api/_mail-test', requireAdmin, async (req, res) => {
  const { to, subject, html, text } = req.body || {};
  if (!to) return res.status(400).json({ error: 'missing-to' });
  const out = await sendEmail({ to, subject: subject || 'Test', html: html || '<p>Test</p>', text });
  if (!out.ok) return res.status(502).json(out);
  res.json(out);
});

// --- Codes-barres PNG
app.get(['/barcode/:code.png', '/barcode/:code'], async (req, res) => {
  try {
    const code = req.params.code;
    const png = await bwipjs.toBuffer({
      bcid: 'code128', text: code,
      scale: Number(req.query.scale || 3),
      height: Number(req.query.height || 12), // mm -> bwipjs unit
      includetext: true, textxalign: 'center', textsize: 10
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(png);
  } catch (e) {
    res.status(500).type('text/plain').send('barcode-error');
  }
});

// --- Manifest PWA
app.get('/manifest.webmanifest', (req, res) => {
  const base = absoluteBaseUrl(req);
  const manifest = {
    name: 'Carte Fidélité',
    short_name: 'Carte',
    start_url: '/c/DEMO',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0d9488',
    icons: [
      { src: base + '/static/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: base + '/static/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
    ]
  };
  res.type('application/manifest+json').send(JSON.stringify(manifest, null, 2));
});

// --- Service Worker (cache offline)
app.get('/sw.js', (_req, res) => {
  const version = Date.now().toString(36);
  const sw = `/* Service Worker v${version} */
const CACHE = 'cfid-${version}';
const OFFLINE_URLS = [
  '/', '/manifest.webmanifest',
  '/static/icon-192.png', '/static/icon-512.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(OFFLINE_URLS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await clients.claim();
  })());
});

// Stratégie: réseau d'abord pour /api/, cache d'abord pour static, cache avec MAJ pour /c/
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  if (url.pathname.startsWith('/static/') || url.pathname.startsWith('/barcode/')) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return resp;
    })));
    return;
  }
  if (url.pathname.startsWith('/c/')) {
    e.respondWith((async () => {
      try {
        const net = await fetch(e.request);
        const copy = net.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return net;
      } catch {
        const cached = await caches.match(e.request);
        return cached || new Response('<h1>Hors-ligne</h1>', { headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }
  // défaut
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});`;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(sw);
});

// --- Lancement
initDb().then(() => {
  app.listen(PORT, () => console.log('[Server] Listening on', PORT));
}).catch((e) => {
  console.error('DB init failed:', e);
  process.exit(1);
});
