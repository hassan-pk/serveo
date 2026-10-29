import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { mkdirSync, existsSync, readdirSync, unlinkSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store } from './store';
import { printOrder } from './printing';
import type { OrderStatus, PaymentMethod } from '../shared/types';

app.setName('Serveo');
app.setAppUserModelId('com.serveo.desktop');
if (process.env.SERVEO_DATA_DIR) app.setPath('userData', path.resolve(process.env.SERVEO_DATA_DIR));
let window: BrowserWindow | null = null;
let store: Store;
let timer: NodeJS.Timeout | undefined;
const rendererFile = path.join(__dirname, '../renderer/index.html');
const devURL = process.env.SERVEO_DEV_URL;
if (devURL && devURL !== 'http://127.0.0.1:5173') throw new Error('Invalid development URL');
const allowedURL = devURL || pathToFileURL(rendererFile).href;

function owner() {
  if (store.snapshot().user?.role !== 'owner') throw new Error('Owner access required');
}
function backupDirectory() {
  const directory = path.join(app.getPath('userData'), 'backups');
  mkdirSync(directory, { recursive: true });
  return directory;
}
function atomicBackup(target: string) {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    store.backupTo(temporary);
    renameSync(temporary, target);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
function automaticBackup() {
  const directory = backupDirectory();
  const date = new Date().toISOString().slice(0, 10);
  const target = path.join(directory, `automatic-${date}.sqlite`);
  atomicBackup(target);
  const files = readdirSync(directory).filter(file => /^automatic-\d{4}-\d{2}-\d{2}\.sqlite$/.test(file)).sort();
  for (const file of files.slice(0, Math.max(0, files.length - 30))) unlinkSync(path.join(directory, file));
}
function installHandlers() {
  const register = (name: string, handler: (...args: any[]) => unknown) => ipcMain.handle(`serveo:${name}`, (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== allowedURL) throw new Error('Untrusted application frame');
    return handler(...args);
  });
  register('snapshot', () => store.snapshot());
  register('setup', input => store.setup(input));
  register('login', (username, password) => store.login(username, password));
  register('logout', () => store.logout());
  register('changePassword', input => store.changePassword(input));
  register('setRecoveryToken', input => store.setRecoveryToken(input));
  register('beginPasswordReset', (username, token) => store.beginPasswordReset(username, token));
  register('resetPassword', (password, confirmation) => store.resetPassword(password, confirmation));
  register('saveShop', input => store.saveShop(input));
  register('saveProduct', input => store.saveProduct(input));
  register('saveUser', input => store.saveUser(input));
  register('createOrder', input => store.createOrder(input));
  register('setOrderStatus', (id: string, status: OrderStatus) => store.setOrderStatus(id, status));
  register('collectPayment', (id: string, method: PaymentMethod, received: number) => store.collectPayment(id, method, received));
  register('refundOrder', (id, reason, disposition) => store.refundOrder(id, reason, disposition));
  register('addExpense', input => store.addExpense(input));
  register('openDay', cash => store.openDay(cash));
  register('closeDay', cash => {
    const result = store.closeDay(cash);
    try { automaticBackup(); } catch (error) { console.error('Closing backup failed:', error); }
    return result;
  });
  register('exportBackup', async () => {
    owner();
    const result = await dialog.showSaveDialog(window!, { title: 'Export Serveo backup', defaultPath: `Serveo-backup-${new Date().toISOString().slice(0, 10)}.sqlite`, filters: [{ name: 'Serveo SQLite backup', extensions: ['sqlite'] }] });
    if (result.canceled || !result.filePath) return null;
    owner();
    if (path.resolve(result.filePath) === path.resolve(app.getPath('userData'), 'serveo.sqlite')) throw new Error('Choose a different backup path');
    atomicBackup(result.filePath);
    return result.filePath;
  });
  register('restoreBackup', async () => {
    owner();
    const result = await dialog.showOpenDialog(window!, { title: 'Choose Serveo backup to restore', properties: ['openFile'], filters: [{ name: 'Serveo SQLite backup', extensions: ['sqlite'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const confirmation = await dialog.showMessageBox(window!, { type: 'warning', title: 'Restore business records', message: 'Replace current records with this backup?', detail: `${result.filePaths[0]}\nA recovery copy of your current records will be saved before restoring. You will need to sign in again.`, buttons: ['Cancel', 'Restore backup'], defaultId: 0, cancelId: 0 });
    if (confirmation.response !== 1) return null;
    owner();
    store.backupTo(path.join(backupDirectory(), `before-restore-${Date.now()}.sqlite`));
    store.restoreFrom(result.filePaths[0]);
    return store.snapshot();
  });
  register('printOrder', async (id, kind) => {
    const snapshot = store.snapshot();
    if (!snapshot.user || !snapshot.shop) throw new Error('Sign in to print');
    if (!['receipt', 'kitchen', 'invoice'].includes(kind)) throw new Error('Invalid print format');
    const order = snapshot.orders.find(order => order.id === id);
    if (!order) throw new Error('Order not found');
    await printOrder(snapshot.shop, order, kind);
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });
  app.whenReady().then(async () => {
    mkdirSync(app.getPath('userData'), { recursive: true });
    store = new Store(path.join(app.getPath('userData'), 'serveo.sqlite'));
    try { automaticBackup(); } catch (error) { console.error('Automatic backup failed:', error); }
    timer = setInterval(() => { try { automaticBackup(); } catch (error) { console.error('Automatic backup failed:', error); } }, 60 * 60 * 1000);
    installHandlers();
    window = new BrowserWindow({ width: 1440, height: 940, minWidth: 900, minHeight: 650, title: 'Serveo', icon: app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(__dirname, '../../build/icon.png'), backgroundColor: '#f7f6f2', webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    window.removeMenu();
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (url !== allowedURL) event.preventDefault(); });
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.session.on('will-download', event => event.preventDefault());
    if (devURL) await window.loadURL(devURL); else await window.loadFile(rendererFile);
  }).catch(error => { dialog.showErrorBox('Serveo could not start', String(error)); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    if (timer) clearInterval(timer);
    if (store) {
      try { automaticBackup(); } catch (error) { console.error('Exit backup failed:', error); }
      store.close();
    }
  });
}
