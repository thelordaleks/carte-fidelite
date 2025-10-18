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

// Static
app.use("/static", express.static(path.join(__dirname, "static")));

// Vérif fichiers statiques utiles
["logo-mdl.png", "carte-mdl.png", "carte-mdl-mail.png"].forEach((f) => {
  const p = path.join(__dirname, "static", f);
  console.log(fs.existsSync(p) ? "✅ Fichier présent:" : "⚠️  Fichier manquant:", f);
});

// Mémoire (compat ancien /card/:id)
const cartes = {};

// ======== API appelée depuis Excel ========
app.post("/api/create-card", (req, res) => {
  if (!req.body) return res.status(400).json({ error: "Requête vide" });

  const raw = req.body || {};
  const { nom, prenom, email, code } = raw;

  if (!nom || !prenom || !code) {
    return res.status(400).json({ error: "Champs manquants (nom, prenom, code)" });
  }

  // Mapping ULTRA tolérant pour colonnes G/H venant d’Excel/PowerAutomate
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

  const bg =
    (req.query.bg || "").toLowerCase() === "mail" ? "carte-mdl-mail.png" : "carte-mdl.png";
  const debug = req.query.debug === "1"; // ?debug=1 pour afficher les cadres

  res.send(`<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Carte de fidélité MDL</title>
<style>
:root{
  /* gabarit 1024x585 => ratio ≈ 1.75 */
  --maxw: 980px;

  /* Y calés (en %) sur tes pilules */
  --y-bar:    36%;
  --y-nom:    66%;
  --y-prenom: 76%;
  --y-points: 83%;
  --y-reduc:  83%;

  /* X/largeurs calés (en %) */
  --x-nom:     24%;
  --x-prenom:  24%;
  --r-nom:     35%;
  --r-prenom:  35%;

  --x-points:  26%;
  --w-points:  17%;
  --x-reduc:   45%;
  --w-reduc:   17%;

  --bar-l:      8%;
  --bar-r:      8%;

  /* offsets de centrage vertical */
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
.carte{ position:relative; width:100%; border-radius:16px; overflow:hidden; aspect-ratio: 1024 / 585; background:#fff url('/static/${bg}') center/cover no-repeat; }
.overlay{ position:absolute; inset:0; }

/* Zones texte */
.line{
  position:absolute;
  ${debug ? "" : "opacity:0;"} /* on montre après le fit */
  white-space:nowrap; overflow:hidden; text-overflow:clip;
  letter-spacing:.2px; text-shadow:0 1px 0 rgba(255,255,255,.6);
  transition:opacity .12s ease;
}

/* Code-barres */
.barcode{ left:var(--bar-l); right:var(--bar-r); top:var(--y-bar); display:flex; align-items:center; justify-content:center; }
.barcode img{ width:86%; max-width:760px; height:auto; filter:drop-shadow(0 1px 0 rgba(255,255,255,.5)); }

/* Nom/Prénom: pilules */
.line.nom{
  left:var(--x-nom); right:var(--r-nom); top:var(--y-nom);
  transform: translateY(var(--ty-nom, -50%));
  font-weight:800;
  font-size:clamp(18px, 4.8vw, 46px);
  letter-spacing:-0.015em;
  text-transform:uppercase;
}
.line.prenom{
  left:var(--x-prenom); right:var(--r-prenom); top:var(--y-prenom);
  transform: translateY(var(--ty-prenom, -50%));
  font-weight:700;
  font-size:clamp(16px, 4.2vw, 34px);
}

/* Petites pilules du bas */
.line.points{
  top:var(--y-points); left:var(--x-points); width:var(--w-points);
  font-weight:700; font-size:clamp(14px,2.6vw,24px);
}
.line.reduction{
  top:var(--y-reduc);  left:var(--x-reduc);  width:var(--w-reduc);
  font-weight:700; font-size:clamp(14px,2.6vw,24px);
}

/* Info sous la carte */
.info{ text-align:center; color:#444; font-size:14px; margin-top:12px; }

.fitted .line{ opacity:1; }

/* Debug: cadres visibles */
${debug ? `.line{ outline:1px dashed rgba(255,0,0,.65); background:rgba(255,0,0,.06); }` : ``}
</style>
</head>
<body>
  <div class="wrap">
    <div class="carte" role="img" aria-label="Carte de fidélité de ${prenom} ${nom}">
      <div class="overlay">
        <div class="line barcode">
          <img src="/barcode/${encodeURIComponent(code)}?text=0" alt="Code-barres ${code}" decoding="async" />
        </div>

        <!-- Nom/Prénom -->
        <div class="line nom">${nom.toUpperCase()}</div>
        <div class="line prenom">${prenom}</div>

        <!-- Points / Réduction -->
        <div class="line points">${points}</div>
        <div class="line reduction">${reduction}</div>
      </div>
    </div>
    <div class="info">
      ${['Code: ' + code, (points!=='' ? 'Points: ' + points : null), (reduction!=='' ? 'Réduction: ' + reduction : null)].filter(Boolean).join(' • ')}
    </div>
  </div>

  <!-- ===== Fit: agrandit UNIQUEMENT le NOM si possible ===== -->
  <script>
  (function(){
    function fitOneLine(el, opts){
      if(!el) return;
      opts = opts || {};
      var minScale = typeof opts.minScale === 'number' ? opts.minScale : 0.5;
      var grow = typeof opts.grow === 'number' ? opts.grow : 1.0; // >1 = autorise à grandir
      var padPx = typeof opts.padPx === 'number' ? opts.padPx : 0;

      el.style.whiteSpace = 'nowrap';
      el.style.display = 'inline-block';

      var w = (el.clientWidth || el.getBoundingClientRect().width || 0) - padPx;
      if (w <= 0) return;

      var base = parseFloat(getComputedStyle(el).fontSize) || 16;
      var lo = base * minScale;
      var hi = base;

      // Part à la taille actuelle
      el.style.fontSize = hi + 'px';

      // Si ça tient et qu'on peut grandir → augmente jusqu'à frôler la limite
      if (grow > 1 && el.scrollWidth < w) {
        var cap = base * grow;
        while (el.scrollWidth < w && hi < cap) {
          lo = hi;
          hi = Math.min(cap, hi * 1.12); // pas ~12%
          el.style.fontSize = hi + 'px';
        }
      }

      // Recherche dichotomique pour coller au bord sans déborder
      for (var i = 0; i < 28; i++){
        var mid = (hi + lo) / 2;
        el.style.fontSize = mid + 'px';
        if (el.scrollWidth <= w) { lo = mid; } else { hi = mid; }
        if (Math.abs(hi - lo) < 0.2) break;
      }
      el.style.fontSize = Math.max(lo, base*minScale) + 'px';
    }

    function run(){
      // NOM: peut grandir jusqu'à +55%, petite marge à droite
      fitOneLine(document.querySelector('.line.nom'),    { minScale:0.50, grow:1.55, padPx:8 });
      // PRÉNOM: inchangé (ne grandit pas)
      fitOneLine(document.querySelector('.line.prenom'), { minScale:0.55, grow:1.00, padPx:8 });

      document.body.classList.add('fitted');
    }

    if (document.fonts && document.fonts.ready) { document.fonts.ready.then(run); }
    window.addEventListener('load', run);
    window.addEventListener('resize', run);
    window.addEventListener('orientationchange', run);

    // helper si besoin
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
    <ul style="list-style:none">
      <li>/api/create-card — API pour Excel (retourne url signé)</li>
      <li>/card/t/:token — Afficher une carte (stateless) — option ?bg=mail et ?debug=1</li>
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
