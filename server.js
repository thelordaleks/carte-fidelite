// ===== Dépendances =====
const express = require("express");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const bwipjs = require("bwip-js"); // +++ Génération code-barres

const app = express();
const PORT = process.env.PORT || 3000;

// URL publique (Render/locale)
const PUBLIC_HOST =
  process.env.BASE_URL
    || (process.env.RENDER_EXTERNAL_HOSTNAME
          ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`
          : `http://localhost:${PORT}`);

app.set("trust proxy", 1);
app.use(express.json());
app.use("/static", express.static(path.join(__dirname, "static")));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const cartes = {};

// Santé
app.get("/health", (_req, res) => res.send("OK"));
app.get("/favicon.ico", (_req, res) => res.status(204).end());

// Accueil minimal
app.get("/", (_req, res) => {
  res.send(`<html><head><meta charset="utf-8"><title>MDL</title></head>
  <body style="font-family:Arial;padding:40px">
  <h2>Serveur MDL</h2><ul>
    <li><a href="/new">/new</a></li>
  </ul></body></html>`);
});

// === API création carte ===
app.post("/api/create-card", (req, res) => {
  const { nom, prenom, email, code } = req.body || {};
  if (!nom || !prenom || !code) {
    return res.status(400).json({ error: "nom, prenom, code requis" });
  }
  const id = uuidv4();
  cartes[id] = { nom, prenom, email: email || "", code };
  res.json({ url: `${PUBLIC_HOST}/card/${id}`, id });
});

// Page carte
app.get("/card/:id", (req, res) => {
  const carte = cartes[req.params.id];
  if (!carte) return res.status(404).send("Carte introuvable");
  res.render("card", {
    baseUrl: PUBLIC_HOST,
    timestamp: Date.now(),
    carte
  });
});

// Génération code‑barres: supporte /barcode/:code ET /barcode?text=CODE
app.get(['/barcode/:code', '/barcode'], async (req, res) => {
  try {
    const text =
      req.params.code ||      // /barcode/ADH0624NPI8d
      req.query.data ||       // /barcode?data=...
      req.query.text;         // /barcode?text=...

    if (!text) {
      return res.status(400).type('text').send("Paramètre manquant: code dans l'URL ou ?text=...");
    }

    const bcid = String(req.query.bcid || 'code128');
    const scale = parseInt(req.query.scale || '3', 10);
    const height = parseInt(req.query.height || '12', 10);
    const includetext = req.query.includetext === '1';
    const textxalign = String(req.query.textxalign || 'center');

    const png = await bwipjs.toBuffer({
      bcid,
      text,
      scale,
      height,
      includetext,
      textxalign,
      paddingwidth: parseInt(req.query.paddingwidth || '8', 10),
      paddingheight: parseInt(req.query.paddingheight || '4', 10),
      backgroundcolor: 'FFFFFF',
    });

    res.type('png').send(png);
  } catch (err) {
    console.error('Barcode error:', err);
    res.status(500).type('text').send('Erreur génération code-barres');
  }
});


// Route de test rapide
app.get("/new", (_req, res) => {
  const id = uuidv4();
  cartes[id] = {
    nom: "DUHAMEL",
    prenom: "Alexis",
    email: "",
    code: "ADH0624NPI8d"
  };
  res.redirect(`/card/${id}`);
});

app.listen(PORT, () => {
  console.log(`MDL prêt sur ${PUBLIC_HOST}`);
});
