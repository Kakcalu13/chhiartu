const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');

let mainWindow = null;
// Files requested before the window/renderer is ready (dock drop, "Open with", CLI arg).
const pendingPaths = [];

function isMarkdownPath(p) {
  return /\.(md|markdown|mdown|mkd|mdx|markdn|text|txt)$/i.test(p || '');
}

// Collect any markdown path passed on the command line (Finder "Open with" on some setups).
function pathsFromArgv(argv) {
  return argv
    .slice(1)
    .filter((a) => !a.startsWith('-') && isMarkdownPath(a));
}

function sendPath(p) {
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('open-path', p);
  } else {
    pendingPaths.push(p);
  }
}

// macOS: fired when a file is opened via Finder / dropped on the dock icon.
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  sendPath(filePath);
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    minWidth: 480,
    minHeight: 360,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs Node's require for the markdown libs
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Once the renderer signals it's ready, flush any queued files.
  ipcMain.removeHandler('renderer-ready');
  ipcMain.handle('renderer-ready', () => {
    const queued = pendingPaths.splice(0, pendingPaths.length);
    for (const p of queued) mainWindow.webContents.send('open-path', p);
    return true;
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open http(s) links in the user's real browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Allow only the initial file:// load of our own page; send everything else out.
    if (url.startsWith('file://') && url.includes('renderer/index.html')) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
}

// ---- IPC from the renderer ----
ipcMain.handle('pick-file', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Markdown File',
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdx', 'markdn'] },
      { name: 'Text', extensions: ['txt', 'text'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('open-external', (_e, url) => {
  shell.openExternal(url);
});

ipcMain.handle('show-item', (_e, p) => {
  shell.showItemInFolder(p);
});

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow && mainWindow.webContents.send('menu', 'open'),
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow && mainWindow.webContents.send('menu', 'save'),
        },
        {
          label: 'Reload File',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow && mainWindow.webContents.send('menu', 'reload-file'),
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Edit Mode',
          accelerator: 'CmdOrCtrl+E',
          click: () => mainWindow && mainWindow.webContents.send('menu', 'toggle-edit'),
        },
        {
          label: 'Toggle Theme',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => mainWindow && mainWindow.webContents.send('menu', 'toggle-theme'),
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  // Any file the app was launched with.
  for (const p of pathsFromArgv(process.argv)) pendingPaths.push(p);
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
