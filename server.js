// ======== Dépendances ========
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const bwipjs = require("bwip-js"); // génération code-barres
const jwt = require("jsonwebtoken");

// ======== Configuration ========
const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET || "dev-secret-change-me";

// ======== Middlewares ========
app.use(express.json());
app.use("/static", express.static(path.join(__dirname, "static")));

// Vérif fichiers statiques utiles (optionnel mais pratique)
["carte-mdl.png", "carte-mdl-mail.png", "logo-mdl.png"].forEach((f) => {
  const p = path.join(__dirname, "static", f);
  console.log(fs.existsSync(p) ? "✅ Fichier présent:" : "⚠️  Fichier manquant:", f);
});

// ======== Mémoire (pour ancien /card/:id) ========
const cartes = Object.create(null);

// ======== Utils ========
// Base URL (support proxy) pour renvoyer des liens absolus
function baseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0];
  return `${proto}://${req.get("host")}`;
}
// Echappement HTML simple (XSS)
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

// ======== API appelée depuis Excel / Power Automate ========
app.post("/api/create-card", (req, res) => {
  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ ok: false, error: "Requête JSON invalide" });
  }

  const raw = req.body;

  const nom      = (raw.nom ?? raw.Nom ?? raw.NOM ?? "").toString().trim();
  const prenom   = (raw.prenom ?? raw.Prénom ?? raw.Prenom ?? raw.PRENOM ?? "").toString().trim();
  const email    = (raw.email ?? raw.Email ?? raw.E-mail ?? "").toString().trim();
  const code     = (raw.code ?? raw.Code ?? raw.CODE ?? raw["Code adhérent"] ?? raw["Code"] ?? "").toString().trim();

  // Tolérance colonnes points / réduction
  const pointsRaw =
    raw.points ?? raw.cumul ?? raw.cumul_points ?? raw["Cumul de points"] ?? raw["Cumul points"] ??
    raw["Points cumulés"] ?? raw["Points"] ?? raw["G"] ?? raw["g"] ?? "";

  const reductionRaw =
    raw.reduction ?? raw.reduction_fidelite ?? raw.reduc ?? raw["Réduction Fidélité"] ??
    raw["Reduction Fidélité"] ?? raw["Réduction fidelité"] ?? raw["Réduction"] ?? raw["Réduc"] ??
    raw["H"] ?? raw["h"] ?? "";

  const points = String(pointsRaw).trim();
  const reduction = String(reductionRaw).trim();

  if (!nom || !prenom || !code) {
    return res.status(400).json({ ok: false, error: "Champs manquants (nom, prenom, code)" });
  }

  // Données carte
  const carte = {
    nom, prenom, email, code, points, reduction,
    createdAt: new Date().toISOString(),
  };

  // Lien signé (stateless)
  const token = jwt.sign(carte, SECRET, { expiresIn: "365d" });
  const signedUrl = `${baseUrl(req)}/card/t/${encodeURIComponent(token)}`;

  // Compat ancien: id mémoire
  const id = uuidv4();
  cartes[id] = carte;

  return res.json({
    ok: true,
    id,
    url: signedUrl,
    token,
    legacyUrl: `${baseUrl(req)}/card/${id}`,
    data: carte,
  });
});

