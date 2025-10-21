// server.js — version stable sans Universal Links Apple
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const morgan = require("morgan");
const dotenv = require("dotenv");
const bwipjs = require("bwip-js");
const nodemailer = require("nodemailer");
const archiver = require("archiver");
dotenv.config();

const app = express();
app.disable("etag");
app.use(express.json());
app.use(cors());
app.use(morgan("dev"));
app.use("/static", express.static(path.join(__dirname, "static")));
app.use("/app", express.static(path.join(__dirname, "public/app")));
app.use(express.static(path.join(__dirname, "public")));

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || process.env.SECRET || "";
const TEMPLATE_FILE = process.env.TEMPLATE_FILE || path.join(__dirname, "template.html");
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL.replace(/\/+$/, "") : "";
const PORT = process.env.PORT || 10000;

let db;
async function getDb() {
  if (db) return db;
  const { createClient } = await import("@libsql/client");
  db = createClient({
    url: process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL,
    authToken: process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN,
  });
  return db;
}
async function initDb() {
  const dbc = await getDb();
  await dbc.execute(`
    CREATE TABLE IF NOT EXISTS cards(
      code TEXT PRIMARY KEY,
      nom TEXT,
      prenom TEXT,
      email TEXT,
      reduction TEXT,
      points INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

function absoluteBaseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function readFileOrFallback(file, fallback = "") {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return fallback;
  }
}

function replaceTokens(html, data, baseUrl) {
  const fullName = [data.prenom, data.nom].filter(Boolean).join(" ").trim();
  const map = {
    NOM: data.nom || "",
    PRENOM: data.prenom || "",
    FULLNAME: fullName,
    EMAIL: data.email || "",
    POINTS: String(data.points ?? 0),
    CODE: data.code || "",
    REDUCTION: data.reduction || "",
    BARCODE_URL: `${baseUrl}/barcode/${encodeURIComponent(data.code || "")}`,
    CARD_URL: `${baseUrl}/c/${encodeURIComponent(data.code || "")}`,
  };
  let out = String(html || "");
  for (const [k, v] of Object.entries(map)) {
    const patterns = [
      new RegExp(`{{\\s*${k}\\s*}}`, "g"),
      new RegExp(`%%${k}%%`, "g"),
      new RegExp(`\\[\\[\\s*${k}\\s*\\]\\]`, "g"),
      new RegExp(`__${k}__`, "g"),
      new RegExp(`\\$\\{\\s*${k}\\s*\\}`, "g"),
    ];
    for (const p of patterns) out = out.replace(p, v);
  }
  return out;
}

// Création / mise à jour de carte
const dataFile = path.join(__dirname, "data", "lastCodes.json");

app.post("/api/create-card", async (req, res) => {
  try {
    let { code, nom = "", prenom = "", email, mail, reduction = "", points } = req.body || {};
    email = (email || mail || "").trim().toLowerCase();
    code = String(code || "ADH" + Math.random().toString(36).substring(2, 10).toUpperCase());
    const pts = Number(points) || 0;
    const dbc = await getDb();
    await dbc.execute({
      sql: `
        INSERT INTO cards(code,nom,prenom,email,reduction,points)
        VALUES(?,?,?,?,?,?)
        ON CONFLICT(code) DO UPDATE SET
          nom=excluded.nom,
          prenom=excluded.prenom,
          email=excluded.email,
          reduction=excluded.reduction,
          points=excluded.points
      `,
      args: [code, nom, prenom, email, reduction, pts],
    });

    fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
    const dbFile = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile)) : {};
    dbFile[email] = code;
    fs.writeFileSync(dataFile, JSON.stringify(dbFile, null, 2));

    const base = absoluteBaseUrl(req);
    res.json({ ok: true, code, url: `${base}/c/${encodeURIComponent(code)}`, points: pts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "create-failed" });
  }
});

// Lecture carte
app.get("/c/:code", async (req, res) => {
  try {
    const dbc = await getDb();
    const r = await dbc.execute({ sql: "SELECT * FROM cards WHERE code=?", args: [req.params.code] });
    if (!r.rows.length) return res.status(404).send("Carte inconnue");
    const card = r.rows[0];
    const tpl = readFileOrFallback(TEMPLATE_FILE, "<p>Template introuvable</p>");
    const html = replaceTokens(tpl, card, absoluteBaseUrl(req));

    // ✅ Ajout : permettre la mise en cache par le Service Worker
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Content-Type", "text/html; charset=utf-8");

    res.send(html);
  } catch (e) {
    console.error(e);
    res.status(500).send("render-failed");
  }
});


app.get("/api/get-card/:code", async (req, res) => {
  try {
    const dbc = await getDb();
    const r = await dbc.execute({ sql: "SELECT * FROM cards WHERE code=?", args: [req.params.code] });
    if (!r.rows.length) return res.json({ ok: false });
    const c = r.rows[0];
    res.json({ ok: true, fullname: `${c.prenom} ${c.nom}`.trim(), points: c.points || 0, reduction: c.reduction || "—" });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

app.get("/barcode/:txt", async (req, res) => {
  try {
    const png = await bwipjs.toBuffer({
      bcid: "code128",
      text: req.params.txt,
      scale: 3,
      height: 12,
      includetext: false,
      backgroundcolor: "FFFFFF",
    });
    res.setHeader("Content-Type", "image/png");
    res.send(png);
  } catch {
    res.status(400).send("bad-barcode");
  }
});
// === Route spéciale Apple Universal Links ===
// Sert le fichier "apple-app-site-association" sans extension ni cache
app.get('/apple-app-site-association', (req, res) => {
  const filePath = path.join(__dirname, 'apple-app-site-association');
  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'apple-app-site-association introuvable' });
    }

    // ✅ En-têtes Apple obligatoires
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Content-Disposition', 'inline');

    const data = fs.readFileSync(filePath, 'utf8');
    res.send(data);
  } catch (e) {
    console.error("Erreur AASA:", e);
    res.status(500).json({ error: 'Erreur lecture apple-app-site-association' });
  }
});

// Variante .well-known (Safari vérifie aussi ce chemin)
app.get('/.well-known/apple-app-site-association', (req, res) => {
  const filePath = path.join(__dirname, 'public', '.well-known', 'apple-app-site-association');
  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'apple-app-site-association manquant dans .well-known' });
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Content-Disposition', 'inline');

    const data = fs.readFileSync(filePath, 'utf8');
    res.send(data);
  } catch (e) {
    console.error("Erreur AASA (.well-known):", e);
    res.status(500).json({ error: 'Erreur lecture AASA .well-known' });
  }
});
// === Gestion du Service Worker : version auto + anti-cache ===
app.get("/sw.js", (req, res) => {
  // 🔹 chemin du fichier SW réel dans ton dossier public
  const swPath = path.join(__dirname, "public", "sw.js");

  try {
    if (!fs.existsSync(swPath)) {
      return res.status(404).send("// sw.js introuvable");
    }

    // 🔹 version unique basée sur l'heure de déploiement
    const version = process.env.BUILD_ID || new Date().toISOString();

    // 🔹 lecture du contenu et injection de la version
    let content = fs.readFileSync(swPath, "utf8");
    content = `// build:${version}\n` + content;

    // 🔹 en-têtes pour empêcher le cache navigateur
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    // 🔹 envoi du fichier final
    res.send(content);
  } catch (e) {
    console.error("Erreur envoi sw.js:", e);
    res.status(500).send("// Erreur serveur envoi sw.js");
  }
});


initDb().then(() => {
  app.listen(PORT, () => console.log("✅ Serveur MDL actif sur le port", PORT));
});
