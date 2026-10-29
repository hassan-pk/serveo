import type { Order, Shop } from '../shared/types';
import { printHTML } from '../shared/printing';
export { printHTML } from '../shared/printing';

export async function printOrder(shop: Shop, order: Order, kind: 'receipt' | 'kitchen' | 'invoice'): Promise<void> {
  const { BrowserWindow } = require('electron') as typeof import('electron');
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(printHTML(shop, order, kind))}`);
    await new Promise<void>((resolve, reject) => window.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
      if (success || /cancel/i.test(reason)) resolve();
      else reject(new Error(reason || 'Printing failed. Check the selected printer.'));
    }));
  } finally { if (!window.isDestroyed()) window.destroy(); }
}
