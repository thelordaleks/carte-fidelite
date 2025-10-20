// server.js — version stable avec .pkpass non signé (archive ZIP manuelle)
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');
const bwipjs = require('bwip-js');
const nodemailer = require('nodemailer');
const archiver = require('archiver'); // pour créer les fichiers .pkpass (zip)
dotenv.config();

const app = express();
app.disable('etag');
app.use(express.json());
app.use(cors());
app.use(morgan('dev'));
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use('/app', express.static(path.join(__dirname, 'public/app')));
app.use(express.static(path.join(__dirname, 'public')));

// === ENV ===
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || process.env.SECRET || '';
const TEMPLATE_FILE = process.env.TEMPLATE_FILE || path.join(__dirname, 'template.html');
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL.replace(/\/+$/, '') : '';
const PORT = process.env.PORT || 10000;

// === SMTP config ===
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
      reduction TEXT,
      points INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

// === Helpers ===
function absoluteBaseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
function readFileOrFallback(file, fallback = '') {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}
function replaceTokens(html, data, baseUrl) {
  const fullName = [data.prenom, data.nom].filter(Boolean).join(' ').trim();
  const map = {
    NOM: data.nom || '',
    PRENOM: data.prenom || '',
    FULLNAME: fullName,
    EMAIL: data.email || '',
    POINTS: String(data.points ?? 0),
    CODE: data.code || '',
    REDUCTION: data.reduction || '',
    BARCODE_URL: `${baseUrl}/barcode/${encodeURIComponent(data.code || '')}`,
    CARD_URL: `${baseUrl}/c/${encodeURIComponent(data.code || '')}`,
  };
  let out = String(html || '');
  for (const [k, v] of Object.entries(map)) {
    const patterns = [
      new RegExp(`{{\\s*${k}\\s*}}`, 'g'),
      new RegExp(`%%${k}%%`, 'g'),
      new RegExp(`\\[\\[\\s*${k}\\s*\\]\\]`, 'g'),
      new RegExp(`__${k}__`, 'g'),
      new RegExp(`\\$\\{\\s*${k}\\s*\\}`, 'g')
    ];
    for (const p of patterns) out = out.replace(p, v);
  }
  return out;
}
function requireAdmin(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!ADMIN_TOKEN) return res.status(500).json({ error: 'ADMIN_TOKEN manquant' });
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  next();
}
function createTransporter() {
  if (!SMTP.host || !SMTP.port || !SMTP.user || !SMTP.pass || !SMTP.from) {
    throw new Error('Config SMTP incomplète (SMTP_HOST/PORT/USER/PASS/FROM)');
  }
  return nodemailer.createTransport({
    host: SMTP.host,
    port: SMTP.port,
    secure: SMTP.port === 465,
    auth: { user: SMTP.user, pass: SMTP.pass }
  });
}

// === Utils ===
function genCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  let out = 'ADH';
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
function toIntOrUndef(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.round(n));
}

// === ROUTES ===

// ✅ Création carte + sauvegarde locale du code
const dataFile = path.join(__dirname, "data", "lastCodes.json");

app.post('/api/create-card', async (req, res) => {
  try {
    let { code, nom = '', prenom = '', email, mail, reduction = '', points } = req.body || {};
    email = (email || mail || '').trim().toLowerCase();
    code = String(code || genCode()).trim().toUpperCase();
    const pts = toIntOrUndef(points);
    const insertPts = pts === undefined ? 0 : pts;
    const updatePts = pts === undefined ? null : pts;
    const dbc = await getDb();
    await dbc.execute({
      sql: `
        INSERT INTO cards(code,nom,prenom,email,reduction,points)
        VALUES(?,?,?,?,?,?)
        ON CONFLICT(code) DO UPDATE SET
          nom=excluded.nom,
          prenom=excluded.prenom,
          email=excluded.email,
          reduction=excluded.reduction,
          points = COALESCE(?, cards.points)
      `,
      args: [code, nom, prenom, email, reduction, insertPts, updatePts]
    });

    // ✅ Sauvegarde JSON locale (pour la PWA)
    try {
      fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
      const dbFile = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile)) : {};
      dbFile[email] = code;
      fs.writeFileSync(dataFile, JSON.stringify(dbFile, null, 2));
    } catch (e) {
      console.error("Erreur enregistrement code", e);
    }

    const base = absoluteBaseUrl(req);
    res.json({ ok: true, code, url: `${base}/c/${encodeURIComponent(code)}`, points: pts ?? insertPts });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'create-failed' });
  }
});

// ✅ Route pour retrouver le dernier code connu
app.get("/api/last/:email", (req, res) => {
  try {
    if (!fs.existsSync(dataFile)) return res.json({});
    const dbFile = JSON.parse(fs.readFileSync(dataFile));
    const email = req.params.email.toLowerCase();
    if (dbFile[email]) return res.json({ code: dbFile[email] });
    res.json({});
  } catch (e) {
    console.error("Erreur lecture lastCodes.json", e);
    res.json({});
  }
});

