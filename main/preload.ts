const { contextBridge, ipcRenderer } = require('electron');
const { randomUUID } = require('node:crypto');

const documentNonce = randomUUID();
ipcRenderer.sendSync('window-document', documentNonce);

function invokeAuthenticated(channel: string, ...args: unknown[]) {
  let sessionToken: string | null = null;
  try { sessionToken = localStorage.getItem('token'); } catch { /* Unavailable storage denies privileged calls. */ }
  return ipcRenderer.invoke(channel, ...args, { sessionToken });
}

contextBridge.exposeInMainWorld('electronAPI', {
  backupDatabase: (pin?: string) => invokeAuthenticated('backup-database', pin),
  restoreBackup: (pin?: string, backupPath?: string) => invokeAuthenticated('restore-backup', pin, backupPath),
  dbHealthCheck: () => invokeAuthenticated('db-health-check'),
  dbApplySafeFixes: (findingIds?: string[]) => invokeAuthenticated('db-apply-safe-fixes', findingIds),
  dbInitialize: (pin: string, confirmationPhrase: string) => invokeAuthenticated('db-initialize', { pin, confirmationPhrase }),
  getMasterPinStatus: () => ipcRenderer.invoke('master-pin-status'),

  getPublicSettings: () => ipcRenderer.invoke('get-public-settings'),
  getSettings: () => invokeAuthenticated('get-settings'),
  setSetting: (key: string, value: string) => invokeAuthenticated('set-setting', key, value),

  // Pushes resolved dark mode state to main for native title bar updates.
  setThemeEffective: (isDark: boolean) => ipcRenderer.invoke('set-theme-effective', isDark),

  getKdsInfo: () => ipcRenderer.invoke('get-kds-info'),
  openKdsWindow: () => ipcRenderer.invoke('open-kds-window'),

  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  getLogTail: () => invokeAuthenticated('get-log-tail'),

  // Fire-and-forget: reports a caught renderer render exception (see the
  // dashboard error boundary) to anonymous telemetry via main.
  reportRendererError: (report: { message?: string; stack?: string; digest?: string; route?: string }) =>
    ipcRenderer.invoke('report-renderer-error', report),

  getStatus: () => ipcRenderer.invoke('get-status'),
  openWhatsAppShare: (url: string) => ipcRenderer.invoke('whatsapp-open-share', url),

  windowReady: (payload: { epoch: number }) => ipcRenderer.invoke('window-ready', { ...payload, documentNonce }),

  // Narrow window-control surface for the renderer title bar's HTML fallback
  // controls and the POS topbar's native window-state toggle.
  windowAction: (action: string) => ipcRenderer.invoke('window-action', action),

  getWindowState: () => ipcRenderer.invoke('get-window-state'),
  onWindowStateChanged: (callback: (state: { isMaximized: boolean; isFullScreen: boolean }) => void) => {
    const handler = (_event: unknown, state: { isMaximized: boolean; isFullScreen: boolean }) => callback(state);
    ipcRenderer.on('window-state-changed', handler);
    return () => { ipcRenderer.removeListener('window-state-changed', handler); };
  },

  getPrinters: () => invokeAuthenticated('get-printers'),
  savePrinter: (printer: unknown) => invokeAuthenticated('save-printer', printer),
  rasterizePrintDocument: (request: unknown) => ipcRenderer.invoke('rasterize-print-document', request),
  rasterizeKotDocument: (request: unknown) => ipcRenderer.invoke('rasterize-kot-document', request),

  getDailySummary: () => invokeAuthenticated('get-daily-summary'),

  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  getBetaChannel: () => ipcRenderer.invoke('updates:get-beta-channel'),
  setBetaChannel: (enabled: boolean) => invokeAuthenticated('updates:set-beta-channel', enabled),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => invokeAuthenticated('download-update'),
  restartAndInstall: (pin?: string) => invokeAuthenticated('restart-and-install', pin),
  onUpdateStatus: (callback: (status: unknown) => void) => {
    const handler = (_event: unknown, status: unknown) => callback(status);
    ipcRenderer.on('update-status', handler);
    return () => { ipcRenderer.removeListener('update-status', handler); };
  },

  onMenuAction: (callback: (channel: string) => void) => {
    const channels = [
      'new-order', 'quick-search', 'backup-database', 'restore-backup',
      'view-orders', 'report-daily', 'report-sales', 'report-x', 'report-z',
      'settings-business', 'settings-tax', 'settings-printer', 'settings-kitchen',
      'menu-db-health-check', 'menu-db-initialize', 'menu-master-pin',
    ];
    const handlers: (() => void)[] = [];
    channels.forEach((channel) => {
      const handler = () => callback(channel);
      ipcRenderer.on(channel, handler);
      handlers.push(() => ipcRenderer.removeListener(channel, handler));
    });
    return () => { handlers.forEach((remove) => remove()); };
  },

  platform: process.platform,
});
