import { ipcMain } from 'electron';
import { authenticateSession } from './auth-session';
import { hasRole, type Role } from '../shared/role-permissions';

export function isTrustedSender(event: Pick<Electron.IpcMainInvokeEvent, 'sender'>): boolean {
  try {
    const url = new URL(event.sender?.getURL?.() ?? '');
    return url.protocol === 'http:' && !url.username && !url.password
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

export function handleAuthenticated<Args extends unknown[]>(
  channel: string,
  roles: readonly Role[],
  listener: (event: Electron.IpcMainInvokeEvent, ...args: Args) => unknown,
): void {
  ipcMain.handle(channel, (event: Electron.IpcMainInvokeEvent, ...rawArgs: unknown[]) => {
    if (!isTrustedSender(event)) return { error: 'Unauthorized sender' };
    const credentials = rawArgs.pop() as { sessionToken?: unknown } | undefined;
    const token = credentials && typeof credentials === 'object' ? credentials.sessionToken : undefined;
    if (!token) return { success: false, error: 'Authentication required' };
    const user = authenticateSession(token, { fresh: true });
    if (!user) return { success: false, error: 'Invalid or expired token' };
    if (!hasRole(user.role, roles)) return { success: false, error: 'Insufficient permissions' };
    return listener(event, ...rawArgs as Args);
  });
}
