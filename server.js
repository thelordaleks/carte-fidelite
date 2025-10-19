// server.js
"use strict";

/* =======================
   Base SQLite (better-sqlite3)
   ======================= */
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_FILE = process.env.DB_FILE || path.join(__dirname, "data.sqlite");
const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS membres (
  id TEXT PRIMARY KEY,
  prenom TEXT NOT NULL,
  nom TEXT NOT NULL,
  email TEXT,
  code TEXT NOT NULL,
  points TEXT,
  reduction TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_membres_code ON membres(code);
`);
const upsert = db.prepare(`
INSERT INTO membres (id, prenom, nom, email, code, points, reduction)
VALUES (@id, @prenom, @nom, @email, @code, @points, @reduction)
ON CONFLICT(code) DO UPDATE SET
  prenom=excluded.prenom,
  nom=excluded.nom,
  email=excluded.email,
  points=excluded.points,
  reduction=excluded.reduction,
  updated_at=datetime('now')
`);
const getById   = db.prepare("SELECT * FROM membres WHERE id = ?");
const getByCode = db.prepare("SELECT * FROM membres WHERE code = ?");

/* =======================
   Dépendances serveur
   ======================= */
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const bwipjs = require("bwip-js");
const jwt = require("jsonwebtoken");

/* =======================
   Configuration Express
   ======================= */
const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET || "dev-secret-change-me";

app.set("trust proxy", 1);
app.use(express.json());

/* =======================
   Fichiers statiques
   ======================= */
app.use("/static", express.static(path.join(__dirname, "static")));
["logo-mdl.png", "carte-mdl.png", "carte-mdl-mail.png"].forEach((f) => {
  const p = path.join(__dirname, "static", f);
  console.log(fs.existsSync(p) ? "✅ Fichier présent:" : "⚠️  Fichier manquant:", f);
});

/* =======================
   Mémoire (compat ancien /card/:id)
   ======================= */
const cartes = {};

/* =======================
   Helpers
   ======================= */
function makeBaseUrl(req) {
  const host = process.env.RENDER_EXTERNAL_HOSTNAME || req.headers.host || `localhost:${PORT}`;
  const xfProto = (req.headers["x-forwarded-proto"] || "").toString().split(",")[0].trim();
  const protocol = xfProto || (host.includes("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

/* =======================
   API: création de carte (Excel/PowerAutomate) — PERSISTANTE
   ======================= */
app.post("/api/create-card", (req, res) => {
  if (!req.body) return res.status(400).json({ error: "Requête vide" });

  const raw = req.body || {};
  const { nom, prenom, email, code } = raw;

  if (!nom || !prenom || !code) {
    return res.status(400).json({ error: "Champs manquants (nom, prenom, code)" });
  }

  // Mapping souple colonnes points / réduction (Excel peut changer d'en-têtes)
  const pointsRaw =
    raw.points ?? raw.cumul ?? raw.cumul_points ??
    raw["Cumul de points"] ?? raw["Cumul points"] ??
    raw["Points cumulés"] ?? raw["Points"] ?? raw["G"] ?? raw["g"];

  const reductionRaw =
    raw.reduction ?? raw.reduction_fidelite ?? raw.reduc ??
    raw["Réduction Fidélité"] ?? raw["Reduction Fidélité"] ??
    raw["Réduction fidelité"] ?? raw["Réduction"] ?? raw["Réduc"] ??
    raw["H"] ?? raw["h"];

  const points = (pointsRaw ?? "").toString().trim();
  const reduction = (reductionRaw ?? "").toString().trim();

  // Propose un nouvel id; si le code existe, l'UPSERT met à jour la fiche existante
  const id = uuidv4();
  const data = { id, nom, prenom, email: email || null, code, points, reduction };

  try {
    upsert.run(data);
    const row = getByCode.get(code);
    if (!row) return res.status(500).json({ error: "Persisté mais introuvable (DB)" });

    // Compat mémoire
    cartes[row.id] = row;

    // Lien signé (stateless)
    const token = jwt.sign(row, SECRET, { expiresIn: "365d" });
    const base = makeBaseUrl(req);
    const urlSigned = `${base}/card/t/${encodeURIComponent(token)}`;
    const urlLegacy = `${base}/card/${row.id}`;

    console.log("✅ Carte persistée:", row.prenom, row.nom, "→", urlSigned);
    console.log("ℹ️ G/H reçus:", { points, reduction, keys: Object.keys(raw) });

    return res.json({ ok: true, id: row.id, url: urlSigned, legacy: urlLegacy });
  } catch (e) {
    console.error("❌ Erreur persist /api/create-card:", e);
    return res.status(500).json({ error: "Erreur serveur lors de la création" });
  }
});

/* =======================
   API: lookup par code
   ======================= */
app.get("/api/find-by-code/:code", (req, res) => {
  const code = String(req.params.code || "").trim();
  if (!code) return res.status(400).json({ error: "code requis" });

  const row = getByCode.get(code);
  if (!row) return res.status(404).json({ error: "not found" });

  const token = jwt.sign(row, SECRET, { expiresIn: "365d" });
  const base = makeBaseUrl(req);
  const url = `${base}/card/t/${encodeURIComponent(token)}`;
  res.json({ ...row, token, url });
});

/* =======================
   Code-barres (PNG)
   ======================= */
app.get("/barcode/:code", async (req, res) => {
  try {
    const includeText = req.query.text === "1" || req.query.text === "true";
    const buf = await bwipjs.toBuffer({
      bcid: "code128",
      text: String(req.params.code || ""),
      scale: 3,
      height: 10,       // mm approx (bwip-js units)
      includetext: includeText,
      textxalign: "center",
      textsize: 12,
      backgroundcolor: "FFFFFF"
    });
    res.setHeader("Content-Type", "image/png");
    res.send(buf);
  } catch (e) {
    res.status(400).send("Invalid barcode");
  }
});

/* =======================
   Affichage carte — LIEN SIGNE (token)
   Options: ?bg=mail | print | default, ?debug=1
   ======================= */
app.get("/card/t/:token", (req, res) => {
  try {
    const data = jwt.verify(req.params.token, SECRET);
    const bg = (req.query.bg || "").toString();
    const debug = req.query.debug === "1";

    const bgFile =
      bg === "mail" ? "carte-mdl-mail.png"
    : bg === "print" ? "carte-mdl.png"
    : "carte-mdl.png";

    // Sanitize affichage
    const safe = {
      prenom: (data.prenom || "").toString(),
      nom: (data.nom || "").toString(),
      email: (data.email || "").toString(),
      code: (data.code || "").toString(),
      points: (data.points || "").toString(),
      reduction: (data.reduction || "").toString(),
    };

    const base = makeBaseUrl(req);
    const barcodeUrl = `${base}/barcode/${encodeURIComponent(safe.code)}?text=1`;

    res.send(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>Carte MDL</title>
  <style>
    :root{
      --card-w: 420px;
      --card-h: 260px;
    }
    *{ box-sizing: border-box; }
    body{
      margin:0; padding:16px; font-family: -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;
      background:#f5f6f8; color:#222;
    }
    .wrap{ display:flex; justify-content:center; align-items:center; min-height:100vh; }
    .carte{
      position:relative; width: min(92vw, var(--card-w)); aspect-ratio: 420/260;
      border-radius:16px; overflow:hidden; background:#fff;
      box-shadow: 0 10px 30px rgba(0,0,0,.12);
      ${debug ? "outline:2px dashed #f80;" : ""}
    }
    .bg{
      position:absolute; inset:0; background:#fff center/cover no-repeat url('/static/${bgFile}');
      filter: ${bg === "mail" ? "saturate(1.05)" : "none"};
    }
    .content{
      position:absolute; inset:0; padding:14px 16px; display:flex; flex-direction:column; justify-content:flex-end;
    }
    .row{ display:flex; gap:8px; align-items:center; }
    .name{
      position:absolute; left:16px; right:16px; top:18px; line-height:1.1;
      ${debug ? "outline:1px dotted #07f;" : ""}
    }
    .name .prenom{ font-weight:700; font-size: clamp(18px, 6.2vw, 26px); }
    .name .nom{ font-weight:800; font-size: clamp(20px, 6.8vw, 28px); letter-spacing:.4px; }
    .code{
      margin-top: auto; font-weight:700; font-size: clamp(14px, 4.6vw, 18px);
      ${debug ? "outline:1px dotted #0a0;" : ""}
    }
    .stats{
      display:flex; gap:16px; margin:6px 0 8px;
      ${debug ? "outline:1px dotted #a0a;" : ""}
    }
    .stat{ background:rgba(255,255,255,.82); backdrop-filter: blur(2px);
      padding:6px 10px; border-radius:8px; font-size: clamp(12px, 3.6vw, 14px); }
    .barcode{ width: 64%; max-width: 300px; margin-top:6px; background:#fff; border-radius:6px; padding:6px; }
    .footer{ position:absolute; right:12px; bottom:10px; font-size:12px; opacity:.7 }
    @media (max-width:520px){
      .barcode{ width:72%; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="carte">
      <div class="bg" aria-hidden="true"></div>
      <div class="name">
        <div class="prenom">${escapeHtml(safe.prenom)}</div>
        <div class="nom">${escapeHtml(safe.nom)}</div>
      </div>
      <div class="content">
        <div class="stats">
          <div class="stat">Points: <strong>${escapeHtml(safe.points || "-")}</strong></div>
          <div class="stat">Réduction: <strong>${escapeHtml(safe.reduction || "-")}</strong></div>
        </div>
        <div class="code">Code: <span>${escapeHtml(safe.code)}</span></div>
        <img class="barcode" alt="code-barres" src="${barcodeUrl}">
        <div class="footer">MDL</div>
      </div>
    </div>
  </div>
</body>
</html>`);
  } catch (_e) {
    res.status(400).send("<h1>Token invalide ou expiré</h1>");
  }
});

