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

  res.json({ ok: true, url: urlSigned, id });
});

// ======== Code-barres ========
app.get("/barcode/:code", async (req, res) => {
  try {
    const code = String(req.params.code || "").trim();
    const showText = String(req.query.text || "0") === "1";

    const png = await bwipjs.toBuffer({
      bcid: "code128",
      text: code,
      scale: 3,
      height: 12,
      includetext: showText,
      textxalign: "center",
      textsize: 10,
      paddingwidth: 8,
      paddingheight: 8,
      backgroundcolor: "FFFFFF",
    });

    res.type("png").send(png);
  } catch (e) {
    res.status(400).send("Barcode error");
  }
});

// ======== Affichage carte — LIEN SIGNÉ (stateless) ========
app.get("/card/t/:token", (req, res) => {
  let data;
  try {
    data = jwt.verify(req.params.token, SECRET);
  } catch (e) {
    return res.status(400).send("<h1>Token invalide ❌</h1>");
  }

  // Helpers
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const nom = esc(data.nom);
  const prenom = esc(data.prenom);
  const email = esc(data.email || "");
  const code = esc(data.code);
  const points = esc(data.points || "");
  const reduction = esc(data.reduction || "");

  const bg = req.query.bg === "mail" ? "carte-mdl-mail.png" : "carte-mdl.png";
  const debug = String(req.query.debug || "0") === "1";

  res.send(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Carte MDL</title>
  <style>
    :root{
      --w: 960px;
      --pad: 32px;
      --pill-bg: #f4c98c;
      --pill-txt: #1e1e1e;
    }
    html,body{ margin:0; padding:0; }
    body{
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      background:#f2f3f5;
      display:flex; align-items:flex-start; justify-content:center;
      min-height:100vh;
    }
    .wrap{ padding:24px; }
    .carte{
      position:relative;
      width: var(--w);
      max-width: 100vw;
      border-radius: 18px;
      box-shadow: 0 10px 30px rgba(0,0,0,.12);
      overflow:hidden;
      background:#fff;
    }
    .bg{
      width:100%; display:block;
      user-select:none; pointer-events:none;
    }

    .layer{ position:absolute; inset:0; padding:var(--pad); }
    .grid{
      position:relative; width:100%; height:100%;
      display:grid; grid-template-rows: auto auto auto 1fr auto; gap:16px;
    }

    /* Barre code-barres */
    .barcode{ text-align:center; margin-top:4px; }
    .barcode img{ width:86%; max-width:820px; height:auto; }

    /* Lignes Nom / Prénom */
    .row{ display:flex; align-items:center; gap:14px; }
    .label{
      font-size:28px; color:#1d1d1d; font-family: "Times New Roman", serif;
    }
    .pill{
      background: var(--pill-bg);
      color: var(--pill-txt);
      border-radius: 20px;
      padding: 10px 16px;
      display:inline-flex; align-items:center;
      max-width: 720px; width: 72%;
      box-shadow: inset 0 0 0 1px rgba(0,0,0,.05);
    }
    .pill.small{
      min-width: 140px; width:auto; padding:12px 18px; text-align:center;
      font-weight:600; font-size:24px;
    }
    .line{ display:inline-block; white-space:nowrap; font-weight:800; letter-spacing:.3px; }
    .line.nom{ font-size:18px; }     /* base, sera AJUSTÉE par le script */
    .line.prenom{ font-size:36px; }  /* base, sera AJUSTÉE par le script */

    .bottom{
      display:flex; align-items:center; justify-content:space-between; gap:16px;
      margin-top:6px;
    }

    .meta{ font-size:13px; color:#3a3a3a; text-align:center; opacity:.9; padding:6px 0 14px; }

    /* Debug (option ?debug=1) */
    ${debug ? `
    .row, .pill, .barcode, .bottom{ outline:1px dashed rgba(0,128,255,.4); }
    .line{ outline:1px dotted rgba(255,0,0,.4); }
    ` : ``}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="carte">
      <img class="bg" src="/static/${bg}" alt="fond">
      <div class="layer">
        <div class="grid">
          <div class="barcode">
            <img src="/barcode/${code}?text=1" alt="code-barres">
          </div>

          <div class="row">
            <div class="label">Nom :</div>
            <div class="pill">
              <span class="line nom">${nom}</span>
            </div>
          </div>

          <div class="row">
            <div class="label">Prénom :</div>
            <div class="pill">
              <span class="line prenom">${prenom}</span>
            </div>
          </div>

          <div class="bottom">
            <div class="pill small">${points || "&nbsp;"}</div>
            <div class="pill small">${reduction ? esc(reduction) + " €" : "&nbsp;"}</div>
          </div>

          <div class="meta">
            Code: ${code}${points ? " • Points: " + points : ""}${reduction ? " • Réduction: " + reduction + " €" : ""}${email ? " • " + email : ""}
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Seule modification: ajuster UNIQUEMENT la taille de Nom/Prénom -->
  <script>
  (function(){
    function fitOneLine(el, opts){
      opts = opts || {};
      var minScale = opts.minScale || 0.5;   // réduction max autorisée
      var grow     = opts.grow ?? 1.0;       // >1 = autorise l'agrandissement
      var padPx    = opts.padPx || 0;        // marge de sécu à droite

      if(!el) return;

      // Limite STRICTE aux deux champs
      el.style.whiteSpace = 'nowrap';
      el.style.display = 'inline-block';

      var parent = el.parentElement;
      var w = (parent && parent.clientWidth ? parent.clientWidth : el.clientWidth || el.getBoundingClientRect().width || 0) - padPx;
      if (w <= 0) return;

      var base = parseFloat(getComputedStyle(el).fontSize) || 16;
      var lo = base * minScale;
      var hi = base;

      // Démarre à la taille actuelle
      el.style.fontSize = hi + 'px';

      // Si ça tient et qu'on peut grandir → on pousse doucement jusqu'à la limite
      if (el.scrollWidth < w && grow > 1) {
        var hardCap = base * grow;
        while (el.scrollWidth < w && hi < hardCap) {
          lo = hi;
          hi = Math.min(hardCap, hi * 1.12); // incréments ~12%
          el.style.fontSize = hi + 'px';
        }
      }

      // Binaire pour coller au bord sans dépasser
      for (var i = 0; i < 28; i++){
        var mid = (hi + lo) / 2;
        el.style.fontSize = mid + 'px';
        if (el.scrollWidth <= w) { lo = mid; } else { hi = mid; }
        if (Math.abs(hi - lo) < 0.2) break;
      }
      el.style.fontSize = Math.max(lo, base*minScale) + 'px';
    }

    function run(){
      // NOM: peut grandir jusqu’à +60%, avec 8px de marge de sécu
      fitOneLine(document.querySelector('.line.nom'),    { minScale:0.50, grow:1.60, padPx:8 });
      // PRÉNOM: réduit si besoin, ne grandit pas
      fitOneLine(document.querySelector('.line.prenom'), { minScale:0.55, grow:1.00, padPx:8 });
    }

    if (document.fonts && document.fonts.ready) document.fonts.ready.then(run);
    window.addEventListener('load', run);
    window.addEventListener('resize', run);
    window.addEventListener('orientationchange', run);

    // pour relancer après modif DOM si besoin
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
