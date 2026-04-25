// =============================================================================
// NIGHTFALL — server.js
// Local WebSocket relay server.
// Bridges the iPhone controller page to the desktop game.
//
// Usage:
//   npm install        (first time only)
//   node server.js
//
// Then open http://<your-local-IP>:3000 on the desktop browser.
// Scan the QR code shown in-game to open the controller on your iPhone.
// =============================================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { WebSocketServer } = require("ws");

const PORT = 3000;

// ── Detect local network IP ───────────────────────────────────────────────────
function getLocalIP() {
  const nets = os.networkInterfaces();
  const candidates = [];

  for (const [name, ifaces] of Object.entries(nets)) {
    for (const iface of ifaces) {
      if (iface.family !== "IPv4" || iface.internal) continue;

      // Prefer known Wi-Fi / Ethernet interface names (macOS: en0/en1, Linux: wlan0/eth0)
      const isPreferred =
        /^en[01]$/.test(name) || // macOS Wi-Fi / Ethernet
        /^wlan\d/.test(name) || // Linux Wi-Fi
        /^eth\d/.test(name) || // Linux Ethernet
        /^Ethernet/.test(name) || // Windows Ethernet
        /^Wi-Fi/.test(name); // Windows Wi-Fi

      candidates.push({ address: iface.address, preferred: isPreferred, name });
    }
  }

  if (candidates.length === 0) return "127.0.0.1";

  // Sort: preferred interfaces first, then by address (192.168.x.x over 10.x / 172.x)
  candidates.sort((a, b) => {
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    const aLocal = a.address.startsWith("192.168") ? 0 : 1;
    const bLocal = b.address.startsWith("192.168") ? 0 : 1;
    return aLocal - bLocal;
  });

  return candidates[0].address;
}
const LOCAL_IP = getLocalIP();

// ── MIME types for static file serving ───────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// ── HTTP server — serves all game files statically ───────────────────────────
const httpServer = http.createServer((req, res) => {
  // Route /controller → controller.html
  let urlPath = req.url.split("?")[0]; // strip query string
  if (urlPath === "/") urlPath = "/index.html";
  if (urlPath === "/controller") urlPath = "/controller.html";

  const filePath = path.join(__dirname, urlPath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found: " + urlPath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "text/plain" });
    res.end(data);
  });
});

// ── WebSocket server (shares the HTTP server's port) ─────────────────────────
const wss = new WebSocketServer({ server: httpServer });

// Track the single game client and all connected controllers
let gameClient = null;
const controllers = new Set();

function broadcast(ws, obj) {
  if (ws && ws.readyState === 1 /* OPEN */) {
    ws.send(JSON.stringify(obj));
  }
}

wss.on("connection", (ws, req) => {
  const remote = req.socket.remoteAddress;
  console.log(`  ↳ connection from ${remote}`);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // ── Registration handshake ─────────────────────────────────────────────
    if (msg.type === "register") {
      if (msg.role === "game") {
        gameClient = ws;
        console.log("  ✅  game client registered");
        // Tell the game its own network address so it can build the QR URL
        broadcast(ws, {
          type: "serverInfo",
          ip: LOCAL_IP,
          port: PORT,
        });
      } else if (msg.role === "controller") {
        controllers.add(ws);
        console.log(
          `  📱  controller registered  (total: ${controllers.size})`,
        );
        broadcast(ws, { type: "ready" });
        // Notify game
        broadcast(gameClient, {
          type: "controllerConnected",
          count: controllers.size,
        });
      }
      return;
    }

    // ── Controller → Game actions ──────────────────────────────────────────
    // Forward controller actions/messages verbatim to the game client.
    // Supported now: "fire", "reload", "move", "look", "calibrate", "start"
    if (msg.type === "look" || msg.type === "move") {
      // High-frequency stream; forward silently to avoid terminal spam.
      broadcast(gameClient, msg);
      return;
    }

    if (
      msg.type === "fire" ||
      msg.type === "reload" ||
      msg.type === "calibrate" ||
      msg.type === "start"
    ) {
      console.log(`  🎮  ${msg.type} from controller`);
      broadcast(gameClient, msg);
      return;
    }
  });

  ws.on("close", () => {
    if (ws === gameClient) {
      gameClient = null;
      console.log("  ✖  game client disconnected");
      return;
    }
    if (controllers.has(ws)) {
      controllers.delete(ws);
      console.log(`  ✖  controller disconnected  (total: ${controllers.size})`);
      broadcast(gameClient, {
        type: "controllerDisconnected",
        count: controllers.size,
      });
    }
  });

  ws.on("error", (err) => {
    // Swallow individual socket errors; they will fire "close" next
    console.warn("  ⚠  socket error:", err.message);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  🎮  NIGHTFALL  server started");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Game:       http://${LOCAL_IP}:${PORT}`);
  console.log(`  Controller: http://${LOCAL_IP}:${PORT}/controller`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Print ALL non-internal IPs so the user can try alternatives if the main one is wrong
  const os2 = require("os");
  const allNets = os2.networkInterfaces();
  const extras = [];
  for (const [name, ifaces] of Object.entries(allNets)) {
    for (const iface of ifaces) {
      if (
        iface.family === "IPv4" &&
        !iface.internal &&
        iface.address !== LOCAL_IP
      ) {
        extras.push(`  Also try:   http://${iface.address}:${PORT}  (${name})`);
      }
    }
  }
  if (extras.length) console.log(extras.join("\n"));

  console.log("\n  1. Open the Game URL on your desktop browser.");
  console.log("  2. Click 📱 Controller button in-game to get QR code.");
  console.log("  3. Scan with iPhone (same Wi-Fi network required).\n");
  console.log("  ⚠  Keep this terminal window open while playing.\n");
});
