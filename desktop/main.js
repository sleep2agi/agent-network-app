// Agent Network desktop shell (Vincent /goal tg 794).
// The expo web export uses absolute asset paths, which break under
// file:// — serve the bundle from an in-process HTTP server instead.
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const WEB_ROOT = path.join(__dirname, 'app');
const SMOKE = process.argv.includes('--smoke');

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const serveWeb = () =>
  new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
      let file = path.normalize(path.join(WEB_ROOT, url));
      if (!file.startsWith(WEB_ROOT)) {
        res.writeHead(403).end();
        return;
      }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        // SPA fallback keeps client-side routes working
        file = path.join(WEB_ROOT, 'index.html');
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });

const createWindow = async () => {
  const port = await serveWeb();
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 420,
    minHeight: 600,
    show: !SMOKE,
    title: 'Agent Network',
    backgroundColor: '#0b0d10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      // The login screen takes an arbitrary hub URL and the page fetches
      // it cross-origin; the hub sets no CORS headers. A desktop shell is
      // a trusted context, so relax web security for the MVP (tracked:
      // replace with a main-process proxy before wider distribution).
      webSecurity: false,
    },
  });
  await win.loadURL(`http://127.0.0.1:${port}/`);

  if (SMOKE) {
    // headless verification: prove the bundle renders inside Electron
    await new Promise(r => setTimeout(r, 2500));
    const image = await win.webContents.capturePage();
    fs.writeFileSync('/tmp/desktop-smoke.png', image.toPNG());
    console.log('SMOKE_OK /tmp/desktop-smoke.png', image.getSize());
    app.exit(0);
  }
};

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
