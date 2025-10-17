// ===== Dépendances =====
const express = require("express");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;

// Détecte l'URL publique Render (ou BASE_URL si fournie)
const PUBLIC_HOST =
  process.env.BASE_URL
    || (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : `http://localhost:${PORT}`);

// ===== Middlewares =====
app.set("trust proxy", 1);
app.use(express.json());
app.use("/static", express.static(path.join(__dirname, "static")));

// Active EJS si tu as /views/card.ejs
try {
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
} catch { /* EJS optionnel */ }

// ===== Mémoire temporaire (attention: perdue au redémarrage) =====
const cartes = {};

// ===== Santé =====
app.get("/health", (_req, res) => res.send("OK"));

// ===== Page d'accueil =====
app.get("/", (_req, res) => {
  res.send(`
    <html>
      <head><title>Serveur Carte Fidélité MDL</title></head>
      <body style="font-family:Arial;text-align:center;padding:40px">
        <h2>✅ Serveur MDL en ligne</h2>
        <p>Les routes disponibles :</p>
        <ul style="list-style:none">
          <li><a href="/new">/new</a> — Test carte (affiche l'image de fond)</li>
          <li><code>POST /api/create-card</code> — API pour Excel</li>
          <li><code>/card/:id</code> — Afficher une carte générée</li>
        </ul>
      </body>
    </html>
  `);
});

// ===== Test design (vérifie images) =====
app.get("/new", (_req, res) => {
  res.send(`
    <html>
      <head><title>Test Carte MDL</title></head>
      <body style="text-align:center;font-family:Arial;">
        <h2>Carte de fidélité test MDL</h2>
        <img src="/static/card-bg.png" style="width:320px;border-radius:12px;">
        <div style="margin-top:10px;"><img src="/static/logo.png" style="height:40px;"></div>
      </body>
    </html>
  `);
});

// ===== API appelée par Excel =====
app.post("/api/create-card", (req, res) => {
  const { nom, prenom, email, code } = req.body || {};
  if (!nom || !prenom || !code) {
    console.log("❌ Champs manquants:", req.body);
    return res.status(400).json({ error: "Champs manquants" });
  }

  const id = uuidv4();
  cartes[id] = { nom, prenom, email, code };

  const url = `${PUBLIC_HOST}/card/${id}`;
  console.log(`✅ Carte générée : ${nom} ${prenom} → ${url}`);
  // Garde le format { url } pour rester compatible avec ta macro actuelle
  res.json({ url, id });
});

// ===== Page carte =====
app.get("/card/:id", (req, res) => {
  const id = req.params.id;
  const carte = cartes[id];
  if (!carte) {
    return res.status(404).send("<h1>Carte introuvable ❌</h1>");
  }

  // Si EJS est dispo et que views/card.ejs existe, on l'utilise
  if (app.get("view engine") === "ejs") {
    return res.render("card", { carte });
  }

  // Fallback HTML inline si EJS absent
  res.send(`
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Carte de fidélité MDL</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; background: #f2f2f2; padding: 40px; }
          .carte { background: white; border-radius: 16px; box-shadow: 0 4px 10px rgba(0,0,0,0.25); display: inline-block; padding: 20px; }
          .carte img.bg { width: 320px; border-radius: 12px; margin-bottom: 15px; }
          .infos { font-size: 16px; color: #333; }
        </style>
      </head>
      <body>
        <div class="carte">
          <img class="bg" src="/static/card-bg.png" alt="Carte fidélité">
          <div class="infos">
            <p><strong>${carte.nom} ${carte.prenom}</strong></p>
            <p>Code adhérent : ${carte.code}</p>
            <div style="margin-top:10px;background:#fff;display:inline-block;padding:4px;border-radius:6px;">
              <img src="https://barcode.tec-it.com/barcode.ashx?data=${encodeURIComponent(carte.code)}&code=Code128&translate-esc=off" alt="barcode" />
            </div>
          </div>
        </div>
      </body>
    </html>
  `);
});

// ===== 404 en dernier =====
app.use((req, res) => {
  console.warn("404:", req.method, req.originalUrl, "ref:", req.get("referer"));
  res.status(404).send("Not Found");
});

// ===== Démarrage =====
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré: ${PUBLIC_HOST}`);
});
