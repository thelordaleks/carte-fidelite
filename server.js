// server.js — minimal, compatible avec ton VBA actuel
require('dotenv').config();

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const bwipjs = require('bwip-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Dossier writable sur Render (éphémère, mais OK)
const DATA_DIR = process.env.DATA_DIR || '/tmp/carte-fidelite';
fs.mkdirSync(DATA_DIR, { recursive: true });
console.log('DATA_DIR:', DATA_DIR);

// Fichiers statiques (images + template)
const STATIC_DIR = path.join(__dirname, 'static');
const TEMPLATE_FILE = process.env.TEMPLATE_FILE || path.join(STATIC_DIR, 'template.html');

// Middlewares
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));
app.use('/static', express.static(STATIC_DIR));

// Santé
app.get('/health', (req, res) => res.json({ ok: true }));

// Utilitaires
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}
function safeId(s) {
  // ID basé sur le code: lettres/chiffres/_/- uniquement
  return String(s || '').trim().replace(/[^a-zA-Z0-9_\-]/g, '');
}
async function saveRecord(rec) {
  const id = safeId(rec.id);
  const file = path.join(DATA_DIR, `${id}.json`);
  await fsp.writeFile(file, JSON.stringify(rec, null, 2), 'utf8');
}
function loadRecord(id) {
  const sid = safeId(id);
  const file = path.join(DATA_DIR, `${sid}.json`);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}
function loadTemplate() {
  try { return fs.readFileSync(TEMPLATE_FILE, 'utf8'); }
  catch (e) {
    console.warn('Template introuvable, utilisation d’un fallback simple.');
    return `<!doctype html><html><body><h1>Carte</h1><div>{{PRENOM}} {{NOM}} — {{CODE}}</div><img src="{{BARCODE_URL}}"></body></html>`;
  }
}

// Route appelée par Excel
app.post('/api/create-card', async (req, res) => {
  try {
    const { nom, prenom, email, code, points, reduction } = req.body || {};

    if (!email)   return res.status(400).json({ error: 'email_required' });
    if (!code)    return res.status(400).json({ error: 'code_required' });

    const id = safeId(code);
    const now = new Date().toISOString();

    const record = {
      id,
      nom: String(nom || ''),
      prenom: String(prenom || ''),
      email: String(email || ''),
      code: String(code || ''),
      points: String(points || ''),
      reduction: String(reduction || ''),
      created_at: now,
      updated_at: now
    };

    await saveRecord(record);

    const url = `${baseUrl(req)}/c/${encodeURIComponent(id)}`;
    // Ton VBA lit "url" (ou "link" en secours). On renvoie les deux pour compat.
    return res.json({ ok: true, url, link: url });
  } catch (e) {
    console.error('create-card error:', e);
    return res.status(500).json({ error: 'server_error', detail: e.message || String(e) });
  }
});

// Page carte
app.get('/c/:id', (req, res) => {
  const rec = loadRecord(req.params.id);
  if (!rec) return res.status(404).send('Carte introuvable.');
  const tpl = loadTemplate();
  const html = tpl
    .replaceAll('{{NOM}}', escapeHtml(rec.nom))
    .replaceAll('{{PRENOM}}', escapeHtml(rec.prenom))
    .replaceAll('{{EMAIL}}', escapeHtml(rec.email))
    .replaceAll('{{CODE}}', escapeHtml(rec.code))
    .replaceAll('{{POINTS}}', escapeHtml(rec.points))
    .replaceAll('{{REDUCTION}}', escapeHtml(rec.reduction))
    .replaceAll('{{BARCODE_URL}}', `/barcode/${encodeURIComponent(rec.code)}`);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(html);
});

// Code-barres PNG
app.get('/barcode/:txt', (req, res) => {
  const text = String(req.params.txt || '');
  bwipjs.toBuffer(
    { bcid: 'code128', text, scale: 3, height: 12, includetext: false },
    (err, png) => {
      if (err) {
        console.error('barcode error:', err);
        return res.status(500).send('barcode_error');
      }
      res.setHeader('Content-Type', 'image/png');
      res.send(png);
    }
  );
});

// Filet de sécurité
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'internal_server_error', detail: err.message });
});

app.listen(PORT, () => console.log(`Listening on :${PORT}`));