// Petite fonction pour échapper le HTML (XSS-safe pour les valeurs)
function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

/* =======================
   Affichage carte — ANCIEN LIEN (fallback mémoire + DB)
   ======================= */
app.get("/card/:id", (req, res) => {
  const id = String(req.params.id || "").trim();
  const carte = cartes[id] || getById.get(id);
  if (!carte) return res.status(404).send("<h1>Carte introuvable ❌</h1>");
  const token = jwt.sign(carte, SECRET, { expiresIn: "365d" });
  res.redirect(302, `/card/t/${encodeURIComponent(token)}`);
});

/* =======================
   Pages de test
   ======================= */
app.get("/new", (_req, res) => {
  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Test Carte MDL</title></head>
  <body style="text-align:center;font-family:Arial;padding:40px;background:#f5f6f8">
    <h2>Carte de fidélité test MDL</h2>
    <img src="/static/carte-mdl.png" style="width:320px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.12)">
  </body></html>`);
});

app.get("/", (_req, res) => {
  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Serveur Carte Fidélité MDL</title></head>
  <body style="font-family:Arial;text-align:center;padding:40px;background:#f5f6f8">
    <h2>✅ Serveur MDL en ligne</h2>
    <ul style="list-style:none;padding:0;line-height:1.9">
      <li><code>POST /api/create-card</code> — API pour Excel (retourne url signée)</li>
      <li><code>GET /api/find-by-code/:code</code> — Récupérer une carte et une URL signée</li>
      <li><code>/card/t/:token</code> — Afficher une carte (stateless) — options <code>?bg=mail</code> et <code>?debug=1</code></li>
      <li><code>/card/:id</code> — Ancien lien (redirige vers lien signé, lit mémoire + DB)</li>
      <li><code>/barcode/:code</code> — PNG de code-barres (<code>?text=1</code> pour afficher le texte)</li>
      <li><code>/static</code> — Fichiers: carte-mdl.png, carte-mdl-mail.png, logo-mdl.png</li>
    </ul>
  </body></html>`);
});

/* =======================
   Lancement
   ======================= */
app.listen(PORT, () => {
  const base = `http://localhost:${PORT}`;
  console.log(`🚀 Serveur démarré sur ${base}`);
  console.log(`→ Test rapide: ${base}/`);
  if (!process.env.SECRET) {
    console.warn("⚠️  SECRET non défini — utilisez une variable d'environnement en production.");
  }
});
