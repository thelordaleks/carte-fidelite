// ======== Dépendances ========
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const bwipjs = require("bwip-js");
const jwt = require("jsonwebtoken");

// ======== Configuration ========
const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET || "dev-secret-change-me";

// ✅ JSON
app.use(express.json());

// ======== Fichiers statiques ========
app.use("/static", express.static(path.join(__dirname, "static")));

// Vérif fichiers statiques utiles
["logo-mdl.png", "carte-mdl.png", "carte-mdl-mail.png"].forEach((f) => {
  const p = path.join(__dirname, "static", f);
  console.log(fs.existsSync(p) ? "✅ Fichier présent:" : "⚠️  Fichier manquant:", f);
});

// Mémoire (compat ancien /card/:id)
const cartes = {};

// ======== API appelée depuis Excel/PowerAutomate ========
app.post("/api/create-card", (req, res) => {
  if (!req.body) return res.status(400).json({ error: "Requête vide" });

  const raw = req.body || {};
  const { nom, prenom, email, code } = raw;

  if (!nom || !prenom || !code) {
    return res.status(400).json({ error: "Champs manquants (nom, prenom, code)" });
  }

  // Mapping tolérant des colonnes G/H
  const pointsRaw =
    raw.points ??
    raw.cumul ??
    raw.cumul_points ??
    raw["Cumul de points"] ??
    raw["Cumul points"] ??
    raw["Points cumulés"] ??
    raw["Points"] ??
    raw["G"] ??
    raw["g"];

  const reductionRaw =
    raw.reduction ??
    raw.reduction_fidelite ??
    raw.reduc ??
    raw["Réduction Fidélité"] ??
    raw["Reduction Fidélité"] ??
    raw["Réduction fidelité"] ??
    raw["Réduction"] ??
    raw["Réduc"] ??
    raw["H"] ??
    raw["h"];

  const points = (pointsRaw ?? "").toString().trim();
  const reduction = (reductionRaw ?? "").toString().trim();

  // Ancien comportement (mémoire) pour /card/:id
  const id = uuidv4();
  const data = { nom, prenom, email: email || null, code, points, reduction };
  cartes[id] = data;

  // Jeton signé (expire 365 jours)
  const token = jwt.sign(data, SECRET, { expiresIn: "365d" });

  // URLs absolues
  const host =
    process.env.RENDER_EXTERNAL_HOSTNAME || req.headers.host || `localhost:${PORT}`;
  const protocol = host.includes("localhost") ? "http" : "https";
  const urlSigned = `${protocol}://${host}/card/t/${encodeURIComponent(token)}`;
  const urlLegacy = `${protocol}://${host}/card/${id}`;

  console.log("✅ Carte générée:", prenom, nom, "→", urlSigned);
  console.log("ℹ️ G/H reçus:", { points, reduction, keys: Object.keys(raw) });

  return res.json({ url: urlSigned, legacy: urlLegacy });
});

// ======== Code-barres ========
app.get("/barcode/:code", (req, res) => {
  try {
    const includeText = req.query.text === "1";
    bwipjs.toBuffer(
      {
        bcid: "code128",
        text: req.params.code,
        scale: 3,
        height: 10,
        includetext: includeText,
        textxalign: "center",
        backgroundcolor: "FFFFFF",
      },
      (err, png) => {
        if (err) return res.status(500).send("Erreur génération code-barres");
        res.type("image/png").send(png);
      }
    );
  } catch (e) {
    res.status(500).send("Erreur serveur");
  }
});

