const { app, BrowserWindow, ipcMain } = require("electron");
const http = require("http");
const path = require("path");

const PORT = 3030;
let win = null;
let status = "Starting...";

function createWindow() {
  win = new BrowserWindow({
    width: 640,
    height: 420,
    backgroundColor: "#111111",
    webPreferences: { preload: path.join(__dirname, "preload.js") }
  });
  win.loadFile("index.html");
}

function startServer() {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/sync") {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 65536) req.destroy();
    });
    req.on("end", () => {
      try {
        const event = JSON.parse(body);
        if (win) win.webContents.send("sync-event", event);
        res.writeHead(204).end();
      } catch {
        res.writeHead(400).end();
      }
    });
  });
  server.on("listening", () => (status = `Listening on http://127.0.0.1:${PORT}/sync`));
  server.on("error", error => (status = `Could not listen on port ${PORT}: ${error.message}`));
  server.listen(PORT, "127.0.0.1");
}

ipcMain.handle("status", () => status);

app.whenReady().then(() => {
  startServer();
  createWindow();
});

app.on("window-all-closed", () => app.quit());
