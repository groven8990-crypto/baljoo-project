const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const https = require('https');

// ──────────────────────────────────────────────────────────────────────────────
// 설정: 어느 브랜치의 HTML을 원격 로드할지
// ──────────────────────────────────────────────────────────────────────────────
const REPO_OWNER = 'groven8990-crypto';
const REPO_NAME = 'baljoo-project';
const REMOTE_BRANCH = 'main';
const HTML_REMOTE_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REMOTE_BRANCH}/src/index.html`;

const userDataPath = app.getPath('userData');
const cachedHtmlPath = path.join(userDataPath, 'index.html');
const userVendorDir = path.join(userDataPath, 'vendor');
const bundledHtmlPath = path.join(__dirname, 'index.html');
const bundledVendorDir = path.join(__dirname, 'vendor');

function copyVendorIfNeeded() {
  if (!fs.existsSync(userVendorDir)) fs.mkdirSync(userVendorDir, { recursive: true });
  try {
    const files = fs.readdirSync(bundledVendorDir);
    for (const f of files) {
      const src = path.join(bundledVendorDir, f);
      const dst = path.join(userVendorDir, f);
      // 항상 덮어쓰기 (라이브러리 버전 업그레이드 대응)
      fs.copyFileSync(src, dst);
    }
  } catch (e) {
    console.warn('vendor copy 실패:', e.message);
  }
}

function fetchRemoteHtml(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = https.get(HTML_REMOTE_URL, { headers: { 'Cache-Control': 'no-cache' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

async function prepareHtmlAndGetPath() {
  copyVendorIfNeeded();

  try {
    const html = await fetchRemoteHtml();
    if (html && html.length > 1000 && html.includes('</html>')) {
      fs.writeFileSync(cachedHtmlPath, html, 'utf8');
      console.log('[remote-html] 최신 HTML 로드 완료 (' + html.length + ' bytes)');
    } else {
      throw new Error('invalid html');
    }
  } catch (e) {
    console.warn('[remote-html] 원격 로드 실패, 캐시/번들 사용:', e.message);
  }

  if (fs.existsSync(cachedHtmlPath)) return cachedHtmlPath;
  return bundledHtmlPath;
}

let mainWindow = null;

async function createWindow() {
  const htmlPath = await prepareHtmlAndGetPath();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: '발주 자동화',
    icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.loadFile(htmlPath);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_DEBUG === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// 새로고침 시에도 원격에서 HTML 다시 받아오기 위해 Ctrl+R / F5 인터셉트
function setupReloadHook() {
  mainWindow.webContents.on('before-input-event', async (event, input) => {
    const isReload =
      (input.key === 'F5' && input.type === 'keyDown') ||
      (input.key === 'r' && input.control && input.type === 'keyDown');
    if (!isReload) return;
    event.preventDefault();
    const htmlPath = await prepareHtmlAndGetPath();
    mainWindow.loadFile(htmlPath);
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// 자동 업데이트 (electron-updater + GitHub Releases)
// ──────────────────────────────────────────────────────────────────────────────
function setupAutoUpdater() {
  if (!app.isPackaged) return; // 개발 모드에서는 스킵

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] 새 버전 감지:', info.version);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] 최신 버전 사용 중');
  });

  autoUpdater.on('error', (err) => {
    console.warn('[updater] 오류:', err.message);
  });

  autoUpdater.on('update-downloaded', async (info) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['지금 재시작', '나중에'],
      defaultId: 0,
      cancelId: 1,
      title: '업데이트 준비 완료',
      message: `발주 자동화 ${info.version} 버전이 다운로드되었습니다.`,
      detail: '지금 재시작하면 새 버전이 적용됩니다.',
    });
    if (result.response === 0) autoUpdater.quitAndInstall();
  });

  // 시작 후 잠시 뒤 체크 (앱 로딩 방해 안 하도록)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => console.warn('[updater]', e.message));
  }, 5000);
}

const menuTemplate = [
  {
    label: '파일',
    submenu: [{ role: 'quit', label: '종료' }],
  },
  {
    label: '편집',
    submenu: [
      { role: 'undo', label: '실행 취소' },
      { role: 'redo', label: '다시 실행' },
      { type: 'separator' },
      { role: 'cut', label: '잘라내기' },
      { role: 'copy', label: '복사' },
      { role: 'paste', label: '붙여넣기' },
      { role: 'selectAll', label: '모두 선택' },
    ],
  },
  {
    label: '보기',
    submenu: [
      {
        label: '새로 고침 (최신 HTML 받기)',
        accelerator: 'CmdOrCtrl+R',
        click: async () => {
          if (!mainWindow) return;
          const htmlPath = await prepareHtmlAndGetPath();
          mainWindow.loadFile(htmlPath);
        },
      },
      { role: 'forceReload', label: '강제 새로 고침' },
      { role: 'toggleDevTools', label: '개발자 도구' },
      { type: 'separator' },
      { role: 'resetZoom', label: '실제 크기' },
      { role: 'zoomIn', label: '확대' },
      { role: 'zoomOut', label: '축소' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: '전체 화면' },
    ],
  },
  {
    label: '도움말',
    submenu: [
      {
        label: '업데이트 확인',
        click: () => {
          if (!app.isPackaged) {
            dialog.showMessageBox(mainWindow, { message: '개발 모드에서는 업데이트 확인을 지원하지 않습니다.' });
            return;
          }
          autoUpdater.checkForUpdates();
        },
      },
      {
        label: '버전 정보',
        click: () => {
          dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: '버전 정보',
            message: '발주 자동화',
            detail: `버전 ${app.getVersion()}\nHTML 원본: ${REPO_OWNER}/${REPO_NAME}@${REMOTE_BRANCH}`,
          });
        },
      },
    ],
  },
];

app.whenReady().then(async () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
  await createWindow();
  setupReloadHook();
  setupAutoUpdater();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
