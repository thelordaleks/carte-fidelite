// server.js — Version rollback (zéro changement visuel)
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');
const bwipjs = require('bwip-js');
const nodemailer = require('nodemailer');
dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(morgan('dev'));
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use('/app', express.static(path.join(__dirname, 'public/app')));

// === ENV ===
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || process.env.SECRET || '';
const TEMPLATE_FILE = process.env.TEMPLATE_FILE || path.join(__dirname, 'template.html');
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL.replace(/\/+$/,'') : '';
const PORT = process.env.PORT || 3000;

// SMTP (inchangé, classique)
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
function readFileOrFallback(file, fallback='') {
  try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; }
}
function replaceTokens(html, data, baseUrl) {
  // On ne touche PAS au style/HTML du template.
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
    // Jetons stricts uniquement → pas d’écrasement sauvage.
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
    host: SMTP.host, port: SMTP.port, secure: SMTP.port === 465,
    auth: { user: SMTP.user, pass: SMTP.pass }
  });
}

// === Utils ===
function genCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  let out = 'ADH';
  for (let i=0;i<8;i++) out += alphabet[Math.floor(Math.random()*alphabet.length)];
  return out;
}
function toIntOrUndef(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.round(n));
}

// === Routes API ===
app.post('/api/create-card', async (req, res) => {
  try {
    let { code, nom='', prenom='', email, mail, reduction='', points } = req.body || {};
    email = (email || mail || '').trim();
    code = String(code || genCode()).trim().toUpperCase();

    const pts = toIntOrUndef(points);
    const insertPts = pts === undefined ? 0 : pts;   // 0 par défaut à la création
    const updatePts = pts === undefined ? null : pts; // n’écrase pas si Excel n’envoie pas

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

    const base = absoluteBaseUrl(req);
    res.json({ ok:true, code, url: `${base}/c/${encodeURIComponent(code)}`, points: pts ?? insertPts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'create-failed' });
  }
});

app.get('/api/card/:code', requireAdmin, async (req, res) => {
  try {
    const dbc = await getDb();
    const r = await dbc.execute({ sql: 'SELECT * FROM cards WHERE code=?', args: [req.params.code] });
    res.json(r.rows[0] || {});
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'read-failed' });
  }
});

app.post('/api/card/:code/points', requireAdmin, async (req, res) => {
  try {
    const delta = Number(req.body?.delta || 0);
    const dbc = await getDb();
    const r = await dbc.execute({ sql: 'SELECT points FROM cards WHERE code=?', args: [req.params.code] });
    if (!r.rows.length) return res.status(404).json({ error: 'Carte inconnue' });
    const next = Math.max(0, Number(r.rows[0].points || 0) + delta);
    await dbc.execute({ sql: 'UPDATE cards SET points=? WHERE code=?', args: [next, req.params.code] });
    res.json({ ok:true, points: next });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'update-failed' });
  }
});

