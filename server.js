const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ====== DEMO TRACKING (MVP) ======
const ADMIN_KEY = process.env.DEMO_ADMIN_KEY ||"mcndigitalstudio" ;
console.log("ADMIN_KEY ACTUAL:", ADMIN_KEY);

function appendJSONL(obj) {
  fs.appendFileSync(LOG_FILE, JSON.stringify(obj) + "\n", "utf8");
}

app.post("/api/track/login", (req, res) => {
  try {
    const { prospectId, role, name } = req.body || {};
    const ip =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.socket.remoteAddress;

    const event = {
      t: new Date().toISOString(),
      type: "login",
      prospectId: String(prospectId || "unknown"),
      role: String(role || "unknown"),
      name: String(name || "unknown"),
      ip,
      ua: req.headers["user-agent"] || ""
    };

    appendJSONL(event);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: "track_failed" });
  }
});

app.get("/admin/demo-stats", (req, res) => {
  const key = req.query.key;
  if (key !== ADMIN_KEY) return res.status(401).send("Unauthorized");

  if (!fs.existsSync(LOG_FILE)) {
    return res.json({ ok: true, total: 0, byProspect: {}, last10: [] });
  }

  const lines = fs.readFileSync(LOG_FILE, "utf8").trim().split("\n").filter(Boolean);
  const events = lines.map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);

  const byProspect = {};
  events.forEach((ev) => {
    const pid = ev.prospectId || "unknown";
    byProspect[pid] = (byProspect[pid] || 0) + 1;
  });

  const last10 = events.slice(-10).reverse();

  res.json({
    ok: true,
    total: events.length,
    byProspect,
    last10
  });
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});


const express = require("express");
const path = require("path");

const app = express();

// ✅ servir carpeta public
app.use(express.static(path.join(__dirname, "public")));

app.listen(3000, () => console.log("http://localhost:3000"));
