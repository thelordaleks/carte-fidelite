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
  --y-nom:    63%;  /* 62% → 60.8% : remonte un peu */
  --y-prenom: 73%;  /* 72% → 70.8% : remonte un peu */
  --y-points: 83%;
  --y-reduc:  83%;

  /* X/largeurs calés (en %) */
  --x-nom:     23%;
  --x-prenom:  23%;
  --r-nom:     6%;    /* marge droite par défaut (élargit la zone du Nom) */
  --r-prenom:  9%;

  --x-points:  26%;
  --w-points:  17%;
  --x-reduc:   45%;
  --w-reduc:   17%;

  --bar-l:      8%;
  --bar-r:      8%;

  /* offsets de centrage vertical (MAJ = un chouïa plus haut visuellement) */
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
  opacity:0; /* on montre après le fit */
  white-space:nowrap; overflow:hidden; text-overflow:clip;
  letter-spacing:.2px; text-shadow:0 1px 0 rgba(255,255,255,.6);
  transition:opacity .12s ease;
}

/* Code-barres */
.barcode{ left:var(--bar-l); right:var(--bar-r); top:var(--y-bar); display:flex; align-items:center; justify-content:center; }
.barcode img{ width:86%; max-width:760px; height:auto; filter:drop-shadow(0 1px 0 rgba(255,255,255,.5)); }

/* Nom/Prénom: pile sur les grandes pilules */
.line.nom{
  left:var(--x-nom); right:var(--r-nom); top:var(--y-nom);
  transform: translateY(var(--ty-nom, -50%));
  font-weight:800;
  font-size:clamp(18px, 4.8vw, 46px);
  letter-spacing:-0.015em;             /* légère compaction utile en MAJ */
  text-transform:uppercase;
}
.line.prenom{
  left:var(--x-prenom); right:var(--r-prenom); top:var(--y-prenom);
  transform: translateY(var(--ty-prenom, -50%));
  font-weight:700;
  font-size:clamp(16px, 4.2vw, 34px);
}

/* Petites pilules du bas */
.points{
  top:var(--y-points); left:var(--x-points); width:var(--w-points);
  font-weight:700; font-size:clamp(14px,2.6vw,24px);
}
.reduction{
  top:var(--y-reduc);  left:var(--x-reduc);  width:var(--w-reduc);
  font-weight:700; font-size:clamp(14px,2.6vw,24px);
}

/* Info sous la carte */
.info{ text-align:center; color:#444; font-size:14px; margin-top:12px; }

.fitted .line{ opacity:1; }

/* Mode “bord droit serré” pour la pilule du Nom (noms très longs) */
.carte.tight-nom   { --r-nom: 10%; }     /* réduit un peu la largeur utile → fit diminue la taille */
.carte.tighter-nom { --r-nom: 11.5%; }   /* cas extrême */

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

        <!-- 1 ligne obligatoire + réduction automatique si trop de caractères -->
        <div class="line nom"    data-min-scale="0.50" data-char-threshold="22">${nom.toUpperCase()}</div>
        <div class="line prenom" data-min-scale="0.46">${prenom}</div>

        <!-- Affiche TOUJOURS les deux champs (vides si Excel n’envoie rien) -->
        <div class="line points"    data-min-scale="0.50">${points}</div>
        <div class="line reduction" data-min-scale="0.50">${reduction}</div>
      </div>
    </div>
    <div class="info">
      ${['Code: ' + code, (points!=='' ? 'Points: ' + points : null), (reduction!=='' ? 'Réduction: ' + reduction : null)].filter(Boolean).join(' • ')}
    </div>
  </div>

  <script>
    // Fit‑to‑width + préscalage par longueur de texte (1 ligne)
    (function(){
      function fitToWidth(el, opts){
        opts = opts || {};
        var minScale  = typeof opts.minScale === 'number' ? opts.minScale : 0.45;
        var precision = typeof opts.precision === 'number' ? opts.precision : 0.12;
        var charTh    = typeof opts.charThreshold === 'number' ? opts.charThreshold : 22;

        // reset
        el.style.fontSize = '';
        el.style.letterSpacing = '';

        var cs   = getComputedStyle(el);
        var base = parseFloat(cs.fontSize);
        var w    = el.clientWidth || el.getBoundingClientRect().width || 0;
        if (!w || !base) return;

        // 1) Pré‑réduction si trop de caractères (espaces pondérés 0.5)
        var txt    = (el.textContent || '').trim();
        var spaces = (txt.match(/\\s/g) || []).length;
        var wlen   = txt.length - spaces + Math.ceil(spaces * 0.5); // longueur "pondérée"
        var pre    = 1;
        if (wlen > charTh) pre = charTh / wlen; // ex: 30 car. → 22/30 = 0.733
        pre = Math.max(pre, minScale);

        // 2) Bisection entre base*minScale et base*pre
        var lo = base * minScale, hi = base * pre, best = lo;

        el.style.fontSize = hi + 'px';
        if (el.scrollWidth <= w) {
          best = hi;
        } else {
          for (var i=0; i<26 && (hi - lo) > precision; i++) {
            var mid = (hi + lo) / 2;
            el.style.fontSize = mid + 'px';
            if (el.scrollWidth <= w) { best = mid; hi = mid; } else { lo = mid; }
          }
        }
        el.style.fontSize = best + 'px';

        // 3) Si ça déborde encore, resserrer l'interlettrage puis affiner la taille
        if (el.scrollWidth > w) {
          var ls = 0, step = 0;
          while (el.scrollWidth > w && step < 6) { // jusqu’à ~ -1.2px
            ls -= 0.2; step++;
            el.style.letterSpacing = ls + 'px';
          }
          var guard = 0;
          while (el.scrollWidth > w && guard < 6) {
            var f = parseFloat(el.style.fontSize) * 0.97;
            el.style.fontSize = f + 'px';
            guard++;
          }
        }
      }

      function fitAll(scope){
        scope = scope || document;
        var nodes = scope.querySelectorAll('.line.nom, .line.prenom, .line.points, .line.reduction');
        nodes.forEach(function(el){
          var ms = parseFloat(el.getAttribute('data-min-scale')) || 0.45;
          var ct = parseFloat(el.getAttribute('data-char-threshold')) || 22;
          fitToWidth(el, {minScale: ms, charThreshold: ct});
        });
      }

      function runFit(){
        // 1) Ajuste la marge droite (—r-nom) en fonction de la longueur du Nom
        var carte = document.querySelector('.carte');
        var nomEl = document.querySelector('.line.nom');
        if (carte && nomEl) {
          var txt = (nomEl.textContent || '').trim();
          var spaces = (txt.match(/\\s/g) || []).length;
          var wlen = txt.length - spaces + Math.ceil(spaces * 0.5); // espaces = 0.5
          carte.classList.toggle('tight-nom',   wlen >= 20 && wlen < 26);
          carte.classList.toggle('tighter-nom', wlen >= 26);
        }

        // 2) Fit après avoir posé la classe (largeur correcte)
        fitAll();
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
  console.log(`🚀 Serveur démarré sur ${protocol}://${host}`);
  if (!process.env.SECRET) {
    console.warn("⚠️  SECRET non défini — utilisez une variable d'environnement en production.");
  }
});
