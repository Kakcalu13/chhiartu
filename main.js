const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme } = require('electron');
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

function send(channel, payload) {
  if (mainWindow) mainWindow.webContents.send(channel, payload);
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
    width: 1440,
    height: 940,
    minWidth: 720,
    minHeight: 480,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 19, y: 15 },
    // The sidebar material is what gives the window its native macOS depth; the
    // reading canvas paints an opaque surface over it so text stays crisp.
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    backgroundColor: '#00000000',
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

  mainWindow.on('enter-full-screen', () => send('fullscreen', true));
  mainWindow.on('leave-full-screen', () => send('fullscreen', false));

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

ipcMain.handle('pick-folder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Documentation Folder',
    properties: ['openDirectory'],
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

ipcMain.handle('open-in-editor', (_e, p) => {
  // Hand the file to whatever the user has registered for editing markdown.
  shell.openPath(p);
});

ipcMain.handle('print', () => {
  if (mainWindow) mainWindow.webContents.print({ silent: false, printBackground: true });
});

ipcMain.handle('export-pdf', async (_e, suggestedName) => {
  if (!mainWindow) return { ok: false };
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Export PDF',
    defaultPath: suggestedName || 'document.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try {
    const data = await mainWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'Letter',
      margins: { marginType: 'custom', top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
    });
    require('fs').writeFileSync(res.filePath, data);
    shell.showItemInFolder(res.filePath);
    return { ok: true, path: res.filePath };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// Keep the native window material in step with the in-app theme toggle.
ipcMain.handle('set-native-theme', (_e, source) => {
  if (source === 'light' || source === 'dark' || source === 'system') {
    nativeTheme.themeSource = source;
  }
});

function menuItem(label, accelerator, action) {
  return { label, accelerator, click: () => send('menu', action) };
}

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
        menuItem('Open…', 'CmdOrCtrl+O', 'open'),
        menuItem('Open Folder…', 'CmdOrCtrl+Shift+O', 'open-folder'),
        { type: 'separator' },
        menuItem('New Tab', 'CmdOrCtrl+T', 'new-tab'),
        menuItem('Close Tab', 'CmdOrCtrl+W', 'close-tab'),
        menuItem('Pin Tab', 'CmdOrCtrl+Shift+P', 'pin-tab'),
        { type: 'separator' },
        menuItem('Save', 'CmdOrCtrl+S', 'save'),
        menuItem('Reload File', 'CmdOrCtrl+R', 'reload-file'),
        { type: 'separator' },
        menuItem('Export as PDF…', 'CmdOrCtrl+Shift+E', 'export'),
        menuItem('Print…', 'CmdOrCtrl+P', 'print'),
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
        { type: 'separator' },
        menuItem('Find in Document…', 'CmdOrCtrl+F', 'find'),
        menuItem('Search Documentation…', 'CmdOrCtrl+K', 'search'),
      ],
    },
    {
      label: 'View',
      submenu: [
        menuItem('Toggle Sidebar', 'CmdOrCtrl+Alt+S', 'toggle-sidebar'),
        menuItem('Toggle Table of Contents', 'CmdOrCtrl+Alt+T', 'toggle-toc'),
        menuItem('Focus Mode', 'CmdOrCtrl+Shift+F', 'toggle-focus'),
        { type: 'separator' },
        menuItem('Split View', 'CmdOrCtrl+\\', 'toggle-split'),
        menuItem('Focus Left Pane', 'CmdOrCtrl+1', 'focus-pane-1'),
        menuItem('Focus Right Pane', 'CmdOrCtrl+2', 'focus-pane-2'),
        { type: 'separator' },
        menuItem('Quick Outline', 'CmdOrCtrl+Shift+K', 'outline'),
        menuItem('Edit Source', 'CmdOrCtrl+E', 'toggle-edit'),
        { type: 'separator' },
        menuItem('Toggle Theme', 'CmdOrCtrl+Shift+L', 'toggle-theme'),
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
    {
      label: 'Go',
      submenu: [
        menuItem('Back', 'CmdOrCtrl+[', 'back'),
        menuItem('Forward', 'CmdOrCtrl+]', 'forward'),
        { type: 'separator' },
        menuItem('Next Tab', 'Control+Tab', 'next-tab'),
        menuItem('Previous Tab', 'Control+Shift+Tab', 'prev-tab'),
        { type: 'separator' },
        menuItem('Next Document', 'CmdOrCtrl+Down', 'next-doc'),
        menuItem('Previous Document', 'CmdOrCtrl+Up', 'prev-doc'),
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
