import './pdf-polyfills';
import { app, BrowserWindow } from 'electron';
import path from 'path';
import { initDatabase } from './database';
import { registerIPCHandlers } from './ipc-handlers';

console.log('MAIN: Term Manager starting...');
console.log('MAIN: Electron version:', process.versions.electron);

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  console.log('MAIN: Creating main window...');
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/preload.cjs')
    }
  });

  const url = process.env.NODE_ENV === 'development'
    ? 'http://localhost:5173'
    : `file://${path.join(__dirname, '../renderer/index.html')}`;

  console.log(`MAIN: Loading URL: ${url}`);
  mainWindow.loadURL(url);
  
  // 开发模式下打开DevTools
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    console.log('MAIN: Window closed');
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  console.log('MAIN: App is ready, initializing database...');
  
  // 初始化数据库
  try {
    initDatabase();
    console.log('MAIN: Database initialized successfully');
  } catch (error) {
    console.error('MAIN: Database initialization failed:', error);
  }
  
  // 注册IPC处理器
  registerIPCHandlers();
  console.log('MAIN: IPC handlers registered');
  
  // 创建窗口
  createWindow();
  console.log('MAIN: Main window created');
});

app.on('window-all-closed', () => {
  console.log('MAIN: All windows closed');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  console.log('MAIN: App activated');
  if (mainWindow === null) {
    createWindow();
  }
});
