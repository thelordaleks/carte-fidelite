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

// JSON
app.use(express.json());

// Fichiers statiques
app.use("/static", express.static(path.join(__dirname, "static")));
["logo-mdl.png", "carte-mdl.png", "carte-mdl-mail.png"].forEach((f) => {
  const p = path.join(__dirname, "static", f);
  console.log(fs.existsSync(p) ? "✅ Fichier présent:" : "⚠️  Fichier manquant:", f);
});

// Mémoire (pour /card/:id legacy)
const cartes = {};
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ======== API appelée depuis Excel ========
app.post("/api/create-card", (req, res) => {
  const raw = req.body || {};
  const { nom, prenom, email, code } = raw;
  if (!nom || !prenom || !code) {
    return res.status(400).json({ error: "Champs manquants (nom, prenom, code)" });
  }

  // Mapping tolérant colonnes G/H
  const pointsRaw =
    raw.points ?? raw.cumul ?? raw.cumul_points ?? raw["Cumul de points"] ?? raw["Cumul points"] ??
    raw["Points cumulés"] ?? raw["Points"] ?? raw["G"] ?? raw["g"];

  const reductionRaw =
    raw.reduction ?? raw.reduction_fidelite ?? raw.reduc ?? raw["Réduction Fidélité"] ?? raw["Reduction Fidélité"] ??
    raw["Réduction fidelité"] ?? raw["Réduction"] ?? raw["Réduc"] ?? raw["H"] ?? raw["h"];

  const points = (pointsRaw ?? "").toString().trim();
  const reduction = (reductionRaw ?? "").toString().trim();

  const id = uuidv4();
  const data = { nom, prenom, email: email || null, code, points, reduction };
  cartes[id] = data;

  const token = jwt.sign(data, SECRET, { expiresIn: "365d" });
  const host = process.env.RENDER_EXTERNAL_HOSTNAME || req.headers.host || `localhost:${PORT}`;
  const protocol = host.includes("localhost") ? "http" : "https";
  const urlSigned = `${protocol}://${host}/card/t/${encodeURIComponent(token)}`;
  const urlLegacy = `${protocol}://${host}/card/${id}`;

  console.log("✅ Carte générée:", prenom, nom, "→", urlSigned);
  console.log("ℹ️ Points/Reduc reçus:", { points, reduction });

  res.json({ url: urlSigned, legacy: urlLegacy });
});

// ======== Code‑barres ========
app.get("/barcode/:code", (req, res) => {
  const includeText = req.query.text === "1";
  bwipjs.toBuffer(
    {
      bcid: "code128",
      text: req.params.code,
      scale: 3,
      height: 12,           // un peu plus haut que 10 pour un meilleur rendu
      includetext: includeText,
      textxalign: "center",
      backgroundcolor: "FFFFFF",
    },
    (err, png) => {
      if (err) return res.status(500).send("Erreur génération code‑barres");
      res.type("image/png").send(png);
    }
  );
});