// Rendu HTML de la carte
app.get('/c/:code', async (req, res) => {
  try {
    const dbc = await getDb();
    const r = await dbc.execute({ sql: 'SELECT * FROM cards WHERE code=?', args: [req.params.code] });
    if (!r.rows.length) return res.status(404).send('Carte inconnue');
    const card = r.rows[0];
    const tpl = readFileOrFallback(TEMPLATE_FILE, '<p>Template introuvable</p>');
    const html = replaceTokens(tpl, card, absoluteBaseUrl(req));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    console.error(e);
    res.status(500).send('render-failed');
  }
});

// Code-barres
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

// API de récupération
app.get('/api/get-card/:code', async (req, res) => {
  try {
    const dbc = await getDb();
    const r = await dbc.execute({ sql: 'SELECT * FROM cards WHERE code=?', args: [req.params.code] });
    if (!r.rows.length) return res.json({ ok: false });
    const c = r.rows[0];
    res.json({
      ok: true,
      fullname: `${c.prenom} ${c.nom}`.trim(),
      points: c.points || 0,
      reduction: c.reduction || "—"
    });
  } catch (e) {
    console.error("Erreur get-card:", e);
    res.status(500).json({ ok: false });
  }
});

// Carte Wallet (ZIP .pkpass)
app.get('/wallet/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const dbc = await getDb();
    const r = await dbc.execute({ sql: 'SELECT * FROM cards WHERE code=?', args: [code] });
    if (!r.rows.length) return res.status(404).send('Carte inconnue');
    const card = r.rows[0];

    const modelPath = path.join(process.cwd(), "wallet-model.pass");
    if (!fs.existsSync(modelPath)) {
      console.error("wallet-model.pass missing:", modelPath);
      return res.status(500).send("Modèle wallet introuvable sur le serveur");
    }

    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', `attachment; filename="MDL-${card.code}.pkpass"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);
    const files = fs.readdirSync(modelPath).filter(f => f[0] !== '.');

    for (const f of files) {
      const full = path.join(modelPath, f);
      if (!fs.statSync(full).isFile()) continue;
      if (f === 'pass.json') continue;
      archive.file(full, { name: f });
    }

    let passObj = {};
    try {
      passObj = JSON.parse(fs.readFileSync(path.join(modelPath, 'pass.json'), 'utf8'));
    } catch { passObj = {}; }

    passObj.serialNumber = card.code;
    passObj.organizationName = passObj.organizationName || "MDL Édouard Vaillant";
    passObj.description = passObj.description || "Carte fidélité MDL";
    passObj.logoText = `${card.prenom} ${card.nom}`;
    passObj.foregroundColor = "rgb(0,0,0)";
    passObj.backgroundColor = "rgb(255, 244, 230)";
    passObj.labelColor = "rgb(120, 80, 30)";
    passObj.icon = "icon.png";
    passObj.icon2x = "icon@2x.png";
    passObj.logo = "logo.png";
    passObj.logo2x = "logo@2x.png";
    passObj.barcode = {
      format: "PKBarcodeFormatCode128",
      message: card.code,
      messageEncoding: "iso-8859-1"
    };
    passObj.barcodes = [passObj.barcode];
    passObj.storeCard = passObj.storeCard || {};
    passObj.storeCard.primaryFields = [{ key: "points", label: "Points", value: String(card.points || 0) }];
    passObj.storeCard.secondaryFields = [{ key: "nom", label: "Adhérent", value: `${card.prenom} ${card.nom}` }];
    passObj.storeCard.auxiliaryFields = [{ key: "reduction", label: "Réduction", value: card.reduction || "—" }];

    archive.append(JSON.stringify(passObj, null, 2), { name: 'pass.json' });
    archive.append('{}', { name: 'manifest.json' });
    archive.append('', { name: 'signature' });
    archive.finalize();

  } catch (e) {
    console.error("Erreur .pkpass:", e);
    res.status(500).send("Erreur génération .pkpass");
  }
});
// === Route spéciale Apple Universal Links ===
// Sert le fichier "apple-app-site-association" sans compression, sans cache et avec le bon type MIME
app.get('/apple-app-site-association', (req, res) => {
  const filePath = path.join(__dirname, 'apple-app-site-association');
  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'apple-app-site-association introuvable' });
    }

    // En-têtes requis par Apple
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Content-Disposition', 'inline'); // pas de téléchargement

    // Lecture et envoi du contenu brut
    const data = fs.readFileSync(filePath, 'utf8');
    res.send(data);

  } catch (e) {
    console.error("Erreur AASA:", e);
    res.status(500).json({ error: 'Erreur lecture apple-app-site-association' });
  }
});


// === Lancement du serveur ===
initDb()
  .then(() => {
    console.log("== Wallet model contents ==");
    try {
      console.log(fs.readdirSync(path.join(process.cwd(), "wallet-model.pass")));
      console.log("pass.json exists:", fs.existsSync(path.join(process.cwd(), "wallet-model.pass", "pass.json")));
    } catch (e) {
      console.warn("wallet-model.pass absent ou illisible:", e.message || e);
    }
    app.listen(PORT, () => console.log('Listening on', PORT));
  })
  .catch(e => {
    console.error('DB init failed:', e);
    process.exit(1);
  });
