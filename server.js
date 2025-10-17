// ======== Dépendances ========
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const bwipjs = require("bwip-js");

// jsonwebtoken (optionnel au démarrage pour éviter un crash si non installé)
let jwt = null;
try { jwt = require("jsonwebtoken"); } catch (e) {
  console.warn("⚠️ jsonwebtoken non installé — liens signés désactivés (temporaire)");
}

// ======== Configuration ========
const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET || "dev-secret-change-me";

// ✅ JSON
app.use(express.json());

// Static
app.use("/static", express.static(path.join(__dirname, "static")));

// Vérif fichiers
["logo-mdl.png", "carte-mdl.png"].forEach((f) => {
  const p = path.join(__dirname, "static", f);
  console.log(fs.existsSync(p) ? "✅ Fichier présent:" : "⚠️  Fichier manquant:", f);
});

// Mémoire (compat)
const cartes = {};

// ======== API appelée depuis Excel ========
app.post("/api/create-card", (req, res) => {
  if (!req.body) return res.status(400).json({ error: "Requête vide" });

  const { nom, prenom, email, code } = req.body || {};
  if (!nom || !prenom || !code) return res.status(400).json({ error: "Champs manquants" });

  const id = uuidv4();
  cartes[id] = { nom, prenom, email, code };

  const host = process.env.RENDER_EXTERNAL_HOSTNAME || req.headers.host;
  const protocol = host && host.includes("localhost") ? "http" : "https";

  let urlSigned = null;
  if (jwt) {
    const token = jwt.sign({ nom, prenom, email: email || null, code }, SECRET, { expiresIn: "365d" });
    urlSigned = `${protocol}://${host}/card/t/${encodeURIComponent(token)}`;
  }
  const urlLegacy = `${protocol}://${host}/card/${id}`;

  console.log(`✅ Carte générée : ${nom} ${prenom} → ${urlSigned || urlLegacy}`);
  res.json({ url: urlSigned || urlLegacy, legacy: urlLegacy, signed: Boolean(jwt) });
});

