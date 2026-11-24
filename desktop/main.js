// Electron desktop shell: boots the embedded API server on a free local port and opens the app window.
// The same REST API is reachable from other tools on this machine while the desktop app is running.
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const { createApp } = require('../server/app');

let server, ctx;

function start() {
  ctx = createApp({ dataDir: path.join(app.getPath('userData'), 'data') });
  const port = Number(process.env.PORT || 4601);
  return new Promise((resolve) => {
    server = ctx.app.listen(port, '127.0.0.1', () => resolve(server.address().port));
    server.on('error', () => { server = ctx.app.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
  });
}

async function createWindow() {
  const port = await start();
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 980, minHeight: 640,
    backgroundColor: '#0b1020', title: 'PharmaChain OS',
    icon: path.join(__dirname, '..', 'public', 'icon.svg'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'PharmaChain', submenu: [
      { label: `API: http://127.0.0.1:${port}/api/v1`, enabled: false },
      { label: 'Open API docs in browser', click: () => shell.openExternal(`http://127.0.0.1:${port}/#/developer`) },
      { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'quit' },
    ] },
    { role: 'editMenu' }, { role: 'viewMenu' },
  ]));
  await win.loadURL(`http://127.0.0.1:${port}/#/tower`);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (ctx) ctx.stop(); if (server) server.close(); app.quit(); });