// ======== Affichage carte — lien signé ========
app.get("/card/t/:token", (req, res) => {
  let data;
  try {
    data = jwt.verify(req.params.token, SECRET);
  } catch {
    return res.status(404).send("<h1>Carte introuvable ❌</h1>");
  }

  const prenom = (data.prenom || "").trim();
  const nom = (data.nom || "").trim();
  const code = (data.code || "").trim();
  const points = (data.points ?? "").toString().trim();
  const reduction = (data.reduction ?? "").toString().trim();

  // Image de fond
  const bg = (req.query.bg || "").toLowerCase() === "mail" ? "carte-mdl-mail.png" : "carte-mdl.png";
  const debug = req.query.debug === "1";

  // Calages (en % de la hauteur de la carte) — ajustables via query
  const yBarcode   = parseFloat(req.query.y_barcode)   || 38; // position du haut du code‑barres
  const hBarcode   = parseFloat(req.query.h_barcode)   || 22; // hauteur du code‑barres
  const yRowsStart = parseFloat(req.query.y_rows)      || 64; // ligne “Nom/Prénom”
  const rowGap     = parseFloat(req.query.row_gap)     || 7;  // écart entre les deux lignes
  const yMetrics   = parseFloat(req.query.y_metrics)   || 79; // ligne points/réduc
  const padPct     = parseFloat(req.query.pad)         || 6;  // padding gauche/droite %

  res.send(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Carte fidélité</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root{
      --card-ratio: 1.586;             /* 85.6 x 53.98 */
      --w: 360px;                       /* largeur max carte */
      --fg: #111;
      --muted: #3a3a3a;
      --pill-bg: #f5c978;               /* jaune pâle (à rapprocher de ton fond aquarelle) */
      --badge-bg: #f5c978;
      --radius: 14px;
      --pad-pct: ${padPct}%;
      --y-barcode: ${yBarcode}%;
      --h-barcode: ${hBarcode}%;
      --y-rows: ${yRowsStart}%;
      --row-gap: ${rowGap}%;
      --y-metrics: ${yMetrics}%;
    }
    *{ box-sizing:border-box; }
    html,body{ margin:0; padding:0; background:#f5f6f8; color:var(--fg); font-family: Arial, Helvetica, sans-serif; }
    .wrap{ display:flex; flex-direction:column; align-items:center; gap:14px; padding:16px; }

    .carte{
      position:relative;
      width:min(92vw, var(--w));
      aspect-ratio: var(--card-ratio);
      border-radius: var(--radius);
      background:#eee url("/static/${bg}") center/cover no-repeat;
      box-shadow: 0 10px 28px rgba(0,0,0,.12);
      overflow:hidden;
    }
    .layer{ position:absolute; inset:0; }
    .zone{
      position:absolute;
      left: var(--pad-pct);
      right: var(--pad-pct);
      z-index:2; /* texte au-dessus du code‑barres */
    }

    /* Code‑barres */
    .barcode{ top: var(--y-barcode); height: var(--h-barcode); z-index:1; left: var(--pad-pct); right: var(--pad-pct); display:flex; align-items:center; }
    .barcode img{ width:100%; height:100%; object-fit:contain; background:#fff; border-radius:8px; }

    /* Lignes Nom / Prénom comme sur ta 1re image */
    .rows{ top: var(--y-rows); }
    .row{ display:flex; align-items:center; gap:10px; margin-bottom: calc(var(--row-gap)); }
    .label{
      flex:0 0 auto;
      min-width: 64px;
      color:#2b2b2b;
      font-size: clamp(12px, 3.6vw, 16px);
      font-style: italic;
      opacity:.92;
      text-shadow: 0 0 1px rgba(255,255,255,.55);
    }
    .pill{
      position:relative;
      flex:1 1 auto;
      background: var(--pill-bg);
      border-radius: 999px;
      padding: 6px 12px;
      min-height: 28px;
      display:flex; align-items:center;
      overflow:hidden;
      white-space: nowrap; /* Sur PC on veut 1 ligne propre */
    }
    .pill .fit{
      display:inline-block;
      line-height:1.15;
      font-weight: 800;
      letter-spacing:.2px;
      transform-origin:left center;
      will-change: font-size;
    }

    .pill.nom .fit{ text-transform: uppercase; }
    .pill.prenom .fit{ font-weight: 700; text-transform: none; }

    /* Points / Réduc en petites pastilles comme sur l’exemple */
    .metrics{ top: var(--y-metrics); display:flex; gap:14px; align-items:center; }
    .badge{
      background: var(--badge-bg);
      border-radius: 12px;
      padding: 6px 10px;
      font-weight: 800;
      display:inline-flex; align-items:center; gap:8px;
      white-space: nowrap;
      max-width: 45%;
      overflow:hidden;
    }
    .badge .fit{ display:inline-block; line-height:1.1; transform-origin:left center; }

    /* Debug */
    ${debug ? `
      .barcode{ outline: 1px dashed rgba(0,128,255,.6); }
      .rows, .metrics{ outline: 1px dashed rgba(255,0,0,.6); }
      .pill, .badge{ outline: 1px dashed rgba(0,0,0,.35); }
    ` : ""}

    /* Apparition après fit */
    body:not(.fitted) .carte .fit{ opacity:0; }
    body.fitted .carte .fit{ opacity:1; transition:opacity .18s ease; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="carte">
      <div class="layer barcode">
        <img alt="code-barres" src="/barcode/${encodeURIComponent(code)}" />
      </div>

      <div class="layer rows zone">
        <div class="row">
          <span class="label">Nom :</span>
          <span class="pill nom"><span class="fit nom" data-min="0.36" data-max="26">${esc(nom).toUpperCase()}</span></span>
        </div>
        <div class="row">
          <span class="label">Prénom :</span>
          <span class="pill prenom"><span class="fit prenom" data-min="0.42" data-max="22">${esc(prenom)}</span></span>
        </div>
      </div>

      <div class="layer metrics zone">
        <span class="badge"><span class="fit points" data-min="0.6" data-max="18">Points: ${esc(points || "0")}</span></span>
        <span class="badge"><span class="fit reduction" data-min="0.6" data-max="18">Réduction: ${esc(reduction || "0,00 €")}</span></span>
      </div>
    </div>

    <div style="font-size:14px;color:#333;opacity:.9;text-align:center">
      Code: <b>${esc(code)}</b> • Points: ${esc(points || "0")} • Réduction: ${esc(reduction || "0,00 €")}
    </div>
  </div>

  <script>
    // Ajuste UNIQUEMENT la taille de police pour faire tenir sur 1 ligne à l'intérieur des pastilles
    (function(){
      function fit(el){
        if(!el) return;
        // Taille maximale depuis data-max (px) ou font-size courante
        const maxPx = parseFloat(el.getAttribute('data-max')) || parseFloat(getComputedStyle(el).fontSize) || 24;
        const minScale = parseFloat(el.getAttribute('data-min')) || 0.36; // proportion minimale vs maxPx
        const parent = el.parentElement;
        if(!parent) return;

        // On part du max puis on diminue
        let lo = maxPx * minScale;
        let hi = maxPx;
        let best = lo;

        el.style.fontSize = hi + 'px';
        const boxW = parent.clientWidth;
        if(!boxW) return;

        // Si ça rentre déjà au max → fini
        if (el.scrollWidth <= boxW) {
          best = hi;
        } else {
          // Dichotomie
          let guard = 0;
          while(guard++ < 30 && (hi - lo) > 0.2){
            const mid = (hi + lo) / 2;
            el.style.fontSize = mid + 'px';
            if (el.scrollWidth <= boxW) { best = mid; hi = mid; }
            else { lo = mid; }
          }
        }
        el.style.fontSize = best + 'px';
      }

      function fitAll(){
        document.querySelectorAll('.pill .fit, .badge .fit').forEach(fit);
      }

      if (document.fonts && document.fonts.ready) { document.fonts.ready.then(fitAll); }
      window.addEventListener('load', fitAll);
      window.addEventListener('resize', fitAll);
      window.addEventListener('orientationchange', fitAll);
      window.fitNow = fitAll; // debug
      document.body.classList.add('fitted');
    })();
  </script>
</body>
</html>`);
});

// ======== Affichage carte — ancien lien mémoire ========
app.get("/card/:id", (req, res) => {
  const carte = cartes[req.params.id];
  if (!carte) return res.status(404).send("<h1>Carte introuvable ❌</h1>");
  const token = jwt.sign(carte, SECRET, { expiresIn: "365d" });
  res.redirect(302, `/card/t/${encodeURIComponent(token)}`);
});

// ======== Page d’accueil ========
app.get("/", (_req, res) => {
  res.send(`<html><head><title>Serveur Carte Fidélité MDL</title></head>
  <body style="font-family:Arial,Helvetica,sans-serif;text-align:center;padding:36px">
    <h2>✅ Serveur MDL en ligne</h2>
    <ul style="list-style:none;padding:0;line-height:1.8">
      <li>/api/create-card — API pour Excel (retourne une URL signée)</li>
      <li>/card/t/:token — Afficher la carte (options: ?bg=mail&debug=1&y_barcode=38&h_barcode=22&y_rows=64&row_gap=7&y_metrics=79&pad=6)</li>
      <li>/card/:id — Ancien lien (redirige vers le lien signé)</li>
      <li>/barcode/:code — Générer un code‑barres</li>
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
