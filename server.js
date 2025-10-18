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

  // Mapping tolérant pour colonnes G/H
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

  const host = process.env.RENDER_EXTERNAL_HOSTNAME || req.headers.host || `localhost:${PORT}`;
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

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

  const prenom = (carte.prenom || "").trim();
  const nom = (carte.nom || "").trim();
  const code = (carte.code || "").trim();
  const points = (carte.points ?? "").toString().trim();
  const reduction = (carte.reduction ?? "").toString().trim();

  const bg = (req.query.bg || "").toLowerCase() === "mail" ? "carte-mdl-mail.png" : "carte-mdl.png";
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

  /* Y calés (en %) */
  --y-bar:    36%;
  --y-nom:    66%;
  --y-prenom: 76%;
  --y-points: 83%;
  --y-reduc:  83%;

  /* X/largeurs (en %) — FIXES: on ne décale PAS, on ne change PAS sur PC */
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
  white-space:nowrap; overflow:hidden; text-overflow:clip;
  letter-spacing:0; /* pas de compaction, on ajuste UNIQUEMENT la taille de police */
  opacity:0; transition:opacity .12s ease;
}

/* Code-barres */
.barcode{ left:var(--bar-l); right:var(--bar-r); top:var(--y-bar); display:flex; align-items:center; justify-content:center; }
.barcode img{ width:86%; max-width:760px; height:auto; }

/* Nom/Prénom: texte simple, pas de bulles, zones FIXES */
.line.nom{
  left:var(--x-nom); right:var(--r-nom); top:var(--y-nom);
  transform: translateY(var(--ty-nom, -50%));
  font-weight:800;
  font-size:clamp(18px, 4.8vw, 46px);
  text-transform:uppercase;
}
.line.prenom{
  left:var(--x-prenom); right:var(--r-prenom); top:var(--y-prenom);
  transform: translateY(var(--ty-prenom, -50%));
  font-weight:700;
  font-size:clamp(16px, 4.2vw, 34px);
}

/* Petites zones chiffrées */
.points{
  top:var(--y-points); left:var(--x-points); width:var(--w-points);
  font-weight:700; font-size:clamp(14px,2.6vw,24px);
}
.reduction{
  top:var(--y-reduc);  left:var(--x-reduc);  width:var(--w-reduc);
  font-weight:700; font-size:clamp(14px,2.6vw,24px);
}

.fitted .line{ opacity:1; }

/* Debug: cadres visibles */
${debug ? `.line{ outline:1px dashed rgba(255,0,0,.65); background:rgba(255,0,0,.06); }` : ``}
</style>
</head>
<body>
  <div class="wrap">
    <div class="carte" role="img" aria-label="Carte de fidélité de ${esc(prenom)} ${esc(nom)}">
      <div class="overlay">
        <div class="line barcode">
          <img src="/barcode/${encodeURIComponent(code)}?text=0" alt="Code-barres ${esc(code)}" decoding="async" />
        </div>

        <!-- 1 ligne obligatoire + adaptation uniquement par taille de police -->
        <div class="line nom"    id="nom"    data-min-scale="0.34">${esc(nom.toUpperCase())}</div>
        <div class="line prenom" id="prenom" data-min-scale="0.40">${esc(prenom)}</div>

        <div class="line points">${esc(points)}</div>
        <div class="line reduction">${esc(reduction)}</div>
      </div>
    </div>
  </div>

  <script>
    // Ajuste UNIQUEMENT la taille de police pour tenir sur une ligne, sans bouger les marges.
    (function(){
      function fitOneLine(el, opts){
        opts = opts || {};
        var minScale  = typeof opts.minScale === 'number' ? opts.minScale : 0.34;
        var precision = typeof opts.precision === 'number' ? opts.precision : 0.12;

        // reset
        el.style.fontSize = '';

        var cs   = getComputedStyle(el);
        var base = parseFloat(cs.fontSize); // taille issue du clamp()
        var w    = el.clientWidth || el.getBoundingClientRect().width || 0;
        if (!w || !base) return;

        // bornes
        var lo = base * minScale, hi = base, best = lo;

        // essai en haut
        el.style.fontSize = hi + 'px';
        if (el.scrollWidth <= w) {
          best = hi;
        } else {
          // dichotomie
          for (var i=0; i<26 && (hi - lo) > precision; i++) {
            var mid = (hi + lo) / 2;
            el.style.fontSize = mid + 'px';
            if (el.scrollWidth <= w) { best = mid; hi = mid; } else { lo = mid; }
          }
        }
        el.style.fontSize = best + 'px';
      }

      function runFit(){
        var nodes = document.querySelectorAll('.line.nom, .line.prenom');
        nodes.forEach(function(el){
          var ms = parseFloat(el.getAttribute('data-min-scale')) || (el.classList.contains('nom') ? 0.34 : 0.40);
          fitOneLine(el, {minScale: ms});
        });
        document.body.classList.add('fitted');
      }

      if (document.fonts && document.fonts.ready) { document.fonts.ready.then(runFit); }
      window.addEventListener('load', runFit);
      window.addEventListener('resize', runFit);
      window.addEventListener('orientationchange', runFit);
      window.fitNow = runFit;
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
  console.log(\`🚀 Serveur démarré sur \${protocol}://\${host}\`);
  if (!process.env.SECRET) {
    console.warn("⚠️  SECRET non défini — utilisez une variable d'environnement en production.");
  }
});
