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

// ======== Middlewares ========
app.use(express.json());
app.use("/static", express.static(path.join(__dirname, "static")));

// Vérification basique des assets
["carte-mdl.png", "carte-mdl-mail.png", "logo-mdl.png"].forEach((f) => {
  const p = path.join(__dirname, "static", f);
  console.log(fs.existsSync(p) ? "✅ Fichier présent:" : "⚠️  Fichier manquant:", f);
});

// ======== Mémoire (legacy /card/:id) ========
const cartes = Object.create(null);

// ======== Utils ========
function baseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0];
  return `${proto}://${req.get("host")}`;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

// ======== API pour Excel / Power Automate ========
app.post("/api/create-card", (req, res) => {
  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ ok: false, error: "Requête JSON invalide" });
  }
  const raw = req.body;

  const nom    = (raw.nom ?? raw.Nom ?? raw.NOM ?? "").toString().trim();
  const prenom = (raw.prenom ?? raw.Prénom ?? raw.Prenom ?? raw.PRENOM ?? "").toString().trim();
  const email  = (raw.email ?? raw.Email ?? raw["E-mail"] ?? "").toString().trim();
  const code   = (raw.code ?? raw.Code ?? raw.CODE ?? raw["Code adhérent"] ?? raw["Code"] ?? "").toString().trim();

  const pointsRaw =
    raw.points ?? raw.cumul ?? raw.cumul_points ?? raw["Cumul de points"] ?? raw["Cumul points"] ??
    raw["Points cumulés"] ?? raw["Points"] ?? raw["G"] ?? raw["g"] ?? "";

  const reducRaw =
    raw.reduction ?? raw.reduction_fidelite ?? raw.reduc ?? raw["Réduction Fidélité"] ??
    raw["Reduction Fidélité"] ?? raw["Réduction fidelité"] ?? raw["Réduction"] ?? raw["Réduc"] ??
    raw["H"] ?? raw["h"] ?? "";

  const points = String(pointsRaw).trim();
  const reduction = String(reducRaw).trim();

  if (!nom || !prenom || !code) {
    return res.status(400).json({ ok: false, error: "Champs manquants (nom, prenom, code)" });
  }

  const carte = { nom, prenom, email, code, points, reduction, createdAt: new Date().toISOString() };

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

// ======== Code‑barres PNG (classique) ========
// Par défaut on garde un rendu "plein" comme avant (pas de contrainte CSS de hauteur).
// Tu peux ajuster via ?scale=3&height=22 si besoin. Valeurs par défaut conservatrices.
app.get("/barcode/:code", async (req, res) => {
  try {
    const code = String(req.params.code || "");
    const scale  = Math.min(8, Math.max(1, parseInt(req.query.scale, 10) || 3));
    const height = Math.min(60, Math.max(10, parseInt(req.query.height, 10) || 22));
    const includeText = req.query.text === "1";

    const png = await bwipjs.toBuffer({
      bcid: "code128",
      text: code,
      scale,
      height,
      includetext: includeText,
      textxalign: "center",
      backgroundcolor: "FFFFFF",
      paddingwidth: 4,
      paddingheight: 0,
      textsize: 10,
      textyoffset: 2,
    });

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.end(png);
  } catch (err) {
    console.error("Erreur barcode:", err);
    return res.status(500).send("Erreur génération code‑barres");
  }
});