// ======== Code-barres PNG ========
// Ex: /barcode/ADH10249HBsD?text=1&scale=4&height=28
app.get("/barcode/:code", async (req, res) => {
  try {
    const code = String(req.params.code || "");
    const scale = Math.min(8, Math.max(1, parseInt(req.query.scale, 10) || 4));   // plus grand = plus net
    const height = Math.min(60, Math.max(10, parseInt(req.query.height, 10) || 28)); // hauteur en "bar units"
    const includeText = req.query.text === "1";

    const png = await bwipjs.toBuffer({
      bcid: "code128",
      text: code,
      scale,
      height,
      includetext: includeText,
      textxalign: "center",
      backgroundcolor: "FFFFFF",
      // padding minimal pour éviter rognage des bords
      paddingwidth: 4,
      paddingheight: 0,
      textsize: 10,
      textyoffset: 2,
    });

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400"); // 1 jour
    return res.end(png);
  } catch (err) {
    console.error("Erreur barcode:", err);
    return res.status(500).send("Erreur génération code-barres");
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

  const bg = (String(req.query.bg || "")).toLowerCase() === "mail" ? "carte-mdl-mail.png" : "carte-mdl.png";
  const debug = req.query.debug === "1";

  const nomUpper = nom.toUpperCase();

  res.send(`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Carte de fidélité MDL</title>
<style>
:root{
  --maxw: 980px;

  /* Bandeau code-barres (corrigé mobile) */
  --y-bar: 40%;   /* position verticale du centre du bandeau */
  --h-bar: 50%;   /* hauteur du bandeau */

  /* Positions textes */
  --y-nom:    66%;
  --y-prenom: 76%;
  --y-points: 86%;
  --y-reduc:  86%;

  --x-nom:     24%;
  --x-prenom:  24%;
  --r-nom:     35%;
  --r-prenom:  35%;

  --x-points:  26%;
  --w-points:  17%;
  --x-reduc:   45%;
  --w-reduc:   17%;

  --bar-l: 8%;
  --bar-r: 8%;

  --ty-nom:   -50%;
  --ty-prenom:-50%;
}

/* Ajuste légèrement sur petits écrans */
@media (max-width: 480px){
  :root{
    --y-bar: 39%;
    --h-bar: 24%;
  }
}

*{box-sizing:border-box}
body{
  margin:0;
  background:#f2f2f2;
  font-family: system-ui, -apple-system, Segoe UI, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
.page{
  max-width:var(--maxw);
  margin:16px auto;
  padding:12px;
}
.carte{
  position:relative;
  border-radius:18px;
  box-shadow:0 10px 26px rgba(0,0,0,.12);
  overflow:hidden;
  background:#fff;
}
.carte > img.bg{
  display:block;
  width:100%;
  height:auto;
  pointer-events:none;
  user-select:none;
}

/* Code-barres — bandeau centré avec hauteur fixée */
.barcode{
  position:absolute;
  left:var(--bar-l); right:var(--bar-r);
  top:var(--y-bar);
  height:var(--h-bar);
  transform: translateY(-50%);
  display:flex; align-items:center; justify-content:center;
}
.barcode img{
  height:100%;
  width:auto;
  max-width:86%;
  filter: drop-shadow(0 1px 0 rgba(255,255,255,.45));
}

/* Lignes textes */
.line{
  position:absolute;
  left:0; right:0;
  padding:0 .5rem;
  color:#1c2430;
  text-shadow: 0 2px 0 rgba(255,255,255,.6);
  font-weight:800;
  letter-spacing:.5px;
  white-space:nowrap;
  transform: translateY(-50%);
}
.line .pill{
  display:inline-block;
  padding:.18em .4em;
  background:rgba(255,255,255,.55);
  backdrop-filter:saturate(1.2) blur(1px);
  border-radius:999px;
  box-shadow: inset 0 0 0 2px rgba(16,30,44,.18), 0 1px 0 rgba(255,255,255,.8);
}

/* NOM / PRÉNOM */
.line.nom{
  top:var(--y-nom);
  left:var(--x-nom);
  right:var(--r-nom);
  transform: translateY(var(--ty-nom));
  font-size: clamp(14px, 5.6vw, 36px);
}
.line.prenom{
  top:var(--y-prenom);
  left:var(--x-prenom);
  right:var(--r-prenom);
  transform: translateY(var(--ty-prenom));
  font-size: clamp(13px, 4.8vw, 28px);
  font-weight:900;
}

/* Points & Réduction */
.meta{
  position:absolute;
  top:var(--y-points);
  transform: translateY(-50%);
  font-family: Georgia, 'Times New Roman', serif;
  font-size: clamp(12px, 3.2vw, 20px);
  color:#1a2230;
  text-shadow: 0 1px 0 rgba(255,255,255,.6);
  white-space:nowrap;
}
.meta.points{
  left:var(--x-points);
  width:var(--w-points);
  text-align:center;
}
.meta.reduc{
  left:var(--x-reduc);
  width:var(--w-reduc);
  text-align:center;
}

/* Ligne d'info en bas */
.footer{
  margin:.6rem auto 0;
  font-size:12px;
  color:#4a5568;
  text-align:center;
}

/* Debug */
body.debug .barcode{ outline:1px dashed rgba(0,0,0,.35); }
body.debug .line{ outline:1px dashed rgba(255,0,0,.35); }
body.debug .meta{ outline:1px dashed rgba(0,128,0,.35); }
</style>
</head>
<body class="${debug ? "debug" : ""}">
  <div class="page">
    <div class="carte">
      <img class="bg" src="/static/${bg}" alt="Carte MDL">
      <div class="barcode">
        <img src="/barcode/${encodeURIComponent(encodeURIComponent(code))}?scale=4&height=28" alt="Code-barres">
      </div>

      <div class="line nom">
        <span class="pill">${esc(nomUpper)}</span>
      </div>
      <div class="line prenom">
        <span class="pill">${esc(prenom)}</span>
      </div>

      <div class="meta points"><span>${esc(points || "0")}</span></div>
      <div class="meta reduc" style="left:var(--x-reduc);width:var(--w-reduc);">
        <span>${esc(reduction || "0,00 €")}</span>
      </div>
    </div>

    <div class="footer">
      Code: ${esc(code)} • Points: ${esc(points || "0")} • Réduction: ${esc(reduction || "0,00 €")}
    </div>
  </div>

<script>
// Ajustement simple pour que NOM/PRÉNOM rentrent dans leur zone
(function(){
  function fitToWidth(el, opts){
    if (!el) return;
    var minScale = (opts && opts.minScale) || 0.5;
    var threshold = (opts && opts.charThreshold) || 22;
    // On évite de réduire pour les noms courts
    var text = el.textContent || "";
    var scale = 1;

    function availWidth(node){
      var rect = node.getBoundingClientRect();
      var left = parseFloat(getComputedStyle(node).paddingLeft) || 0;
      var right = parseFloat(getComputedStyle(node).paddingRight) || 0;
      return rect.width - left - right;
    }

    // Reset
    el.style.transform = "none";
    el.style.transformOrigin = "left center";

    var wAvail = availWidth(el.parentElement || el);
    if (!wAvail) return;

    // Mesure brute
    var scrollW = el.scrollWidth;

    if (scrollW > wAvail) {
      scale = Math.max(minScale, Math.min(1, wAvail / scrollW));
      el.style.transform = "scale(" + scale + ")";
    } else {
      // si très long (beaucoup de lettres), on resserre un poil
      if (text.trim().length > threshold) {
        scale = Math.max(minScale, 0.94);
        el.style.transform = "scale(" + scale + ")";
      }
    }
  }

  function runFit(){
    var nom = document.querySelector(".line.nom .pill");
    var prenom = document.querySelector(".line.prenom .pill");
    [nom, prenom].forEach(function(n){
      fitToWidth(n, { minScale: 0.45, charThreshold: 22 });
    });
  }

  if (document.fonts && document.fonts.ready) { document.fonts.ready.then(runFit); }
  window.addEventListener("load", runFit);
  window.addEventListener("resize", runFit);
  window.addEventListener("orientationchange", runFit);
  window.fitNow = runFit; // debug manuel
})();
</script>
</body>
</html>`);
});

// ======== Affichage carte — ANCIEN LIEN (mémoire → redirection) ========
app.get("/card/:id", (req, res) => {
  const carte = cartes[req.params.id];
  if (!carte) return res.status(404).send("<h1>Carte introuvable ❌</h1>");
  const token = jwt.sign(carte, SECRET, { expiresIn: "365d" });
  res.redirect(302, `/card/t/${encodeURIComponent(token)}`);
});

// ======== Pages simples de test ========
app.get("/new", (_req, res) => {
  res.send(`<html><head><title>Test Carte MDL</title><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="text-align:center;font-family:Arial;margin:24px">
    <h2>Carte de fidélité test MDL</h2>
    <img src="/static/carte-mdl.png" style="width:320px;border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,.15)">
  </body></html>`);
});

app.get("/", (_req, res) => {
  res.send(`<html><head><title>Serveur Carte Fidélité MDL</title><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="font-family:Arial;text-align:center;padding:40px">
    <h2>✅ Serveur MDL en ligne</h2>
    <ul style="list-style:none; padding:0; line-height:1.8">
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
