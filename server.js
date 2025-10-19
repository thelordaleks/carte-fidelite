// server.js (CommonJS + import dynamique de @libsql/client)
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');
const bwipjs = require('bwip-js');

dotenv.config();
const app = express();
app.use(express.json());
app.use(cors());
app.use(morgan('dev'));
app.use('/static', express.static(path.join(__dirname, 'static')));

// ——— LibSQL/Turso client (via import ESM dynamique pour rester en CommonJS)
let client;
async function initDb() {
  const { createClient } = await import('@libsql/client');
  const DB_URL =
    process.env.LIBSQL_URL ||
    process.env.TURSO_DATABASE_URL ||
    process.env.LIBSQL_DATABASE_URL; // tolérant aux noms
  const DB_TOKEN =
    process.env.LIBSQL_AUTH_TOKEN ||
    process.env.TURSO_AUTH_TOKEN ||
    process.env.DATABASE_AUTH_TOKEN;

  if (!DB_URL) throw new Error('LIBSQL/TURSO URL manquante');
  client = createClient({ url: DB_URL, authToken: DB_TOKEN });

  await client.execute(`
    CREATE TABLE IF NOT EXISTS cards (
      code TEXT PRIMARY KEY,
      nom TEXT,
      prenom TEXT,
      email TEXT,
      points INTEGER DEFAULT 0,
      reduction TEXT DEFAULT '',
      created_at TEXT,
      updated_at TEXT
    );
  `);
}

