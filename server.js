"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const bwipjs = require("bwip-js");

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET || "change-moi";
const TEMPLATE_FILE = process.env.TEMPLATE_FILE || path.join(__dirname, "static", "template.html");

// Static (images, css, etc.)
app.use("/static", express.static(path.join(__dirname, "static"), { maxAge: "1y", etag: true }));

// --- helpers
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function fillTpl(tpl, map) {
  let out = tpl;
  for (const [k, v] of Object.entries(map)) out = out.split(`{{${k}}}`).join(v);
  return out;
}
function makeBaseUrl(req) {
  const host = process.env.RENDER_EXTERNAL_HOSTNAME || req.headers.host || `localhost:${PORT}`;
  const xf = (req.headers["x-forwarded-proto"] || "").toString().split(",")[0].trim();
  const protocol = xf || (host.includes("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}
function euroCentsToString(cents) {
  if (cents == null || cents === "") return "";
  const n = Number(cents) / 100;
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
}

// Charge le template (aucune modif de style/markup)
let templateHtml = fs.readFileSync(TEMPLATE_FILE, "utf8");

// --- routes

// Affichage carte via JWT
app.get("/card/t/:token", (req, res) => {
  try {
    const data = jwt.verify(req.params.token, SECRET);

    const base = makeBaseUrl(req);
    const code = data.code || data.CODE || "";
    const barcodeUrl = `${base}/barcode/${encodeURIComponent(code)}.png?width=640&height=150`;

    const html = fillTpl(templateHtml, {
      PRENOM: escapeHtml(data.firstName || data.prenom || ""),
      NOM: escapeHtml(data.lastName || data.nom || ""),
      EMAIL: escapeHtml(data.email || ""),
      CODE: escapeHtml(code),
      POINTS: escapeHtml(data.points ?? ""),
      REDUCTION: escapeHtml(
        data.reduction != null ? String(data.reduction) : euroCentsToString(data.reduction_cents)
      ),
      BARCODE_URL: barcodeUrl
    });

    res.type("html").send(html);
  } catch (e) {
    console.error(e);
    res.status(400).type("html").send("<h1>Token invalide ou expiré</h1>");
  }
});

// Code‑barres PNG CODE128
app.get("/barcode/:code.png", async (req, res) => {
  try {
    const code = String(req.params.code || "");
    const width = Math.max(200, Math.min(2000, parseInt(req.query.width || "640", 10)));
    const height = Math.max(50, Math.min(600, parseInt(req.query.height || "150", 10)));

    const png = await bwipjs.toBuffer({
      bcid: "code128",
      text: code,
      width,
      height,
      includetext: false,
      textxalign: "center"
    });

    res.type("png").send(png);
  } catch (err) {
    console.error(err);
    res.status(400).type("text/plain").send("Erreur génération code‑barres");
  }
});

// Dev: génération de token (désactivée en prod)
app.get("/dev/make-token", (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).send("Désactivé en production");
  }
  const payload = {
    firstName: req.query.firstName || "Emma",
    lastName: req.query.lastName || "Martin",
    email: req.query.email || "emma@example.com",
    code: req.query.code || "MDL-123456",
    points: req.query.points || "120",
    reduction_cents: req.query.reduction_cents || "500"
  };
  const token = jwt.sign(payload, SECRET, { expiresIn: "7d" });
  res.type("text/plain").send(token);
});

app.get("/", (req, res) => {
  res.type("text/plain").send("OK. Utilisez /dev/make-token puis /card/t/<TOKEN> (en dev).");
});

app.listen(PORT, () => {
  console.log(`Serveur OK sur http://localhost:${PORT}`);
});
