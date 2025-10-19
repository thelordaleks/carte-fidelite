// server.js — compat legacy (SECRET, TEMPLATE_FILE) + Turso
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');
const bwipjs = require('bwip-js');
dotenv.config();

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || process.env.SECRET || '';
const TEMPLATE_FILE = process.env.TEMPLATE_FILE || path.join(__dirname, 'template.html');
const PORT = process.env.PORT || 3000;

// Turso client (ESM -> import dynamique)
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
      reduction TEXT,
      points INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function readTemplate() {
  try {
    return fs.readFileSync(TEMPLATE_FILE, 'utf8');
  } catch (e) {
    console.error('Template introuvable:', TEMPLATE_FILE, e);
    return '<h1>Template manquant</h1>';
  }
}

function absoluteBaseUrl(req) {
  // déduit automatiquement https://hote
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function renderTemplate(rawTpl, data, baseUrl) {
  // valeurs par défaut
  const fullName = [data.prenom, data.nom].filter(Boolean).join(' ').trim();
  const mapping = {
    NOM: data.nom || '',
    PRENOM: data.prenom || '',
    FULLNAME: fullName,
    EMAIL: data.email || '',
    POINTS: String(data.points ?? 0),
    CODE: data.code || '',
    REDUCTION: data.reduction || '',
    BARCODE_URL: `${baseUrl}/barcode/${encodeURIComponent(data.code)}`,
  };

  let out = rawTpl;
  // Remplacement strict: {{ KEY }} et %%KEY%%
  for (const [k, v] of Object.entries(mapping)) {
    const mustache = new RegExp(`{{\\s*${k}\\s*}}`, 'g'); // {{ KEY }}
    const percent = new RegExp(`%%${k}%%`, 'g');          // %%KEY%%
    out = out.replace(mustache, v).replace(percent, v);
  }
  return out;
}

function requireAdmin(req, res, next) {
  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!ADMIN_TOKEN) return res.status(500).json({ error: 'ADMIN/SECRET non défini' });
  if (tok !== ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  return next();
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));
app.use('/static', express.static(path.join(__dirname, 'static')));

// Créer une carte
app.post('/api/create-card', async (req, res) => {
  try {
    const { nom = '', prenom = '', email = '', reduction = '' } = req.body || {};
    const code = 'ADH' + Math.random().toString(36).slice(2, 10);
    const dbc = await getDb();
    await dbc.execute({
      sql: 'INSERT INTO cards(code, nom, prenom, email, reduction, points) VALUES(?,?,?,?,?,0)',
      args: [code, nom, prenom, email, reduction],
    });
    res.json({ ok: true, code });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'create-card failed' });
  }
});

// Lire une carte (JSON)
app.get('/api/card/:code', async (req, res) => {
  try {
    const dbc = await getDb();
    const r = await dbc.execute({ sql: 'SELECT * FROM cards WHERE code=?', args: [req.params.code] });
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'get-card failed' });
  }
});

// Mettre à jour points
app.post('/api/card/:code/points', requireAdmin, async (req, res) => {
  try {
    const { delta, set } = req.body || {};
    const dbc = await getDb();
    if (typeof set === 'number') {
      await dbc.execute({ sql: 'UPDATE cards SET points=? WHERE code=?', args: [set, req.params.code] });
    } else if (typeof delta === 'number') {
      await dbc.execute({ sql: 'UPDATE cards SET points = points + ? WHERE code=?', args: [delta, req.params.code] });
    } else {
      return res.status(400).json({ error: 'delta ou set requis' });
    }
    const r = await dbc.execute({ sql: 'SELECT * FROM cards WHERE code=?', args: [req.params.code] });
    res.json(r.rows[0] || {});
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'update-points failed' });
  }
});

// Page HTML de la carte = TON template + remplacements
app.get('/c/:code', async (req, res) => {
  try {
    const dbc = await getDb();
    const r = await dbc.execute({ sql: 'SELECT * FROM cards WHERE code=?', args: [req.params.code] });
    if (!r.rows.length) return res.status(404).send('Carte inconnue');
    const card = r.rows[0];
    const tpl = readTemplate();
    const html = renderTemplate(tpl, card, absoluteBaseUrl(req));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    console.error(e);
    res.status(500).send('render failed');
  }
});

// Code‑barres PNG
app.get('/barcode/:txt', async (req, res) => {
  try {
    const png = await bwipjs.toBuffer({
      bcid: 'code128',
      text: req.params.txt,
      scale: 3,
      height: 12,
      includetext: false,
      backgroundcolor: 'FFFFFF',
    });
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  } catch (e) {
    res.status(400).send('bad barcode');
  }
});

initDb()
  .then(() => app.listen(PORT, () => console.log('Listening on', PORT)))
  .catch((e) => { console.error('DB init failed:', e); process.exit(1); });