// ======== Affichage carte — LIEN SIGNÉ ========
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

  // Pas de bulles — texte simple, une ligne, auto‑ajusté
  res.send(`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Carte de fidélité MDL</title>
<style>
:root{
  --maxw: 980px;

  /* Position du code‑barres (plein, centré) */
  --y-bar: 45%;     /* centre vertical du code‑barres */
  --bar-l: 7%;
  --bar-r: 7%;

  /* Positions des textes (une ligne chacun) */
  --y-nom:     72%;
  --y-prenom:  82%;

  --x-nom:     24%;
  --x-prenom:  24%;
  --r-nom:     35%;
  --r-prenom:  35%;
}

@media (max-width: 480px){
  :root{
    --y-bar: 46%;
    --y-nom: 73%;
    --y-prenom: 83%;
  }
}

*{box-sizing:border-box}
body{
  margin:0;
  background:#f2f2f2;
  font-family: system-ui, -apple-system, Segoe UI, Arial, sans-serif;
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

/* Code‑barres "classique": largeur fixe, hauteur auto (plein) */
.barcode{
  position:absolute;
  left:var(--bar-l); right:var(--bar-r);
  top:var(--y-bar);
  transform: translateY(-50%);
  display:flex; align-items:center; justify-content:center;
}
.barcode img{
  width:100%;
  height:auto;       /* pas de limite de hauteur */
  image-rendering:-webkit-optimize-contrast;
}

/* Lignes de texte sans bulles */
.line{
  position:absolute;
  left:0; right:0;
  padding:0 .5rem;
  color:#1c2430;
  font-weight:800;
  white-space:nowrap;
  transform: translateY(-50%);
  text-shadow: 0 0 2px #fff; /* petit liseré blanc pour lisibilité, sans fond */
}
.line.nom{
  top:var(--y-nom);
  left:var(--x-nom);
  right:var(--r-nom);
  font-size: clamp(14px, 5.6vw, 36px);
}
.line.prenom{
  top:var(--y-prenom);
  left:var(--x-prenom);
  right:var(--r-prenom);
  font-size: clamp(13px, 4.8vw, 28px);
  font-weight:900;
}

/* Debug */
body.debug .barcode{ outline:1px dashed rgba(0,0,0,.35); }
body.debug .line{ outline:1px dashed rgba(255,0,0,.35); }

/* Petit pied de page informatif (sans le mot "Code") */
.footer{
  margin:.6rem auto 0;
  font-size:12px;
  color:#4a5568;
  text-align:center;
}
</style>
</head>
<body class="${debug ? "debug" : ""}">
  <div class="page">
    <div class="carte">
      <img class="bg" src="/static/${bg}" alt="Carte MDL">

      <div class="barcode">
        <img src="/barcode/${encodeURIComponent(encodeURIComponent(code))}?scale=3&height=22" alt="Code‑barres">
      </div>

      <div class="line nom" id="nom">${esc(nom.toUpperCase())}</div>
      <div class="line prenom" id="prenom">${esc(prenom)}</div>
    </div>

    <div class="footer">
      ${esc(code)} • Points: ${esc(points || "0")} • Réduction: ${esc(reduction || "0,00 €")}
    </div>
  </div>

<script>
// Ajuste la taille de police pour que le texte tienne sur une seule ligne
(function(){
  function fitLine(el, opts){
    if (!el) return;
    const minPx = (opts && opts.minPx) || 10;  // taille mini autorisée
    const step  = (opts && opts.step)  || 0.5; // décrément en px
    const maxLoops = 100;

    // réinitialise d'abord (important si resize/orientation change)
    el.style.transform = "none";
    let fs = parseFloat(getComputedStyle(el).fontSize) || 16;

    // largeur dispo = boîte parent (left/right déjà gérés par CSS)
    const parent = el.parentElement || el;
    let loops = 0;
    while (el.scrollWidth > parent.clientWidth && fs > minPx && loops < maxLoops) {
      fs -= step;
      el.style.fontSize = fs + "px";
      loops++;
    }
  }

  function run(){
    fitLine(document.getElementById('nom'),    { minPx: 10, step: .5 });
    fitLine(document.getElementById('prenom'), { minPx: 10, step: .5 });
  }

  if (document.fonts && document.fonts.ready) { document.fonts.ready.then(run); }
  window.addEventListener("load", run);
  window.addEventListener("resize", run);
  window.addEventListener("orientationchange", run);
  window.fitNow = run; // pour tester à la main en console
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
      <li>/barcode/:code — Générer un code‑barres (?text=1 pour afficher le texte)</li>
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