// ======== Affichage carte — LIEN SIGNÉ (recommandé) ========
app.get("/card/t/:token", (req, res) => {
  let carte;
  try {
    carte = jwt.verify(req.params.token, SECRET);
  } catch {
    return res.status(404).send("<h1>Carte introuvable ❌</h1>");
  }

  const prenom = (carte.prenom || "").trim();
  const nom = (carte.nom || "").trim();
  const code = (carte.code || "").trim();
  const points = (carte.points ?? "").toString().trim();
  const reduction = (carte.reduction ?? "").toString().trim();

  // URLs absolues (obligatoire pour aperçus d’e‑mail)
  const host = process.env.RENDER_EXTERNAL_HOSTNAME || req.headers.host || `localhost:${PORT}`;
  const protocol = host.includes("localhost") ? "http" : "https";
  const abs = (p) => `${protocol}://${host}${p}`;

  // Fond de page: selon ?bg=mail (utile pour tester visuellement)
const isMail = String(req.query.bg || "").toLowerCase() === "mail";
const bgFile = isMail ? "carte-mdl-mail.png" : "carte-mdl.png";

// APERÇU DU LIEN: TOUJOURS l'image spéciale e‑mail (indépendant de ?bg)
const ogImage = abs(`/static/carte-mdl-mail.png?v=2025-10-18-2`); // change le v pour forcer le cache

  const debug = req.query.debug === "1";

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  res.send(`<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Carte de fidélité MDL</title>

<!-- Aperçus (email / messagerie) -->
<meta property="og:type" content="website">
<meta property="og:title" content="Carte de fidélité MDL">
<meta property="og:description" content="${(prenom + ' ' + nom).trim()}">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="675">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${ogImage}">
<link rel="image_src" href="${ogImage}">

<style>
:root{
  --maxw: 980px;
  --y-bar:    36%;
  --y-nom:    65.5%;
  --y-prenom: 76%;
  --y-points: 83%;
  --y-reduc:  83%;
  --x-nom:     24%;
  --x-prenom:  24%;
  --r-nom:     31%;
  --r-prenom:  31%;
  --x-points:  26%;
  --w-points:  19%;
  --x-reduc:   45%;
  --w-reduc:   17%;
  --bar-l:      8%;
  --bar-r:      8%;
  --ty-nom:    -51%;
  --ty-prenom: -50%;
}
*{box-sizing:border-box}
body{
  margin:0; background:#f2f2f2;
  font-family: system-ui, -apple-system, Segoe UI, Arial, sans-serif;
  min-height:100svh; display:flex; align-items:center; justify-content:center; padding:16px;
  color:#1c2434;
}
.wrap{ width:min(96vw, var(--maxw)); background:#fff; border-radius:20px; padding:16px; box-shadow:0 6px 24px rgba(0,0,0,.10); }
.carte{ position:relative; width:100%; border-radius:16px; overflow:hidden; aspect-ratio: 1024 / 585; background:#fff url('${abs('/static/' + bgFile)}') center/cover no-repeat; }
.overlay{ position:absolute; inset:0; }

.line{
  position:absolute;
  ${debug ? "" : "opacity:0;"}
  overflow:hidden; white-space:nowrap; text-overflow:clip;
  letter-spacing:.2px; text-shadow:0 1px 0 rgba(255,255,255,.6);
  transition:opacity .12s ease;
}
.line .txt{ display:inline-block; white-space:nowrap; transform-origin:left center; line-height:1; }

.barcode{ left:var(--bar-l); right:var(--bar-r); top:var(--y-bar); display:flex; align-items:center; justify-content:center; }
.barcode img{ width:86%; max-width:760px; height:auto; filter:drop-shadow(0 1px 0 rgba(255,255,255,.5)); }

.line.nom{
  left:var(--x-nom); right:var(--r-nom); top:var(--y-nom);
  transform: translateY(var(--ty-nom, -50%));
  font-weight:800; font-size:clamp(22px, 4.8vw, 42px); letter-spacing:-0.02em; text-transform:uppercase;
}
.line.prenom{
  left:var(--x-prenom); right:var(--r-prenom); top:var(--y-prenom);
  transform: translateY(var(--ty-prenom, -50%));
  font-weight:700; font-size:clamp(18px, 4.2vw, 36px);
}
.line.points{ top:var(--y-points); left:var(--x-points); width:var(--w-points); font-weight:700; font-size:clamp(14px,2.6vw,24px); }
.line.reduction{ top:var(--y-reduc); left:var(--x-reduc); width:var(--w-reduc); font-weight:700; font-size:clamp(14px,2.6vw,24px); }

@media (max-width: 480px){
  :root{ --y-nom: 65.5%; --y-prenom: 76.5%; }
}
.info{ text-align:center; color:#444; font-size:14px; margin-top:12px; }
.fitted .line{ opacity:1; }
${debug ? `.line{ outline:1px dashed rgba(255,0,0,.65); background:rgba(255,0,0,.06); }` : ``}
</style>
</head>
<body>
  <div class="wrap">
    <div class="carte" role="img" aria-label="Carte de fidélité de ${prenom} ${nom}">
      <div class="overlay">
        <div class="line barcode">
          <img src="${abs('/barcode/' + encodeURIComponent(code) + '?text=0')}" alt="Code-barres ${code}" decoding="async" />
        </div>
        <div class="line nom"><span class="txt">${nom.toUpperCase()}</span></div>
        <div class="line prenom"><span class="txt">${prenom}</span></div>
        <div class="line points"><span class="txt">${points}</span></div>
        <div class="line reduction"><span class="txt">${reduction}</span></div>
      </div>
    </div>
    <div class="info">
      ${['Code: ' + code, (points!=='' ? 'Points: ' + points : null), (reduction!=='' ? 'Réduction: ' + reduction : null)].filter(Boolean).join(' • ')}
    </div>
  </div>

  <script>
  (function(){
    function fitOneLineCap(container, opts){
      if(!container) return;
      const el = container.querySelector('.txt') || container;
      opts = opts || {};
      const minScale = typeof opts.minScale === 'number' ? opts.minScale : 0.5;
      const grow     = typeof opts.grow     === 'number' ? opts.grow     : 1.0;
      const padPx    = typeof opts.padPx    === 'number' ? opts.padPx    : 0;
      const maxPx    = typeof opts.maxPx    === 'number' ? opts.maxPx    : Infinity;
      const squeeze  = opts.squeeze || null;

      const w = Math.max(0, (container.getBoundingClientRect().width || 0) - padPx);
      if (w <= 0) return;

      const base = parseFloat(getComputedStyle(el).fontSize) || 16;

      let lo = Math.max(1, base * minScale);
      let hi = Math.min(maxPx, base * Math.max(1, grow));
      let best = lo;

      for (let i=0; i<30; i++){
        const mid = (lo + hi) / 2;
        el.style.fontSize = mid + 'px';
        if (el.scrollWidth <= w){ best = mid; lo = mid; } else { hi = mid; }
        if (hi - lo < 0.2) break;
      }
      el.style.fontSize = Math.min(best, maxPx) + 'px';

      el.style.transform = 'none';
      if (squeeze && el.scrollWidth > w){
        let sx = 1.0;
        const minS = squeeze.min ?? 0.92;
        const step = squeeze.step ?? 0.01;
        while (el.scrollWidth > w && sx > minS){
          sx = +(sx - step).toFixed(3);
          el.style.transform = \`scaleX(\${sx})\`;
        }
      }
    }

    function run(){
      const card = document.querySelector('.carte');
      const cw = (card && card.getBoundingClientRect().width) || 1024;
      const capNom = Math.round(Math.max(16, cw * 0.045));
      const capPre = Math.round(Math.max(15, cw * 0.039));
      const isNarrow = cw < 520;

      fitOneLineCap(document.querySelector('.line.nom'), {
        minScale: 0.34, grow: isNarrow ? 1.25 : 1.55, maxPx: capNom, padPx: 10, squeeze: { min: 0.92, step: 0.01 }
      });
      fitOneLineCap(document.querySelector('.line.prenom'), {
        minScale: 0.45, grow: isNarrow ? 1.25 : 1.45, maxPx: capPre, padPx: 10, squeeze: { min: 0.95, step: 0.01 }
      });
      document.body.classList.add('fitted');
    }

    let raf = null;
    function schedule(){ if(raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(run); }
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve())
      .then(() => { if (document.readyState === 'complete') run(); else window.addEventListener('load', run); });
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    window.fitNames = run;
  })();
  </script>
</body>
</html>`);
});

