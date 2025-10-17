const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const bwipjs = require('bwip-js');

let jwt = null;
try {
  jwt = require('jsonwebtoken');
} catch (e) {
  console.warn('⚠️ jsonwebtoken non installé — les liens signés seront indisponibles (fallback prévu).');
}

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET || 'dev-secret-change-me';

// PUBLIC_HOST utile pour générer des URLs absolues (local ou render)
const PUBLIC_HOST = process.env.BASE_URL || process.env.RENDER_EXTERNAL_HOSTNAME || `localhost:${PORT}`;

// Configuration EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middlewares
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'static')));

// Vérifie la présence des images utiles (log)
['logo-mdl.png', 'carte-mdl.png'].forEach((f) => {
  const p = path.join(__dirname, 'static', f);
  console.log(fs.existsSync(p) ? `✅ Fichier présent: ${f}` : `⚠️ Fichier manquant: ${f}`);
});

// Stockage mémoire simple pour dev
const cartes = {};

// Route simple de test qui crée une carte et redirige vers /card/:id
app.get('/new', (_req, res) => {
  const id = uuidv4();
  cartes[id] = {
    nom: 'DUHAMEL',
    prenom: 'Alexis',
    email: '',
    code: 'ADH0624NPI8d',
  };
  res.redirect(`/card/${id}`);
});

// API pour création (ex: Excel)
app.post('/api/create-card', (req, res) => {
  if (!req.body) return res.status(400).json({ error: 'Requête vide' });
  const { nom, prenom, email, code } = req.body || {};
  if (!nom || !prenom || !code) return res.status(400).json({ error: 'Champs manquants' });

  const id = uuidv4();
  cartes[id] = { nom, prenom, email, code };

  const host = process.env.RENDER_EXTERNAL_HOSTNAME || req.headers.host || PUBLIC_HOST;
  const protocol = host && host.includes('localhost') ? 'http' : 'https';

  let urlSigned = null;
  if (jwt) {
    const token = jwt.sign({ nom, prenom, email: email || null, code }, SECRET, { expiresIn: '365d' });
    urlSigned = `${protocol}://${host}/card/t/${encodeURIComponent(token)}`;
  }
  const urlLegacy = `${protocol}://${host}/card/${id}`;

  console.log(`✅ Carte générée : ${nom} ${prenom} → ${urlSigned || urlLegacy}`);
  return res.json({ url: urlSigned || urlLegacy, legacy: urlLegacy, signed: Boolean(jwt) });
});

// Génération du code-barres PNG (bwip-js)
app.get('/barcode/:code', (req, res) => {
  try {
    const includeText =
      req.query.includetext === '1' ||
      req.query.text === '1' ||
      req.query.includetext === 'true';
    const scale = Math.max(2, Math.min(8, parseInt(req.query.scale || '3', 10)));
    const height = Math.max(8, Math.min(30, parseInt(req.query.height || '12', 10)));
    const textsize = Math.max(8, Math.min(24, parseInt(req.query.textsize || '12', 10)));

    bwipjs.toBuffer(
      {
        bcid: 'code128',
        text: req.params.code,
        scale,
        height,
        includetext: includeText,
        textxalign: 'center',
        textsize,
        backgroundcolor: 'FFFFFF',
      },
      (err, png) => {
        if (err) return res.status(500).send('Erreur génération code-barres');
        res.type('image/png').send(png);
      }
    );
  } catch (e) {
    res.status(500).send('Erreur serveur');
  }
});

// Affichage carte via token JWT (stateless)
app.get('/card/t/:token', (req, res) => {
  if (!jwt) return res.status(503).send('<h1>JWT indisponible sur ce déploiement</h1>');
  try {
    const carte = jwt.verify(req.params.token, SECRET);
    return res.render('card', { carte, baseUrl: process.env.BASE_URL || '', timestamp: Date.now() });
  } catch (e) {
    return res.status(404).send('<h1>Carte introuvable ou token invalide ❌</h1>');
  }
});

// Affichage carte par id (legacy, basé sur mémoire)
app.get('/card/:id', (req, res) => {
  const id = req.params.id;
  const carte = cartes[id];
  if (!carte) return res.status(404).send('<h1>Carte introuvable ❌</h1>');

  // Si JWT présent, redirige vers le lien signé (stateless)
  if (jwt) {
    const token = jwt.sign(carte, SECRET, { expiresIn: '365d' });
    return res.redirect(302, `/card/t/${encodeURIComponent(token)}`);
  }

  // Sinon render la vue directement (fallback)
  return res.render('card', { carte, baseUrl: process.env.BASE_URL || '', timestamp: Date.now() });
});

// Page d'accueil informative
app.get('/', (req, res) => {
  res.send(
    `<html><head><title>Serveur Carte Fidélité MDL</title></head>
     <body style="font-family:Arial;text-align:center;padding:40px">
       <h2>✅ Serveur MDL en ligne</h2>
       <ul style="text-align:left;display:inline-block">
         <li>/api/create-card — API pour créer une carte (retourne url)</li>
         <li>/card/t/:token — Afficher une carte (stateless, JWT)</li>
         <li>/card/:id — Afficher une carte (legacy)</li>
         <li>/barcode/:code — Générer un code-barres (?includetext=1&scale=6&height=18&textsize=16)</li>
       </ul>
     </body></html>`
  );
});

// Lancement
app.listen(PORT, () => {
  const host = process.env.RENDER_EXTERNAL_HOSTNAME || `localhost:${PORT}`;
  const protocol = host.includes('localhost') ? 'http' : 'https';
  console.log(`🚀 Serveur démarré sur ${protocol}://${host}`);
  try {
    require.resolve('jsonwebtoken');
    console.log('✅ jsonwebtoken présent');
  } catch (e) {
    console.error('❌ jsonwebtoken manquant — vérifier package.json/lockfile');
  }
  console.log('Node:', process.version);
});
