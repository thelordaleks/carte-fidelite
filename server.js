const express = require("express");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Autorise JSON dans les requêtes
app.use(express.json());

// Sert les fichiers statiques (images, logo, etc.)
app.use("/static", express.static(path.join(__dirname, "static")));

// Mémoire temporaire pour stocker les cartes générées
const cartes = {};

// 🔹 API appelée depuis Excel
app.post("/api/create-card", (req, res) => {
  const { nom, prenom, email, code } = req.body;

  if (!nom || !prenom || !code) {
    console.log("❌ Champs manquants :", req.body);
    return res.status(400).json({ error: "Champs manquants" });
  }

  const id = uuidv4();
  cartes[id] = { nom, prenom, email, code };

  const url = `https://${req.headers.host}/card/${id}`;
  console.log(`✅ Carte générée : ${nom} ${prenom} → ${url}`);
  res.json({ url });
});

// 🔹 Route pour afficher la carte depuis un navigateur
app.get("/card/:id", (req, res) => {
  const id = req.params.id;
  const carte = cartes[id];

  if (!carte) {
    return res.status(404).send("<h1>Carte introuvable ❌</h1>");
  }

  res.send(`
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Carte de fidélité MDL</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            text-align: center;
            background-color: #f2f2f2;
            padding: 40px;
          }
          .carte {
            background: white;
            border-radius: 16px;
            box-shadow: 0 4px 10px rgba(0,0,0,0.25);
            display: inline-block;
            padding: 20px;
          }
          .carte img {
            width: 320px;
            border-radius: 12px;
            margin-bottom: 15px;
          }
          .infos {
            font-size: 16px;
            color: #333;
          }
        </style>
      </head>
      <body>
        <div class="carte">
          <img src="/static/carte-mdl.png" alt="Carte fidélité">
          <div class="infos">
            <p><strong>${carte.nom} ${carte.prenom}</strong></p>
            <p>Code adhérent : ${carte.code}</p>
          </div>
        </div>
      </body>
    </html>
  `);
});

// 🔹 Route test pour vérifier le design
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
        </ul>
      </body>
    </html>
  `);
});


// Lancement du serveur
app.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur le port ${PORT}`);
});
