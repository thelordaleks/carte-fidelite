// ======== Dépendances ========
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const bwipjs = require("bwip-js"); // génération code-barres

// ======== Configuration ========
const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Autorise le JSON dans les requêtes
app.use(express.json());

// Sert les fichiers statiques (images, logo, etc.)
app.use("/static", express.static(path.join(__dirname, "static")));

// ======== Vérification des fichiers ========
["logo-mdl.png", "carte-mdl.png"].forEach((fichier) => {
  const chemin = path.join(__dirname, "static", fichier);
  if (fs.existsSync(chemin)) {
    console.log("✅ Fichier présent:", fichier);
  } else {
    console.log("⚠️  Fichier manquant:", fichier);
  }
});

// ======== Mémoire temporaire pour stocker les cartes ========
const cartes = {};

// ======== API appelée depuis Excel ========
app.post("/api/create-card", (req, res) => {
  if (!req.body) {
    console.log("❌ Aucun corps JSON reçu !");
    return res.status(400).json({ error: "Requête vide" });
  }

  const { nom, prenom, email, code } = req.body || {};

  if (!nom || !prenom || !code) {
    console.log("❌ Champs manquants :", req.body);
    return res.status(400).json({ error: "Champs manquants" });
  }

  const id = uuidv4();
  cartes[id] = { nom, prenom, email, code };

  const host = process.env.RENDER_EXTERNAL_HOSTNAME || req.headers.host;
  const protocol = host && host.includes("localhost") ? "http" : "https";
  const url = `${protocol}://${host}/card/${id}`;
  console.log(`✅ Carte générée : ${nom} ${prenom} → ${url}`);
  res.json({ url });
});

// ======== Route pour générer un code-barres dynamique ========
app.get("/barcode/:code", (req, res) => {
  try {
    // ?text=1 pour afficher le texte sous le code-barres, sinon caché (par défaut)
    const includeText = req.query.text === "1";
    bwipjs.toBuffer(
      {
        bcid: "code128", // format du code-barres
        text: req.params.code,
        scale: 3,
        height: 10,
        includetext: includeText,
        textxalign: "center",
        backgroundcolor: "FFFFFF",
      },
      (err, png) => {
        if (err) {
          console.error("Erreur génération code-barres:", err);
          res.status(500).send("Erreur génération code-barres");
        } else {
          res.type("image/png");
          res.send(png);
        }
      }
    );
  } catch (e) {
    console.error("Erreur serveur code-barres:", e);
    res.status(500).send("Erreur serveur");
  }
});

// ======== Route pour afficher la carte depuis un navigateur (Option A overlay) ========
app.get("/card/:id", (req, res) => {
  const id = req.params.id;
  const carte = cartes[id];

  if (!carte) {
    return res.status(404).send("<h1>Carte introuvable ❌</h1>");
  }

  res.send(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Carte de fidélité MDL</title>
  <style>
    :root { --maxw: 560px; }
    *{box-sizing:border-box}
    body {
      font-family: system-ui, -apple-system, Segoe UI, Arial, sans-serif;
      text-align: center;
      background-color: #f2f2f2;
      padding: 16px;
      margin: 0;
      display:flex; align-items:center; justify-content:center; min-height:100svh;
    }
    .wrap{
      width: min(92vw, var(--maxw));
      background:#fff;
      border-radius: 20px;
      box-shadow: 0 6px 24px rgba(0,0,0,0.10);
      padding:16px;
    }
    /* La carte: image de fond + overlay responsive */
    .carte {
      position: relative;
      width: 100%;
      border-radius: 16px;
      overflow: hidden;
      background: #fff url('/static/carte-mdl.png') center/cover no-repeat;
      aspect-ratio: 5 / 3; /* Ajuste si ton visuel a un autre ratio */
    }
    .overlay {
      position: absolute; inset: 0;
      padding: 6% 7%;
      color: #1c2434;
    }
    .line {
      position: absolute; left: 8%; right: 8%;
      font-weight: 700; letter-spacing: 0.2px;
      text-shadow: 0 1px 0 rgba(255,255,255,0.6);
    }
    /* Positionne les textes exactement où tu veux sur le visuel */
    .name { top: 36%; font-size: clamp(16px, 4.6vw, 32px); }
    .code { top: 50%; font-size: clamp(14px, 3.8vw, 26px); font-weight:600; }

    .barcode {
      position: absolute; left: 8%; right: 8%; bottom: 8%;
      width: 84%; height: auto; background:#fff;
      padding: clamp(4px, 1vw, 10px);
      border-radius: clamp(4px, 1.2vw, 12px);
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }

    /* Texte complémentaire en dessous (optionnel) */
    .infos {
      font-size: 15px; color: #333; margin-top: 12px;
    }
    .infos .nom { font-weight: 800; }
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

    <!-- Zone d'info en dessous (facultatif) -->
    <div class="infos">
      <div class="nom">${carte.nom.toUpperCase()} ${carte.prenom}</div>
      <div class="c">${carte.code}</div>
    </div>
  </div>
</body>
</html>`);
});

// ======== Route de test du design ========
app.get("/new", (req, res) => {
  res.send(`
    <html>
      <head><title>Test Carte MDL</title></head>
      <body style="text-align:center;font-family:Arial;">
        <h2>Carte de fidélité test MDL</h2>
        <img src="/static/carte-mdl.png" style="width:320px;border-radius:12px;">
      </body>
    </html>
  `);
});

// ======== Page d'accueil ========
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head><title>Serveur Carte Fidélité MDL</title></head>
      <body style="font-family:Arial;text-align:center;padding:40px">
        <h2>✅ Serveur MDL en ligne</h2>
        <p>Les routes disponibles :</p>
        <ul style="list-style:none">
          <li><a href="/new">/new</a> — Test carte</li>
          <li>/api/create-card — API pour Excel</li>
          <li>/card/:id — Afficher une carte générée</li>
          <li>/barcode/:code — Générer un code-barres (ajouter ?text=1 pour afficher le texte)</li>
        </ul>
      </body>
    </html>
  `);
});

// ======== Lancement du serveur ========
app.listen(PORT, () => {
  const host = process.env.RENDER_EXTERNAL_HOSTNAME || "localhost:" + PORT;
  const protocol = host.includes("localhost") ? "http" : "https";
  console.log(`🚀 Serveur démarré sur ${protocol}://${host}`);
});
