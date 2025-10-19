// server.js
// Service carte fidélité avec lien court, rendu template 100% custom, et code-barres.
// Déploiement: fonctionne tel quel sur Render. Tu n'as qu'à définir SECRET.

require('dotenv').config();

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const morgan = require('morgan');
const bwipjs = require('bwip-js');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const app = express();

// ---------- Config ----------
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET || ''; // DOIT être défini en prod
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DEFAULT_TEMPLATE_FILE = path.join(__dirname, 'static', 'template.html');
const TEMPLATE_FILE = process.env.TEMPLATE_FILE || DEFAULT_TEMPLATE_FILE;

// Crée DATA_DIR si besoin
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// DB pour les liens courts (persistance nécessaire pour que les e-mails restent valides)
const DB_FILE = path.join(DATA_DIR, 'db.sqlite3');
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS short_links (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_short_links_created_at ON short_links(created_at);
`);

// ---------- Middlewares ----------
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));
app.use('/static', express.static(path.join(__dirname, 'static'), { fallthrough: true }));

// ---------- Utils ----------
function makeBaseUrl(req) {
  // Sur Render: RENDER_EXTERNAL_HOSTNAME est défini.
  const host = process.env.RENDER_EXTERNAL_HOSTNAME || req.headers['x-forwarded-host'] || req.headers.host;
  const proto = (req.headers['x-forwarded-proto'] || '').includes('https') ? 'https' : 'https';
  return `${proto}://${host}`;
}

function signCard(payload, days = 365) {
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = nowSec + days * 24 * 60 * 60;
  const claims = {
    sub: 'card',
    iat: nowSec,
    exp,
    ...payload
  };
  return jwt.sign(claims, SECRET, { algorithm: 'HS256' });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET, { algorithms: ['HS256'] });
}