// ======== Code-barres ========
// Paramètres facultatifs:
//   ?scale=4 (densité, 2..8)
//   ?height=14 (hauteur, 8..30)
//   ?text=1 (afficher le texte)
//   ?textsize=14 (taille du texte)
app.get("/barcode/:code", (req, res) => {
  try {
    const includeText = req.query.text === "1";
    const scale = Math.max(2, Math.min(8, parseInt(req.query.scale || "4", 10)));
    const height = Math.max(8, Math.min(30, parseInt(req.query.height || "14", 10)));
    const textsize = Math.max(8, Math.min(24, parseInt(req.query.textsize || "14", 10)));
    bwipjs.toBuffer(
      {
        bcid: "code128",
        text: req.params.code,
        scale,
        height,
        includetext: includeText,
        textxalign: "center",
        textsize,
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

// ======== Affichage carte — LIEN SIGNÉ (JWT) ========
app.get("/card/t/:token", (req, res) => {
  if (!jwt) return res.status(503).send("<h1>JWT indisponible sur ce déploiement</h1>");
  let carte;
  try {
    carte = jwt.verify(req.params.token, SECRET);
  } catch (e) {
    return res.status(404).send("<h1>Carte introuvable ❌</h1>");
  }
  res.send(`<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Carte de fidélité MDL</title>
<style>
:root{
  --maxw: 600px;
  /* Ajuste ces positions pour caler pile avec ton visuel (en %) */
  --y-prenom: 64%;
  --y-nom:    76%;
  --y-bar:    36%;
}
*{box-sizing:border-box}
body{
  margin:0; background:#f6f7f9;
  font-family: system-ui, -apple-system, Segoe UI, Arial, sans-serif;
  min-height:100svh; display:flex; align-items:center; justify-content:center; padding:16px;
  color:#1c2434;
}
.wrap{
  width:min(92vw, var(--maxw));
  background:#fff; border-radius:20px; padding:16px;
  box-shadow:0 6px 24px rgba(0,0,0,.10);
}
.carte{
  position:relative; width:100%;
  background:#fff url('/static/carte-mdl.png') center/cover no-repeat;
  border-radius:16px; overflow:hidden;
  aspect-ratio: 5 / 3;
}
.overlay{ position:absolute; inset:0; padding:6% 7%; }
.line{
  position:absolute; left:8%; right:8%;
  letter-spacing:.2px; text-shadow:0 1px 0 rgba(255,255,255,.6);
  overflow:hidden; white-space:nowrap; text-overflow:ellipsis;
}
.prenom{
  top: var(--y-prenom);
  font-weight:700;
  font-size: clamp(18px, 5vw, 36px);
}
.nom{
  top: var(--y-nom);
  font-weight:800;
  font-size: clamp(20px, 5.6vw, 40px);
  letter-spacing:.3px;
}
.barcode{
  position:absolute; left:8%; right:8%;
  top: var(--y-bar);
}
.code-wrap{ width:100%; }
.code-wrap img{ width:100%; height:auto; display:block; filter: drop-shadow(0 1px 0 rgba(0,0,0,.05)); }
.foot{ margin-top:12px; text-align:center; color:#5b6575; font-size:13px; }
@media (min-width:700px){ :root{ --maxw: 720px; } }
</style>
<script>
const dpr = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)));
const params = new URLSearchParams({
  scale: String(3 + dpr),
  height: String(14 + dpr*2),
  text: "1",
  textsize: String(12 + dpr*2)
});
window.addEventListener('DOMContentLoaded', () => {
  const img = document.getElementById('barcode-img');
  const code = ${JSON.stringify(String((carte && carte.code) || ""))};
  img.src = '/barcode/' + encodeURIComponent(code) + '?' + params.toString();
});
</script>
</head>
<body>
  <div class="wrap">
    <div class="carte">
      <div class="overlay">
        <div class="line barcode">
          <div class="code-wrap">
            <img id="barcode-img" alt="Code-barres ${String((carte && carte.code) || "")}" loading="eager" decoding="async"/>
          </div>
        </div>
        <div class="line prenom">${(carte.prenom || "").trim()}</div>
        <div class="line nom">${(carte.nom || "").toUpperCase().trim()}</div>
      </div>
    </div>
    <div class="foot">MDL — Carte de fidélité</div>
  </div>
</body>
</html>`);
});

// ======== Affichage carte — ANCIEN LIEN (mémoire) ========
app.get("/card/:id", (req, res) => {
  const id = req.params.id;
  const carte = cartes[id];
  if (!carte) return res.status(404).send("<h1>Carte introuvable ❌</h1>");
  if (!jwt) {
    return res.redirect(302, `/card/legacy/${encodeURIComponent(id)}`);
  }
  const token = jwt.sign(carte, SECRET, { expiresIn: "365d" });
  res.redirect(302, `/card/t/${encodeURIComponent(token)}`);
});

// ======== Affichage carte legacy (sans JWT) ========
app.get("/card/legacy/:id", (req, res) => {
  const id = req.params.id;
  const carte = cartes[id];
  if (!carte) return res.status(404).send("<h1>Carte introuvable ❌</h1>");
  // Rend avec le même template que /card/t mais sans vérif
  res.redirect(302, `/card/t/${Buffer.from(JSON.stringify(carte)).toString("base64url")}`);
});

// ======== Page d’accueil et test ========
app.get("/new", (_req, res) => {
  res.send(`<html><head><title>Test Carte MDL</title></head>
  <body style="text-align:center;font-family:Arial;">
    <h2>Carte de fidélité test MDL</h2>
    <img src="/static/carte-mdl.png" style="width:320px;border-radius:12px;">
  </body></html>`);
});

app.get("/", (req, res) => {
  res.send(`<html><head><title>Serveur Carte Fidélité MDL</title></head>
  <body style="font-family:Arial;text-align:center;padding:40px">
    <h2>✅ Serveur MDL en ligne</h2>
    <ul style="list-style:none">
      <li>/api/create-card — API pour Excel (retourne url signé si JWT dispo)</li>
      <li>/card/t/:token — Afficher une carte (stateless, JWT)</li>
      <li>/card/legacy/:id — Afficher une carte sans JWT (fallback)</li>
      <li>/barcode/:code — Générer un code-barres (?text=1&scale=6&height=18&textsize=16)</li>
    </ul>
  </body></html>`);
});

// ======== Lancement ========
app.listen(PORT, () => {
  const host = process.env.RENDER_EXTERNAL_HOSTNAME || "localhost:" + PORT;
  const protocol = host.includes("localhost") ? "http" : "https";
  console.log(`🚀 Serveur démarré sur ${protocol}://${host}`);
  try {
    require.resolve("jsonwebtoken");
    console.log("✅ jsonwebtoken présent");
  } catch (e) {
    console.error("❌ jsonwebtoken manquant — vérifier package.json/lockfile");
  }
  console.log("Node:", process.version);
});