// ——— Utils
function nowIso() { return new Date().toISOString(); }
function publicBaseUrl() { return process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT||3000}`; }
function escapeHtml(s){ return String(s ?? '').replace(/[&<>"']/g,(c)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function genCode(n=8){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I
  let out=''; for(let i=0;i<n;i++) out+=chars[Math.floor(Math.random()*chars.length)];
  return out;
}
async function getCard(code){
  const r = await client.execute({ sql:'SELECT * FROM cards WHERE code = ?', args:[code] });
  return r.rows[0];
}

// ——— API: créer/mettre à jour une carte (upsert sur code)
app.post('/api/create-card', async (req,res)=>{
  try{
    const { nom='', prenom='', email='', reduction='', code } = req.body || {};
    const c = (code && String(code).trim()) || genCode();
    const created_at = nowIso();
    const updated_at = created_at;

    await client.execute({
      sql: `
        INSERT INTO cards (code, nom, prenom, email, points, reduction, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?, ?)
        ON CONFLICT(code) DO UPDATE SET
          nom=excluded.nom,
          prenom=excluded.prenom,
          email=excluded.email,
          reduction=excluded.reduction,
          updated_at=excluded.updated_at
      `,
      args: [c, nom, prenom, email, reduction, created_at, updated_at]
    });

    res.json({
      ok:true,
      code: c,
      url: `${publicBaseUrl()}/c/${encodeURIComponent(c)}`
    });
  }catch(e){
    console.error(e);
    res.status(500).json({ ok:false, error:'create_failed' });
  }
});

// ——— API: lire une carte
app.get('/api/card/:code', async (req,res)=>{
  try{
    const row = await getCard(req.params.code);
    if(!row) return res.status(404).json({ ok:false, error:'not_found' });
    res.json({ ok:true, card: row });
  }catch(e){
    res.status(500).json({ ok:false, error:'read_failed' });
  }
});

// ——— API: MAJ des points (delta ou set), protégé par ADMIN_TOKEN
function checkAdmin(req){
  const header = req.headers.authorization || '';
  const q = req.query.key || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header || q;
  return process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN;
}
app.post('/api/card/:code/points', async (req,res)=>{
  try{
    if(!checkAdmin(req)) return res.status(401).json({ ok:false, error:'unauthorized' });
    const code = req.params.code;
    const { delta, set } = req.body || {};
    const row = await getCard(code);
    if(!row) return res.status(404).json({ ok:false, error:'not_found' });

    let newPoints = row.points ?? 0;
    if (typeof set === 'number') newPoints = Math.trunc(set);
    else if (typeof delta === 'number') newPoints = Math.trunc(newPoints + delta);

    await client.execute({
      sql: `UPDATE cards SET points=?, updated_at=? WHERE code=?`,
      args: [newPoints, nowIso(), code]
    });
    res.json({ ok:true, code, points:newPoints });
  }catch(e){
    console.error(e);
    res.status(500).json({ ok:false, error:'update_failed' });
  }
});

// ——— Page carte HTML
const TEMPLATE_PATH = path.join(__dirname, 'template.html');
const DEFAULT_TEMPLATE = `
<!doctype html><html lang="fr"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Carte fidélité</title>
<style>
  :root { --bg: #111; --fg: #fff; --accent:#0d6efd; }
  body { margin:0; background:var(--bg); color:var(--fg); font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; }
  .wrap { max-width: 420px; margin: 16px auto; padding: 12px; }
  .card {
    position: relative; aspect-ratio: 16/9; border-radius: 16px; overflow: hidden;
    background: #222 url('/static/carte-mdl.png') center/cover no-repeat;
    box-shadow: 0 8px 28px rgba(0,0,0,.35);
  }
  .line { position: absolute; left: 6%; right: 6%; color:#fff; text-shadow:0 1px 2px rgba(0,0,0,.6); }
  .line.name { top: 36%; font-weight: 700; font-size: clamp(18px, 4.6vw, 28px); }
  .line.points { top: 50%; font-weight: 700; font-size: clamp(16px, 4.2vw, 24px); }
  .line.reduc { top: 62%; font-size: clamp(12px, 3.4vw, 16px); opacity:.9; }
  .barcode { position: absolute; left: 6%; right: 6%; bottom: 8%; height: 48px; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,.92); border-radius:8px; }
  .barcode img { height: 40px; }
  .meta { text-align:center; margin-top:10px; opacity:.8; font-size: 13px; }
  .btn { display:inline-block; background:var(--accent); color:#fff; padding:10px 14px; border-radius:10px; text-decoration:none; font-weight:600; }
</style>
</head><body>
<div class="wrap">
  <div class="card">
    <div class="line name">{{PRENOM}} {{NOM}}</div>
    <div class="line points">Points: {{POINTS}}</div>
    <div class="line reduc">{{REDUCTION}}</div>
    <div class="barcode"><img src="{{BARCODE_URL}}" alt="barcode"></div>
  </div>
  <div class="meta">Code: {{CODE}}</div>
</div>
</body></html>`;
function loadTemplate(){
  try{ return fs.readFileSync(TEMPLATE_PATH,'utf8'); }
  catch{ return DEFAULT_TEMPLATE; }
}

app.get('/c/:code', async (req,res)=>{
  try{
    const row = await getCard(req.params.code);
    if(!row) return res.status(404).send('Carte introuvable');
    const tpl = loadTemplate();
    const html = tpl
      .replace('{{NOM}}', escapeHtml(row.nom||''))
      .replace('{{PRENOM}}', escapeHtml(row.prenom||''))
      .replace('{{POINTS}}', escapeHtml(String(row.points ?? 0)))
      .replace('{{REDUCTION}}', escapeHtml(row.reduction||''))
      .replace('{{BARCODE_URL}}', `/barcode/${encodeURIComponent(row.code)}`)
      .replace('{{CODE}}', escapeHtml(row.code));
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.send(html);
  }catch(e){
    res.status(500).send('error');
  }
});

// ——— Code‑barres PNG (Code128)
app.get('/barcode/:txt', (req,res)=>{
  try{
    bwipjs.toBuffer({
      bcid: 'code128',
      text: String(req.params.txt),
      scale: 3,
      height: 14,
      includetext: false,
      backgroundcolor: 'FFFFFF'
    }, (err, png) => {
      if (err) return res.status(500).send('barcode_error');
      res.type('png').send(png);
    });
  }catch{
    res.status(500).send('barcode_error');
  }
});

// ——— Lancement
const PORT = process.env.PORT || 3000;
initDb()
  .then(()=> app.listen(PORT, ()=> console.log('Listening on', PORT)))
  .catch((e)=> { console.error('DB init failed:', e); process.exit(1); });
