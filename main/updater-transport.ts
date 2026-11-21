import type { Session } from 'electron';
import { REMOTE_UPDATE_VALIDATION_URL } from './network-policy';

export const UPDATE_METADATA_MAX_BYTES = 65_536;
const UPDATE_METADATA_TIMEOUT_MS = 30_000;
const approvedOrigin = new URL(REMOTE_UPDATE_VALIDATION_URL).origin;

// Intercept only electron-updater's dedicated session; the provider and parser stay native.
export function installUpdaterTransport(session: Session, fetch = session.fetch.bind(session)): void {
  session.webRequest.onHeadersReceived((details, callback) => {
    const url = new URL(details.url);
    const headers = new Headers();
    for (const [name, values] of Object.entries(details.responseHeaders || {})) {
      headers.set(name, values.join(','));
    }
    const length = headers.get('content-length');
    const oversized = url.origin === approvedOrigin && url.pathname === '/v1/updates/windows/x64/latest.yml' &&
      !headers.has('content-encoding') && !headers.has('transfer-encoding') &&
      length !== null && /^\d+$/.test(length) && BigInt(length) > BigInt(UPDATE_METADATA_MAX_BYTES);
    callback({ cancel: oversized });
  });
  const receive = async (request: Request): Promise<Response> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const url = new URL(request.url);
      if (url.protocol !== 'https:' || url.origin !== approvedOrigin || url.username || url.password) {
        throw new Error('Update origin rejected');
      }
      const metadata = url.pathname === '/v1/updates/windows/x64/latest.yml';
      if (metadata) timer = setTimeout(() => controller.abort(), UPDATE_METADATA_TIMEOUT_MS);
      const response = await fetch(request, {
        bypassCustomProtocolHandlers: true,
        redirect: 'manual',
        signal: AbortSignal.any([request.signal, controller.signal]),
      });
      // This infrastructure requires no redirects, including same-origin redirects.
      if (response.status >= 300 && response.status < 400 || response.headers.has('location')) {
        throw new Error('Update redirect rejected');
      }
      if (!metadata) {
        const headers = new Headers(response.headers);
        if (headers.has('content-encoding')) {
          headers.delete('content-encoding');
          headers.delete('content-length');
        }
        return new Response(response.body, { status: response.status, headers });
      }
      const length = response.headers.get('content-length');
      if (!response.headers.has('content-encoding') && !response.headers.has('transfer-encoding') &&
          length !== null && /^\d+$/.test(length) && BigInt(length) > BigInt(UPDATE_METADATA_MAX_BYTES)) {
        throw new Error('Update metadata exceeds byte limit');
      }
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      reader = response.body?.getReader();
      if (reader) {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > UPDATE_METADATA_MAX_BYTES) throw new Error('Update metadata exceeds byte limit');
          chunks.push(chunk.value);
        }
      }
      const headers = new Headers(response.headers);
      // Chromium fetch delivers decompressed bytes; do not decompress them again.
      headers.delete('content-encoding');
      headers.delete('transfer-encoding');
      headers.set('content-length', String(bytes));
      return new Response(bytes ? Buffer.concat(chunks, bytes) : null, { status: response.status, headers });
    } catch {
      controller.abort();
      await reader?.cancel().catch(() => undefined);
      return new Response('Update transport rejected the response.', { status: 502 });
    } finally {
      if (timer) clearTimeout(timer);
      reader?.releaseLock();
    }
  };
  session.protocol.handle('https', receive);
  session.protocol.handle('http', receive);
}
