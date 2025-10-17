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
["logo-mdl.png", "carte-mdl.png"].forEach((f) => {
  const p = path.join(__dirname, "static", f);
  console.log(fs.existsSync(p) ? "✅ Fichier présent:" : "⚠️  Fichier manquant:", f);
});

// Mémoire (compat ancien /card/:id)
const cartes = {};

// ======== API appelée depuis Excel ========
app.post("/api/create-card", (req, res) => {
  if (!req.body) return res.status(400).json({ error: "Requête vide" });

  const { nom, prenom, email, code } = req.body || {};
  if (!nom || !prenom || !code) return res.status(400).json({ error: "Champs manquants" });

  // Ancien comportement (mémoire) pour /card/:id
  const id = uuidv4();
  cartes[id] = { nom, prenom, email, code };

  // Jeton signé (expire dans 365 jours)
  const token = jwt.sign({ nom, prenom, email: email || null, code }, SECRET, { expiresIn: "365d" });

  const host = process.env.RENDER_EXTERNAL_HOSTNAME || req.headers.host || `localhost:${PORT}`;
  const protocol = host.includes("localhost") ? "http" : "https";

  const urlSigned = `${protocol}://${host}/card/t/${encodeURIComponent(token)}`;
  const urlLegacy = `${protocol}://${host}/card/${id}`;

  console.log(`✅ Carte générée : ${prenom} ${nom} → ${urlSigned}`);
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
  let carte;
  try {
    carte = jwt.verify(req.params.token, SECRET);
  } catch {
    return res.status(404).send("<h1>Carte introuvable ❌</h1>");
  }

  const prenom = (carte.prenom || "").trim();
  const nom = (carte.nom || "").trim();
  const code = (carte.code || "").trim();

  // HTML/Styles: code-barres en zone ex-« nom », et nom/prénom dans leurs zones respectives
  res.send(`<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Carte de fidélité MDL</title>
<style>
:root{
  --maxw: 560px;
  /* Ajuste ces positions pour caler pile avec ton visuel */
  --y-prenom: 60%;  /* zone "Prénom" sur l'image */
  --y-nom:    70%;  /* zone "Nom" sur l'image */
  --y-bar:    36%;  /* position verticale du code-barres (ex-ancienne zone "nom") */
}
*{box-sizing:border-box}
body{
  margin:0; background:#f2f2f2;
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
  aspect-ratio: 5 / 3; /* ajuste si nécessaire */
}
.overlay{ position:absolute; inset:0; }
.line{
  position:absolute; left:8%; right:8%;
  letter-spacing:.2px; text-shadow:0 1px 0 rgba(255,255,255,.6);
}
.prenom{
  top: var(--y-prenom);
  font-weight:700;
  font-size: clamp(16px, 4.6vw, 32px);
}
.nom{
  top: var(--y-nom);
  font-weight:800;
  font-size: clamp(18px, 5vw, 34px);
}
.barcode{
  position:absolute; left:8%; right:8%;
  top: var(--y-bar);
  display:flex; align-items:center; justify-content:center;
}
.barcode img{
  width: 84%;
  max-width: 420px;
  height:auto;
  filter: drop-shadow(0 1px 0 rgba(255,255,255,.5));
}
.info{ text-align:center; color:#444; font-size:14px; margin-top:12px; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="carte" role="img" aria-label="Carte de fidélité de ${prenom} ${nom}">
      <div class="overlay">
        <div class="line barcode">
          <img src="/barcode/${encodeURIComponent(code)}?text=0" alt="Code-barres ${code}" decoding="async" />
        </div>
        <div class="line prenom">${prenom}</div>
        <div class="line nom">${nom.toUpperCase()}</div>
      </div>
    </div>
    <div class="info">Présentez cette carte à la MDL. Code: ${code}</div>
  </div>
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
      <li>/card/t/:token — Afficher une carte (stateless)</li>
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
