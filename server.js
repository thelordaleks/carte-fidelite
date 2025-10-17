const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const bwipjs = require('bwip-js');

// Configuration Express
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'static'))); // Pour les images statiques
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Base de données temporaire (remplacez par SQLite en production)
const cartes = {};

// Générer un code-barres (route dynamique)
app.get('/barcode/:code', (req, res) => {
  const code = req.params.code;
  bwipjs.toBuffer({
    bcid: 'code128',       // Type de code-barres
    text: code,           // Texte à encoder
    scale: 3,             // Taille
    height: 10,           // Hauteur
    includetext: true,    // Afficher le texte sous le code
    textxalign: 'center'  // Centrer le texte
  }, (err, png) => {
    if (err) {
      console.error("Erreur génération code-barres:", err);
      return res.status(500).send("Erreur lors de la génération du code-barres");
    }
    res.type('png');
    res.send(png);
  });
});

// Créer une carte (appelée depuis Excel)
app.post('/api/create-card', (req, res) => {
  const { nom, prenom, code, email } = req.body;
  if (!nom || !prenom || !code) {
    return res.status(400).json({ error: "Champs manquants" });
  }

  const id = uuidv4();
  cartes[id] = { nom, prenom, code, email };

  // URL absolue pour Render
  const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  const cardUrl = `${baseUrl}/card/${id}`;

  res.json({ success: true, url: cardUrl });
});

// Afficher une carte
app.get('/card/:id', (req, res) => {
  const carte = cartes[req.params.id];
  if (!carte) return res.status(404).send("Carte non trouvée");

  res.render('card', {
    carte: carte,
    baseUrl: process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`
  });
});

// Route de test
app.get('/', (req, res) => {
  res.send('✅ Serveur Carte Fidélité actif !');
});

// Démarrer le serveur
app.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`}`);
});