async function loadTemplate() {
  try {
    return await fsp.readFile(TEMPLATE_FILE, 'utf8');
  } catch (e) {
    return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Template manquant</title><h1>Template introuvable</h1><p>Place ton HTML dans static/template.html ou indique TEMPLATE_FILE.</p>';
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatEuroCents(cents) {
  const n = Number.isFinite(+cents) ? +cents : 0;
  const euros = n / 100;
  return euros.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function buildTemplateData(claims, req) {
  const base = makeBaseUrl(req);
  const code = claims.code || '';
  const reduction_cents = Number.isFinite(+claims.reduction_cents) ? +claims.reduction_cents : 0;
  const points = claims.points ?? '';

  const data = {
    prenom: claims.prenom ?? '',
    nom: claims.nom ?? '',
    email: claims.email ?? '',
    code,
    points: String(points),
    reduction_cents: String(reduction_cents),
    reduction_euros: formatEuroCents(reduction_cents),
    fullname: `${(claims.prenom || '').trim()} ${(claims.nom || '').trim()}`.trim(),
    // URL vers PNG code128 généré côté serveur
    barcode_url: `${base}/barcode?text=${encodeURIComponent(code)}&scale=3&height=60&margin=0`,
    // Quelques infos utiles
    service_base_url: base,
    now_iso: new Date().toISOString()
  };

  // Ajoute tous les autres champs libres que tu pourrais envoyer (ex: magasin, tier, etc.)
  for (const [k, v] of Object.entries(claims)) {
    if (data[k] === undefined) data[k] = String(v);
  }

  return data;
}

function renderWithPlaceholders(template, data) {
  // Remplacement insensible à la casse sur {{cle}}
  let out = template;
  for (const [key, val] of Object.entries(data)) {
    const re = new RegExp(`{{\\s*${escapeRegex(key)}\\s*}}`, 'gi');
    out = out.replace(re, String(val ?? ''));
  }
  // Placeholders non renseignés -> vides
  out = out.replace(/{{\s*[a-z0-9_.-]+\s*}}/gi, '');
  return out;
}

function createShortLink(token) {
  const id = crypto.randomBytes(5).toString('hex'); // 10 hexa
  db.prepare('INSERT INTO short_links (id, token, created_at) VALUES (?, ?, ?)').run(id, token, Date.now());
  return id;
}

// ---------- Routes ----------

// Santé/diagnostic
app.get('/_diag', async (req, res) => {
  let templateExists = false;
  try { await fsp.access(TEMPLATE_FILE); templateExists = true; } catch {}
  const row = db.prepare('SELECT COUNT(*) as c FROM short_links').get();
  res.json({
    ok: true,
    now: new Date().toISOString(),
    has_secret: Boolean(SECRET && SECRET.length >= 16),
    render_host: process.env.RENDER_EXTERNAL_HOSTNAME || null,
    template_file: TEMPLATE_FILE,
    template_exists: templateExists,
    data_dir: DATA_DIR,
    short_links_count: row.c
  });
});

// Génération code-barres PNG (Code 128)
app.get('/barcode', async (req, res) => {
  try {
    const text = String(req.query.text || '');
    const scale = Math.max(1, Math.min(8, parseInt(req.query.scale || '3', 10)));
    const height = Math.max(20, Math.min(100, parseInt(req.query.height || '60', 10)));
    const margin = Math.max(0, Math.min(20, parseInt(req.query.margin || '0', 10)));
    const includetext = String(req.query.includetext || 'false') === 'true';

    if (!text) {
      return res.status(400).send('Paramètre "text" requis.');
    }

    const png = await bwipjs.toBuffer({
      bcid: 'code128',
      text,
      scale,
      height,
      includetext,
      textxalign: 'center',
      paddingwidth: margin,
      paddingheight: margin
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(png);
  } catch (err) {
    res.status(500).send('Erreur génération code-barres');
  }
});

// Fabrique un JWT + lien court
function makeLinks(req, payload) {
  const base = makeBaseUrl(req);
  const token = signCard(payload, 365);
  const longUrl = `${base}/card/t/${encodeURIComponent(token)}`;
  const shortId = createShortLink(token);
  const shortUrl = `${base}/u/${shortId}`;
  return { token, url: longUrl, short_url: shortUrl };
}

// API: création de carte (utilise le body tel quel)
app.post('/api/create-card', (req, res) => {
  if (!SECRET) {
    return res.status(500).json({ ok: false, error: 'SECRET manquant côté serveur.' });
  }
  const {
    prenom = '',
    nom = '',
    email = '',
    code = '',
    points = '',
    reduction_cents = 0,
    // champs libres additionnels acceptés...
    ...rest
  } = req.body || {};

  if (!code) {
    return res.status(400).json({ ok: false, error: 'Le champ "code" est requis.' });
  }

  const payload = { prenom, nom, email, code, points, reduction_cents, ...rest };
  const links = makeLinks(req, payload);
  return res.json({ ok: true, ...links });
});

// API: retrouver par code (compatible avec tes usages existants)
// Si tu n'as pas de base "cartes", on régénère juste un token à partir du code et champs fournis.
app.post('/api/find-by-code', (req, res) => {
  if (!SECRET) {
    return res.status(500).json({ ok: false, error: 'SECRET manquant côté serveur.' });
  }
  const { code = '', ...rest } = req.body || {};
  if (!code) {
    return res.status(400).json({ ok: false, error: 'Le champ "code" est requis.' });
  }
  const payload = { code, ...rest };
  const links = makeLinks(req, payload);
  return res.json({ ok: true, ...links });
});

// Lien court -> redirection 302 vers /card/t/<JWT>
app.get('/u/:id', (req, res) => {
  const row = db.prepare('SELECT token FROM short_links WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).send('Lien inconnu.');
  const base = makeBaseUrl(req);
  const dest = `${base}/card/t/${encodeURIComponent(row.token)}`;
  res.redirect(302, dest);
});

// Affichage carte par TOKEN (nouveau)
app.get('/card/t/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const claims = verifyToken(token);
    const template = await loadTemplate();
    const data = buildTemplateData(claims, req);
    const html = renderWithPlaceholders(template, data);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(400).send('<!doctype html><meta charset="utf-8"><title>Token invalide</title><h1>Token invalide ou expiré</h1>');
  }
});

// Compat: /card/:id -> traite id comme un token (ancien lien)
app.get('/card/:id', async (req, res) => {
  req.params.token = req.params.id;
  return app._router.handle({ ...req, url: `/card/t/${encodeURIComponent(req.params.id)}`, method: 'GET' }, res, () => {});
});

// Home (optionnel)
app.get('/', (req, res) => {
  res.type('text').send('OK - Service carte. Voir /_diag');
});

// Démarrage
app.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});
