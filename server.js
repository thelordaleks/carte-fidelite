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

  // Conserve l’ancien comportement (mémoire) pour compat éventuelle
  const id = uuidv4();
  cartes[id] = { nom, prenom, email, code };

  // Nouveau: créer un jeton signé (expire dans 365 jours, ajuste si besoin)
  const token = jwt.sign({ nom, prenom, email: email || null, code }, SECRET, { expiresIn: "365d" });

  const host = process.env.RENDER_EXTERNAL_HOSTNAME || req.headers.host;
  const protocol = host && host.includes("localhost") ? "http" : "https";

  const urlSigned = `${protocol}://${host}/card/t/${encodeURIComponent(token)}`;
  const urlLegacy = `${protocol}://${host}/card/${id}`;

  console.log(`✅ Carte générée : ${nom} ${prenom} → ${urlSigned}`);
  // Renvoie le lien signé (et l’ancien si tu en as encore besoin)
  res.json({ url: urlSigned, legacy: urlLegacy });
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
  let payload;
  try {
    payload = jwt.verify(req.params.token, SECRET);
  } catch (e) {
    return res.status(404).send("<h1>Carte introuvable ❌</h1>");
  }
  const carte = payload;

  res.send(`<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Carte de fidélité MDL</title>
<style>
:root { --maxw: 560px; }
*{box-sizing:border-box}
body{
  font-family: system-ui, -apple-system, Segoe UI, Arial, sans-serif;
  margin:0; background:#f2f2f2;
  display:flex; align-items:center; justify-content:center; min-height:100svh; padding:16px;
}
.wrap{
  width:min(92vw, var(--maxw)); background:#fff; border-radius:20px;
  box-shadow:0 6px 24px rgba(0,0,0,.10); padding:16px; text-align:center;
}
.carte{
  position:relative; width:100%; border-radius:16px; overflow:hidden;
  background:#fff url('/static/carte-mdl.png') center/cover no-repeat;
  aspect-ratio: 5 / 3; /* ajuste au besoin */
}
.overlay{ position:absolute; inset:0; padding:6% 7%; color:#1c2434; }
.line{ position:absolute; left:8%; right:8%; font-weight:700; letter-spacing:.2px;
       text-shadow:0 1px 0 rgba(255,255,255,.6); }
.name{ top:36%; font-size:clamp(16px, 4.6vw, 32px); }
.code{ top:50%; font-size:clamp(14px, 3.8vw, 26px); font-weight:600; }
.barcode{
  position:absolute; left:8%; right:8%; bottom:8%;
  width:84%; height:auto; background:#fff;
  padding:clamp(4px,1vw,10px); border-radius:clamp(4px,1.2vw,12px);
  box-shadow:0 2px 8px rgba(0,0,0,.08);
}
.infos{ font-size:15px; color:#333; margin-top:12px; }
.infos .nom{ font-weight:800; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="carte" role="img" aria-label="Carte de fidélité de ${carte.prenom} ${carte.nom}">
      <div class="overlay">
        <div class="line name">${carte.prenom} ${carte.nom}</div>
        <div class="line code">Code : ${carte.code}</div>
        <img class="barcode" src="/barcode/${encodeURIComponent(carte.code)}?text=0" alt="Code-barres ${carte.code}">
      </div>
    </div>
    <div class="infos">
      <div class="nom">${(carte.nom || "").toUpperCase()} ${carte.prenom || ""}</div>
      <div class="c">${carte.code}</div>
    </div>
  </div>
</body>
</html>`);
});

// ======== Affichage carte — ANCIEN LIEN (dépend de la mémoire) ========
app.get("/card/:id", (req, res) => {
  const id = req.params.id;
  const carte = cartes[id];
  if (!carte) return res.status(404).send("<h1>Carte introuvable ❌</h1>");
  // On réutilise le même template
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

app.get("/", (req, res) => {
  res.send(`<html><head><title>Serveur Carte Fidélité MDL</title></head>
  <body style="font-family:Arial;text-align:center;padding:40px">
    <h2>✅ Serveur MDL en ligne</h2>
    <ul style="list-style:none">
      <li>/api/create-card — API pour Excel (retourne url signé)</li>
      <li>/card/t/:token — Afficher une carte (stateless)</li>
      <li>/barcode/:code — Générer un code-barres (?text=1 pour afficher le texte)</li>
    </ul>
  </body></html>`);
});

// ======== Lancement ========
app.listen(PORT, () => {
  const host = process.env.RENDER_EXTERNAL_HOSTNAME || "localhost:" + PORT;
  const protocol = host.includes("localhost") ? "http" : "https";
  console.log(`🚀 Serveur démarré sur ${protocol}://${host}`);
});
