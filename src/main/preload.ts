import { contextBridge, ipcRenderer } from 'electron';
import type { ServeoAPI } from '../shared/types';

const api: ServeoAPI = {
  snapshot: () => ipcRenderer.invoke('serveo:snapshot'),
  setup: input => ipcRenderer.invoke('serveo:setup', input),
  login: (username, password) => ipcRenderer.invoke('serveo:login', username, password),
  logout: () => ipcRenderer.invoke('serveo:logout'),
  changePassword: input => ipcRenderer.invoke('serveo:changePassword', input),
  setRecoveryToken: input => ipcRenderer.invoke('serveo:setRecoveryToken', input),
  beginPasswordReset: (username, token) => ipcRenderer.invoke('serveo:beginPasswordReset', username, token),
  resetPassword: (password, confirmation) => ipcRenderer.invoke('serveo:resetPassword', password, confirmation),
  saveShop: shop => ipcRenderer.invoke('serveo:saveShop', shop),
  saveProduct: product => ipcRenderer.invoke('serveo:saveProduct', product),
  saveUser: input => ipcRenderer.invoke('serveo:saveUser', input),
  createOrder: input => ipcRenderer.invoke('serveo:createOrder', input),
  setOrderStatus: (id, status) => ipcRenderer.invoke('serveo:setOrderStatus', id, status),
  collectPayment: (id, method, received) => ipcRenderer.invoke('serveo:collectPayment', id, method, received),
  refundOrder: (id, reason, disposition) => ipcRenderer.invoke('serveo:refundOrder', id, reason, disposition),
  addExpense: input => ipcRenderer.invoke('serveo:addExpense', input),
  openDay: cash => ipcRenderer.invoke('serveo:openDay', cash),
  closeDay: cash => ipcRenderer.invoke('serveo:closeDay', cash),
  exportBackup: () => ipcRenderer.invoke('serveo:exportBackup'),
  restoreBackup: () => ipcRenderer.invoke('serveo:restoreBackup'),
  printOrder: (id, kind) => ipcRenderer.invoke('serveo:printOrder', id, kind),
};
contextBridge.exposeInMainWorld('serveo', api);
