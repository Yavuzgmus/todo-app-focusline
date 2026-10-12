const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, nativeTheme, shell } = require('electron');
const fs = require('fs');
const path = require('path');

// Uygulama adı (productName) değişse de veriler hep aynı klasörde kalsın.
app.setPath('userData', path.join(app.getPath('appData'), 'todo-uygulama'));

// Aynı anda tek pencere: iki kopya açık olursa birbirinin kaydının üzerine yazabilir.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const dataFile = () => path.join(app.getPath('userData'), 'data.json');
const appStateFile = () => path.join(app.getPath('userData'), 'app-state.json');
const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');

let win = null;
let tray = null;
let isQuitting = false;
let timerRunning = false;

ipcMain.on('store:load', (event) => {
  try {
    event.returnValue = JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
  } catch {
    event.returnValue = null;
  }
});

ipcMain.on('store:save', (event, data) => {
  try {
    // Önce geçici dosyaya yazıp sonra taşıyoruz; yazma yarıda kesilirse eski veri bozulmaz.
    const file = dataFile();
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    event.returnValue = true;
  } catch (err) {
    console.error('Kayıt hatası:', err);
    event.returnValue = false;
  }
});

// Pomodoro bitince pencere arkadaysa görev çubuğunda yanıp sönsün.
ipcMain.on('app:attention', () => {
  if (win && win.isVisible() && !win.isFocused()) win.flashFrame(true);
});

// Davet e-postası: varsayılan e-posta programını aç. Sadece mailto/https adreslerine izin ver.
ipcMain.on('app:open-external', (_event, url) => {
  if (typeof url === 'string' && /^(mailto:|https:\/\/)/i.test(url)) shell.openExternal(url);
});

// Zamanlayıcı durumu: tepsi simgesinin ipucu ve menüsü için.
ipcMain.on('tray:status', (_event, { text, running }) => {
  if (!tray) return;
  tray.setToolTip(text ? `FocusLine · ${text}` : 'FocusLine');
  if (running !== timerRunning) {
    timerRunning = running;
    updateTrayMenu();
  }
});

/* ---------- Küçük uygulama durumu (ilk kez tepsiye inme ipucu vb.) ---------- */

function readAppState() {
  try { return JSON.parse(fs.readFileSync(appStateFile(), 'utf8')); } catch { return {}; }
}

function writeAppState(patch) {
  try { fs.writeFileSync(appStateFile(), JSON.stringify({ ...readAppState(), ...patch }), 'utf8'); } catch {}
}

/* ---------- Pencere ---------- */

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

/* ---------- Tema ---------- */

const THEME_COLORS = {
  light: { bg: '#f5f1fc', symbol: '#5b4a7a' },
  dark: { bg: '#13101c', symbol: '#cfc6e6' },
};

// Kayıtlı tema seçimi; yoksa Windows'un ayarı. Açılışta yanlış renkte parlama olmasın diye.
function initialTheme() {
  try {
    const saved = JSON.parse(fs.readFileSync(dataFile(), 'utf8')).theme;
    if (saved === 'dark' || saved === 'light') {
      nativeTheme.themeSource = saved;
      return saved;
    }
  } catch {}
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

// Renderer tema değiştirince pencere düğmelerinin (küçült/kapat) rengini de değiştir.
ipcMain.on('app:theme', (_event, { theme, explicit }) => {
  if (theme !== 'dark' && theme !== 'light') return;
  nativeTheme.themeSource = explicit ? theme : 'system';
  if (!win) return;
  const c = THEME_COLORS[theme];
  win.setBackgroundColor(c.bg);
  win.setTitleBarOverlay({ color: c.bg, symbolColor: c.symbol, height: 40 });
});

function createWindow() {
  const colors = THEME_COLORS[initialTheme()];
  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: colors.bg,
    title: 'FocusLine',
    icon: iconPath,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: colors.bg,
      symbolColor: colors.symbol,
      height: 40,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Pencere gizliyken de zamanlayıcı yavaşlamasın.
      backgroundThrottling: false,
    },
  });

  // Kapat (X) uygulamayı kapatmaz, saatin yanındaki simgelere küçültür.
  win.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    win.hide();
    const state = readAppState();
    if (!state.trayHintShown && tray && process.platform === 'win32') {
      tray.displayBalloon({
        iconType: 'info',
        title: 'FocusLine arka planda çalışıyor',
        content: 'Zamanlayıcın saymaya devam ediyor. Tamamen kapatmak için bu simgeye sağ tıklayıp "Çık"ı seç.',
      });
      writeAppState({ trayHintShown: true });
    }
  });

  // Windows kapanırken / oturum kapanırken engelleme.
  win.on('session-end', () => { isQuitting = true; });

  win.on('focus', () => win.flashFrame(false));
  win.once('ready-to-show', () => win.show()); // sayfa çizilince göster: beyaz/siyah parlama olmasın
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

/* ---------- Tepsi simgesi ---------- */

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'FocusLine\'ı aç', click: showWindow },
    {
      label: timerRunning ? 'Zamanlayıcıyı duraklat' : 'Zamanlayıcıyı başlat',
      click: () => win && win.webContents.send('timer:toggle'),
    },
    { type: 'separator' },
    { label: 'Çık', click: quitApp },
  ]));
}

function createTray() {
  const image = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16, quality: 'best' });
  tray = new Tray(image);
  tray.setToolTip('FocusLine');
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  updateTrayMenu();
}

/* ---------- Uygulama ---------- */

// Windows bildirimlerinin uygulama adıyla görünmesi için.
app.setAppUserModelId('com.yavuzgumus.bugununplani');

// Kısayola tekrar tıklanırsa yeni kopya açmak yerine mevcut pencereyi göster.
app.on('second-instance', showWindow);

app.on('before-quit', () => { isQuitting = true; });

app.whenReady().then(() => {
  createTray();
  createWindow();
  app.on('activate', showWindow);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
