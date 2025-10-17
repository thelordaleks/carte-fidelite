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

// === Code-barres local (plus fiable que tec-it) ===
// GET /barcode?bcid=code128&text=ADH0001&scale=3&height=12&includetext=1
app.get("/barcode", async (req, res) => {
  try {
    const {
      bcid = "code128",     // type de code (ex: code128, code39, qrcode, etc.)
      text = "",
      scale = "3",          // épaisseur des barres
      height = "12",        // hauteur (mm virtuels)
      includetext = "1",    // affiche le texte lisible sous le code
      textxalign = "center",
      paddingwidth = "6",
      paddingheight = "4"
    } = req.query;

    if (!text) return res.status(400).send("Paramètre 'text' requis");

    const png = await bwipjs.toBuffer({
      bcid,
      text,
      scale: +scale,
      height: +height,
      includetext: includetext === "1",
      textxalign,
      paddingwidth: +paddingwidth,
      paddingheight: +paddingheight,
      backgroundcolor: 'FFFFFF'
    });

    res.type("png");
    res.send(png);
  } catch (err) {
    console.error("Barcode error:", err);
    res.status(500).send("Erreur génération code-barres");
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