// ======== Affichage carte — ANCIEN LIEN (dépend de la mémoire) ========
app.get("/card/:id", (req, res) => {
  const carte = cartes[req.params.id];
  if (!carte) return res.status(404).send("<h1>Carte introuvable ❌</h1>");
  const token = jwt.sign(carte, SECRET, { expiresIn: "365d" });
  res.redirect(302, `/card/t/${encodeURIComponent(token)}`);
});

// ======== Page d’accueil et test ========
app.get("/new", (_req, res) => {
  res.send(`<html><head><title>Test Carte MDL</title></head>
  <body style="text-align:center;font-family:Arial;">
    <h2>Carte de fidélité test MDL</h2>
    <img src="/static/carte-mdl.png" style="width:320px;border-radius:12px;">
  </body></html>`);
});

app.get("/", (_req, res) => {
  res.send(`<html><head><title>Serveur Carte Fidélité MDL</title></head>
  <body style="font-family:Arial;text-align:center;padding:40px">
    <h2>✅ Serveur MDL en ligne</h2>
    <ul style="list-style:none;padding:0">
      <li>/api/create-card — API pour Excel (retourne url signé)</li>
      <li>/card/t/:token — Afficher une carte (stateless) — options ?bg=mail et ?debug=1</li>
      <li>/card/:id — Ancien lien basé mémoire (redirige vers lien signé)</li>
      <li>/barcode/:code — Générer un code-barres (?text=1 pour afficher le texte)</li>
    </ul>
  </body></html>`);
});

// ======== Lancement ========
app.listen(PORT, () => {
  const host = process.env.RENDER_EXTERNAL_HOSTNAME || `localhost:${PORT}`;
  const protocol = host.includes("localhost") ? "http" : "https";
  console.log(`🚀 Serveur démarré sur ${protocol}://${host}`);
  if (!process.env.SECRET) {
    console.warn("⚠️  SECRET non défini — utilisez une variable d'environnement en production.");
  }
});