// Envoi d’e-mail (HTML simple + lien de la carte + lien vers l'app + Instagram)
app.post('/api/card/:code/send', requireAdmin, async (req, res) => {
  try {
    const dbc = await getDb();
    const r = await dbc.execute({ sql: 'SELECT * FROM cards WHERE code=?', args: [req.params.code] });
    if (!r.rows.length) return res.status(404).json({ error: 'Carte inconnue' });
    const card = r.rows[0];
    const to = (req.body && req.body.to) || card.email;
    if (!to) return res.status(400).json({ error: 'email manquant' });

    const base = absoluteBaseUrl(req);
    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;line-height:1.5;color:#222;">
        <p>Bonjour ${[card.prenom, card.nom].filter(Boolean).join(' ') || ''},</p>
        <p>Voici votre carte fidélité.</p>
        
        <p>
          <a href="${base}/c/${encodeURIComponent(card.code)}"
             style="background:#007bff;color:white;padding:8px 14px;text-decoration:none;border-radius:6px;">
             🎟️ Ouvrir ma carte fidélité
          </a>
        </p>

        <p style="margin-top:12px">
          Code : <strong>${card.code}</strong> — Points : <strong>${card.points || 0}</strong>
        </p>
        
        <img src="${base}/barcode/${encodeURIComponent(card.code)}" alt="Code-barres" style="max-width:280px;">

        <hr style="margin:20px 0;border:none;border-top:1px solid #ddd;">

        <p>📱 Vous pouvez aussi ouvrir votre carte dans l’application mobile :</p>
        <p>
          <a href="${base}/app?code=${encodeURIComponent(card.code)}"
             style="background:#28a745;color:white;padding:8px 14px;text-decoration:none;border-radius:6px;">
             Ouvrir l’application
          </a>
        </p>

        <p>📸 Suivez la MDL sur Instagram :</p>
        <p>
          <a href="https://www.instagram.com/mdl.edouardvaillant"
             style="color:#e4405f;text-decoration:none;font-weight:bold;">
             @mdl.edouardvaillant
          </a>
        </p>
      </div>
    `;

    const transporter = createTransporter();
    const info = await transporter.sendMail({
      from: SMTP.from,
      to,
      subject: `Votre carte fidélité (${card.code})`,
      html
    });
    res.json({ ok: true, messageId: info.messageId });
  } catch (e) {
    console.error('send mail failed:', e);
    res.status(500).json({ error: 'send-failed', detail: String(e.message || e) });
  }
});


// === Rendu de la carte: TON template inchangé ===
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

// Code‑barres (visuel strict, pas de texte ajouté)
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
// === Génération de carte Wallet (.pkpass) ===

const { PKPass } = require("passkit-generator");


app.get('/wallet/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const dbc = await getDb();
    const r = await dbc.execute({ sql: 'SELECT * FROM cards WHERE code=?', args: [code] });
    if (!r.rows.length) return res.status(404).send('Carte inconnue');

    const card = r.rows[0];

    // Chemins des certificats
    const certPath = path.join(process.cwd(), 'certs');
    const wwdr = fs.readFileSync(path.join(certPath, 'WWDR.pem'));
    const signerCert = fs.readFileSync(path.join(certPath, 'signerCert.pem'));
    const signerKey = fs.readFileSync(path.join(certPath, 'signerKey.pem'));

    // Génération du pass
    const pass = new PKPass({
      model: path.join(process.cwd(), 'wallet-model'),
      certificates: {
        wwdr,
        signerCert,
        signerKey,
        signerKeyPassphrase: process.env.WALLET_KEY_PASS || ''
      },
      overrides: {
        serialNumber: card.code,
        description: "Carte fidélité MDL",
        organizationName: "MDL Édouard Vaillant",
        logoText: `${card.prenom} ${card.nom}`,
        foregroundColor: "rgb(255,255,255)",
        backgroundColor: "rgb(0,120,215)",
        labelColor: "rgb(255,255,255)",
        storeCard: {
          primaryFields: [{ key: "points", label: "Points", value: String(card.points || 0) }],
          secondaryFields: [{ key: "nom", label: "Adhérent", value: `${card.prenom} ${card.nom}` }],
          auxiliaryFields: [{ key: "reduction", label: "Réduction", value: card.reduction || "—" }]
        }
      }
    });

    const buffer = await pass.asBuffer();
    res.type('application/vnd.apple.pkpass');
    res.send(buffer);
  } catch (err) {
    console.error('Erreur Wallet:', err);
    res.status(500).send('Erreur génération Wallet');
  }
});
// === Code-barres (visuel strict, pas de texte ajouté)
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


// === Carte Wallet universelle (Android + iPhone)
app.get('/wallet-universel/:code', async (req, res) => { 
  try {
    const { code } = req.params;
    const dbc = await getDb();
    const r = await dbc.execute({ sql: 'SELECT * FROM cards WHERE code=?', args: [code] });
    if (!r.rows.length) return res.status(404).send('Carte inconnue');
    const card = r.rows[0];

    // Format universel type "Google Wallet JSON"
    const data = {
      issuerName: "MDL Édouard Vaillant",
      programName: "Carte fidélité MDL",
      accountId: card.code,
      accountName: `${card.prenom} ${card.nom}`,
      points: card.points || 0,
      reduction: card.reduction || "—",
      logo: `${absoluteBaseUrl(req)}/static/logo-mdl.png`,
      backgroundColor: "#0078D7",
      textColor: "#FFFFFF",
      barcode: `${absoluteBaseUrl(req)}/barcode/${encodeURIComponent(card.code)}`
    };

    res.setHeader('Content-Disposition', `attachment; filename="MDL-${card.code}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(e);
    res.status(500).send('Erreur génération Wallet universel');
  }
});
// === Carte Wallet (.pkpass) simple et non signée ===
const { PKPass } = require("passkit-generator");


app.get('/wallet/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const dbc = await getDb();
    const r = await dbc.execute({ sql: 'SELECT * FROM cards WHERE code=?', args: [code] });
    if (!r.rows.length) return res.status(404).send('Carte inconnue');
    const card = r.rows[0];

    const modelPath = path.join(process.cwd(), "wallet-model");

    // Crée la carte .pkpass (sans signature)
    const pass = await PKPass.from(
      modelPath,
      {
        points: String(card.points || 0),
        adh: `${card.prenom} ${card.nom}`,
        serialNumber: card.code,
        barcode: {
          format: "PKBarcodeFormatCode128",
          message: card.code,
          messageEncoding: "utf-8"
        }
      }
    );

    // en-têtes HTTP
    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', `attachment; filename="MDL-${card.code}.pkpass"`);
    res.send(await pass.asBuffer());
  } catch (e) {
    console.error("Erreur .pkpass:", e);
    res.status(500).send("Erreur génération .pkpass");
  }
});


// === Lancement du serveur
initDb().then(() => {
  app.listen(PORT, () => console.log('Listening on', PORT));
}).catch((e) => {
  console.error('DB init failed:', e); process.exit(1);
});

