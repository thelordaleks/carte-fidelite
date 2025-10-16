const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = 3000;

// Config
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'static')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Simule une base de données (on stockera les cartes ici pour l'instant)
let cartes = {};

// Page d’accueil
app.get('/', (req, res) => {
  res.send('✅ Serveur Carte Fidélité actif !');
});

// Générer une nouvelle carte (pour test)
app.get('/new', (req, res) => {
  const id = uuidv4();
  cartes[id] = {
    nom: 'Dupont',
    prenom: 'Alexis',
    code: '123456789'
  };
  res.redirect(`/card/${id}`);
});

// Afficher la carte
app.get('/card/:id', (req, res) => {
  const carte = cartes[req.params.id];
  if (!carte) return res.status(404).send('Carte introuvable');
  res.render('card', { carte });
});

// Démarrer le serveur
app.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`);
});

// API appelée par Excel
app.post('/api/create-card', express.json(), (req, res) => {
  const { nom, prenom, email, code } = req.body;
  if (!nom || !prenom || !code) {
    console.log("❌ Requête incomplète :", req.body);
    return res.status(400).json({ error: "Champs manquants" });
  }
  const id = uuidv4();
  cartes[id] = { nom, prenom, code };
  const url = `http://localhost:${PORT}/card/${id}`;
  console.log("✅ Carte générée :", nom, prenom, "→", url);
  res.json({ url });
});


app.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`);
});


