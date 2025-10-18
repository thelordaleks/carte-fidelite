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

// Helper d’échappement HTML
function esc(s) {
  s = s == null ? "" : String(s);
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

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

  const prenom = (carte.prenom || "").trim();
  const nom = (carte.nom || "").trim();
  const code = (carte.code || "").trim();
  const points = (carte.points ?? "").toString().trim();
  const reduction = (carte.reduction ?? "").toString().trim();

  const bg = (req.query.bg || "").toLowerCase() === "mail" ? "carte-mdl-mail.png" : "carte-mdl.png";
  const debug = req.query.debug === "1";

  // Positions par défaut (en % de la hauteur) — ajustables via query string
  const yPrenom     = Number.parseFloat(req.query.y_prenom)     || 18;  // ex: 18%
  const yNom        = Number.parseFloat(req.query.y_nom)        || 28;  // ex: 28%
  const yBarcode    = Number.parseFloat(req.query.y_barcode)    || 42;  // ex: 42%
  const hBarcode    = Number.parseFloat(req.query.h_barcode)    || 20;  // ex: 20% de la hauteur
  const yPoints     = Number.parseFloat(req.query.y_points)     || 72;  // ex: 72%
  const yReduction  = Number.parseFloat(req.query.y_reduction)  || 80;  // ex: 80%

  res.send(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Carte fidélité</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root{
      --card-ratio: 1.586; /* CR80 85.6x53.98 */
      --w: 360px;
      --pad: 16px;
      --fg: #111;
      --muted: #444;
    }
    *{box-sizing:border-box}
    body{margin:0;padding:16px;font-family: Arial, Helvetica, sans-serif;background:#f5f5f7;color:#111}
    .wrap{display:flex;justify-content:center}
    .carte{
      position:relative;
      width: min(92vw, var(--w));
      aspect-ratio: var(--card-ratio);
      border-radius: 14px;
      background: #ddd url("/static/${bg}") center/cover no-repeat;
      overflow: hidden;
      box-shadow: 0 8px 30px rgba(0,0,0,.12);
      /* Variables de placement (en %) */
      --y-prenom: ${yPrenom}%;
      --y-nom: ${yNom}%;
      --y-barcode: ${yBarcode}%;
      --h-barcode: ${hBarcode}%;
      --y-points: ${yPoints}%;
      --y-reduction: ${yReduction}%;
    }
    .layer{position:absolute; inset:0}
    .zone{
      position:absolute;
      left: var(--pad);
      right: var(--pad);
      color: var(--fg);
      overflow: hidden;
      white-space: nowrap; /* 1 ligne */
      z-index: 2; /* ⇧ texte AU-DESSUS du code-barres */
    }
    .prenom{ top: var(--y-prenom); font-weight:600; letter-spacing:.2px; opacity:.99 }
    .nom{ top: var(--y-nom); font-weight:800; letter-spacing:.3px; text-transform: uppercase; opacity:.99 }
    .points{ top: var(--y-points); color: var(--muted); font-weight:700 }
    .reduction{ top: var(--y-reduction); color: var(--muted); font-weight:700 }

    .line{ display:block; max-width:100%; overflow:hidden; text-overflow:ellipsis; }
    .line.prenom{ font-size: clamp(14px, 5vw, 22px); }
    .line.nom{    font-size: clamp(18px, 6.2vw, 28px); } /* maxi; JS réduit si nécessaire */
    .line.points, .line.reduction{ font-size: clamp(12px, 4.4vw, 18px); }

    .barcode-wrap{
      position:absolute; left: var(--pad); right: var(--pad);
      top: var(--y-barcode); height: var(--h-barcode);
      display:flex; align-items:center; justify-content:center;
      z-index: 1; /* ⇩ sous le texte */
    }
    .barcode-wrap img{ width: 100%; height: 100%; object-fit: contain; background:#fff; }

    ${debug ? `
    .zone, .barcode-wrap{ outline: 1px dashed rgba(255,0,0,.55); }
    .carte{ box-shadow: 0 0 0 3px rgba(255,0,0,.25) inset, 0 8px 30px rgba(0,0,0,.12); }
    ` : ""}

    body:not(.fitted) .line{ opacity: 0; }
    body.fitted .line{ opacity: 1; transition: opacity .15s ease-out; }
  </style>
</head>
<body class="${debug ? "debug" : ""}">
  <div class="wrap">
    <div class="carte">
      <div class="layer content">
        <!-- Lignes de texte -->
        <div class="zone prenom">
          <span class="line prenom" data-min-scale="0.46">${esc(prenom)}</span>
        </div>
        <div class="zone nom">
          <span class="line nom" data-min-scale="0.34">${esc(nom).toUpperCase()}</span>
        </div>

        <!-- Code-barres -->
        <div class="barcode-wrap">
          <img alt="code-barres" src="/barcode/${encodeURIComponent(code)}" />
        </div>

        <!-- Infos points / réduction -->
        <div class="zone points">
          <span class="line points" data-min-scale="0.50">Points: ${esc(points)}</span>
        </div>
        <div class="zone reduction">
          <span class="line reduction" data-min-scale="0.50">Réduction: ${esc(reduction)}</span>
        </div>
      </div>
    </div>
  </div>

  <script>
    (function(){
      // Fit d'une ligne: ajuste uniquement font-size pour tenir en largeur
      function fitOne(el, opts){
        opts = opts || {};
        var minScale  = typeof opts.minScale === 'number' ? opts.minScale : 0.34;
        var precision = typeof opts.precision === 'number' ? opts.precision : 0.10;
        if (!el) return;

        el.style.fontSize = ''; // repartir de la taille CSS
        var cs = getComputedStyle(el);
        var base = parseFloat(cs.fontSize);
        var boxW = el.clientWidth || el.getBoundingClientRect().width || 0;
        if (!base || !boxW) return;

        var lo = base * minScale;
        var hi = base;
        var best = lo;

        el.style.fontSize = hi + 'px';
        if (el.scrollWidth <= boxW) {
          best = hi;
        } else {
          for (var i = 0; i < 28 && (hi - lo) > precision; i++) {
            var mid = (hi + lo) / 2;
            el.style.fontSize = mid + 'px';
            if (el.scrollWidth <= boxW) { best = mid; hi = mid; } else { lo = mid; }
          }
        }
        el.style.fontSize = best + 'px';
      }

      function fitAll(scope){
        scope = scope || document;
        var nodes = scope.querySelectorAll('.line.nom, .line.prenom, .line.points, .line.reduction');
        nodes.forEach(function(el){
          var ms = parseFloat(el.getAttribute('data-min-scale'));
          if (!isFinite(ms)) {
            if (el.classList.contains('nom')) ms = 0.34;
            else if (el.classList.contains('prenom')) ms = 0.46;
            else ms = 0.50;
          }
          fitOne(el, { minScale: ms });
        });
      }

      function runFit(){ fitAll(); document.body.classList.add('fitted'); }

      if (document.fonts && document.fonts.ready) { document.fonts.ready.then(runFit); }
      window.addEventListener('load', runFit);
      window.addEventListener('resize', runFit);
      window.addEventListener('orientationchange', runFit);
      window.fitNow = runFit; // debug
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
      <li>/card/t/:token — Afficher une carte (stateless) — options:
        <br/>?bg=mail&debug=1
        <br/>&y_prenom=18&y_nom=28&y_barcode=42&h_barcode=20&y_points=72&y_reduction=80
      </li>
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
