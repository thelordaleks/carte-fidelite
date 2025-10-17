const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const bwipjs = require('bwip-js');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware pour les fichiers statiques (images)
app.use('/static', express.static(path.join(__dirname, 'static'), {
  maxAge: '1d', // Cache d'1 jour pour les images
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.png')) {
      res.type('image/png'); // Force le bon type MIME
    }
  }
}));

// Vérification des images au démarrage
const checkStaticFiles = () => {
  const staticPath = path.join(__dirname, 'static');
  const files = ['logo-mdl.png', 'carte-mdl.png'];

  files.forEach(file => {
    const filePath = path.join(staticPath, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️ Fichier manquant: ${filePath}`);
    } else {
      console.log(`✅ Fichier présent: ${file}`);
    }
  });
};

checkStaticFiles();

// Configuration EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Base de données temporaire
const cartes = {};

// Route pour vérifier les images
app.get('/check-images', (req, res) => {
  const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  res.json({
    logoUrl: `${baseUrl}/static/logo-mdl.png`,
    cardBgUrl: `${baseUrl}/static/carte-mdl.png`,
    timestamp: Date.now()
  });
});

// Génération du code-barres
app.get('/barcode/:code', (req, res) => {
  bwipjs.toBuffer({
    bcid: 'code128',
    text: req.params.code,
    scale: 3,
    height: 10,
    includetext: true,
    textxalign: 'center'
  }, (err, png) => {
    if (err) return res.status(500).send("Erreur code-barres");
    res.type('png').send(png);
  });
});

// Création d'une carte
app.post('/api/create-card', (req, res) => {
  const { nom, prenom, code, email } = req.body;
  if (!nom || !prenom || !code) {
    return res.status(400).json({ error: "Données manquantes" });
  }

  const id = uuidv4();
  cartes[id] = { nom, prenom, code, email };

  const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  res.json({
    success: true,
    url: `${baseUrl}/card/${id}`,
    cardId: id
  });
});

// Affichage de la carte
app.get('/card/:id', (req, res) => {
  const carte = cartes[req.params.id];
  if (!carte) return res.status(404).send("Carte introuvable");

  const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  res.render('card', {
    carte,
    baseUrl,
    timestamp: Date.now() // Pour forcer le rafraîchissement
  });
});

// Route racine
app.get('/', (req, res) => {
  res.send(`
    <h1>Serveur Carte Fidélité MDL</h1>
    <p>Statut: ✅ Actif</p>
    <p><a href="/check-images">Vérifier les images</a></p>
  `);
});

// Démarrage
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`}`);
});
