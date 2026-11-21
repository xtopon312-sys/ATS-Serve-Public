import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, readFileSync, type WriteStream } from 'node:fs';
import type { IncomingMessage, RequestOptions } from 'node:http';
import { pipeline } from 'node:stream/promises';
import type { Transform } from 'node:stream';
import type { ClientRequest, Session } from 'electron';
import { CancellationToken, CancellationError, DigestTransform, safeGetHeader, type DownloadOptions } from 'builder-util-runtime';
import type { DownloadCallOptions } from 'builder-util-runtime/out/httpExecutor';
import { ProgressCallbackTransform } from 'builder-util-runtime/out/ProgressCallbackTransform';
import { NsisUpdater, type AppUpdater, type UpdateDownloadedEvent } from 'electron-updater';
import type { DownloadUpdateOptions, DownloadExecutorTask, DownloadExecutorResult } from 'electron-updater/out/AppUpdater';
import { ElectronHttpExecutor } from 'electron-updater/out/electronHttpExecutor';
import { GenericProvider } from 'electron-updater/out/providers/GenericProvider';
import patch from '../patches/updater-lifecycle/patch.json';
import { installUpdaterTransport } from './updater-transport';

const correlationHeader = 'x-ats-local-updater-transfer';
const installed = new WeakSet<AppUpdater>();
const sessionOwners = new WeakMap<Session, UpdaterOperations>();
type Fetch = Session['fetch'];
type FetchOptions = NonNullable<Parameters<Fetch>[1]>;
type ReaderState = { source: ReadableStream<Uint8Array>; pendingReads: number; released: boolean; closedAt?: number };
type Observer = { operation?: (operation: Operation) => void; reader?: (state: ReaderState) => void; file?: (stream: WriteStream) => void; transform?: (stream: Transform) => void };
type Transfer = { op: Operation; controller: AbortController; request?: ClientRequest; response?: IncomingMessage };
type Operation = { token: CancellationToken; controller: AbortController; pending: Set<Promise<unknown>>; requests: Transfer[]; ids: string[]; complete: boolean; check: () => void; abort: (reason: unknown) => void; track: <T>(promise: Promise<T>) => Promise<T>; drain: () => Promise<void> };
type NativeHooks = {
  httpExecutor: ElectronHttpExecutor;
  clientPromise?: Promise<unknown> | null;
  downloadedUpdateHelper?: { clear: () => Promise<void> } | null;
  doDownloadUpdate: (options: DownloadUpdateOptions) => Promise<DownloadExecutorResult>;
  executeDownload: (options: DownloadExecutorTask) => Promise<DownloadExecutorResult>;
  dispatchUpdateDownloaded: (event: UpdateDownloadedEvent) => void;
};

function incompatible(): never { throw new Error('ATS updater lifecycle is incompatible or unavailable'); }

export function verifyUpdaterPatches(): void {
  if (process.versions.electron !== '43.5.0') incompatible();
  for (const [name, version] of Object.entries(patch.versions)) {
    if (require(`${name}/package.json`).version !== version) incompatible();
  }
  for (const entry of patch.files) {
    if (entry.file === 'electron-updater/out/DownloadedUpdateHelper.d.ts') continue;
    const bytes = readFileSync(require.resolve(entry.file));
    if (createHash('sha256').update(bytes).digest('hex') !== entry.patchedSha256) incompatible();
  }
  for (const guard of patch.guards) {
    if (createHash('sha256').update(readFileSync(require.resolve(guard.file))).digest('hex') !== guard.sha256) incompatible();
  }
}

export class UpdaterOperations {
  readonly context = new AsyncLocalStorage<Operation>();
  readonly transfers = new Map<string, Transfer>();
  readonly active = new Set<Operation>();
  closed = false;
  constructor(private readonly assertPolicy: () => void, private readonly observer: Observer = {}) {}

  async run<T>(token: CancellationToken, fn: () => Promise<T>): Promise<T> {
    if (this.closed) incompatible();
    this.assertPolicy();
    const existing = this.context.getStore();
    if (existing?.token === token) {
      try { existing.check(); const value = await fn(); existing.check(); return value; }
      catch (error) { existing.abort(error); await existing.drain(); throw token.cancelled && !existing.complete ? new CancellationError() : error; }
    }
    const op: Operation = {
      token, controller: new AbortController(), pending: new Set(), requests: [], ids: [], complete: false,
      check: () => { if (token.cancelled && !op.complete) throw new CancellationError(); },
      track: promise => { op.pending.add(promise); promise.then(() => op.pending.delete(promise), () => op.pending.delete(promise)); return promise; },
      abort: reason => {
        if (op.complete || op.controller.signal.aborted) return;
        op.controller.abort(reason);
        for (const record of op.requests) {
          record.controller.abort(reason);
          // The executor or token already owns the rejection; teardown must not emit it again.
          if (record.response && !record.response.destroyed) record.response.destroy();
          record.request?.abort();
        }
      },
      drain: async () => { while (op.pending.size) await Promise.allSettled([...op.pending]); },
    };
    const cancel = () => op.abort(new CancellationError());
    this.active.add(op); this.observer.operation?.(op);
    if (token.cancelled) cancel(); else token.once('cancel', cancel);
    try { return await this.context.run(op, async () => { op.check(); const value = await fn(); op.check(); return value; }); }
    catch (error) { op.abort(error); throw token.cancelled && !op.complete ? new CancellationError() : error; }
    finally { await op.drain(); token.removeListener('cancel', cancel); for (const id of op.ids) this.transfers.delete(id); this.active.delete(op); }
  }

  register(options: RequestOptions): { record: Transfer; options: RequestOptions } {
    const op = this.context.getStore(); if (!op) incompatible(); op.check();
    const id = randomUUID(); const record = { op, controller: new AbortController() };
    op.ids.push(id); op.requests.push(record); this.transfers.set(id, record);
    return { record, options: { ...options, headers: { ...options.headers, [correlationHeader]: id } } };
  }

  async fetch(request: Request, options: FetchOptions, nativeFetch: Fetch): Promise<Response> {
    const record = this.transfers.get(request.headers.get(correlationHeader) || ''); if (!record) incompatible();
    const headers = new Headers(request.headers); headers.delete(correlationHeader);
    const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), record.controller.signal, record.op.controller.signal]);
    const response = await record.op.track(nativeFetch(new Request(request, { headers }), { ...options, signal }));
    if (!response.body) return response;
    const source = response.body; const reader = source.getReader();
    let resolveClosed!: () => void;
    record.op.track(new Promise<void>(resolve => { resolveClosed = resolve; }));
    const state: ReaderState = { source, pendingReads: 0, released: false }; this.observer.reader?.(state);
    let ending: Promise<void> | undefined; let terminal = false; let output: ReadableStreamDefaultController<Uint8Array>;
    const end = (reason?: unknown) => ending ||= (async () => {
      try { if (reason) await reader.cancel(reason).catch(() => undefined); }
      finally { reader.releaseLock(); state.released = true; state.closedAt = performance.now(); signal.removeEventListener('abort', abort); resolveClosed(); }
    })();
    const abort = () => { if (!terminal) { terminal = true; output.error(signal.reason); } void end(signal.reason); };
    const body = new ReadableStream<Uint8Array>({
      start(controller) { output = controller; signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); },
      async pull(controller) {
        if (signal.aborted || terminal) return;
        state.pendingReads++;
        try {
          const chunk = await record.op.track(reader.read());
          if (terminal || signal.aborted) return;
          if (chunk.done) { terminal = true; controller.close(); await end(); }
          else controller.enqueue(chunk.value);
        } catch (error) { if (!terminal) { terminal = true; controller.error(error); } await end(error); }
        finally { state.pendingReads--; }
      },
      cancel(reason) { const cause = reason || new Error('Updater consumer closed'); record.controller.abort(cause); return end(cause); },
    });
    return new Response(body, { headers: response.headers, status: response.status, statusText: response.statusText });
  }

  observeFile(file: WriteStream): void { this.observer.file?.(file); }
  observeTransform(stream: Transform): void { this.observer.transform?.(stream); }
  async close(): Promise<void> {
    this.closed = true;
    const active = [...this.active];
    for (const op of active) if (!op.complete) op.token.cancel();
    await Promise.all(active.map(op => op.drain()));
    while (this.active.size) await new Promise(resolve => setImmediate(resolve));
  }
}

class UpdaterExecutor extends ElectronHttpExecutor {
  constructor(readonly operations: UpdaterOperations, login: ConstructorParameters<typeof ElectronHttpExecutor>[0]) { super(login); }
  createRequest(options: RequestOptions, callback: (response: IncomingMessage) => void): ClientRequest {
    const { record, options: tagged } = this.operations.register(options);
    const request = super.createRequest(tagged, response => this.operations.context.run(record.op, () => {
      record.response = response;
      if (record.op.controller.signal.aborted) response.destroy();
      callback(response);
    }));
    record.request = request; request.once('abort', () => record.controller.abort(new CancellationError())); return request;
  }
  doApiRequest(options: RequestOptions, token: CancellationToken, processor: (request: ClientRequest, reject: (error: Error) => void) => void, redirects = 0): Promise<string> {
    return this.operations.run(token, () => super.doApiRequest(options, token, processor, redirects));
  }
  download(url: URL, destination: string, options: DownloadOptions): Promise<string> {
    return this.operations.run(options.cancellationToken, () => super.download(url, destination, options));
  }
  downloadToBuffer(_url: URL, _options: DownloadOptions): Promise<Buffer> { return Promise.reject(new Error('Buffer/differential download is unavailable in ATS desktop V1')); }
  protected doDownload(requestOptions: RequestOptions, callOptions: DownloadCallOptions, redirects: number): void {
    const op = this.operations.context.getStore(); if (!op || !callOptions.destination) incompatible();
    let delivered = false;
    const settle = (error: Error | null) => {
      if (delivered) return;
      delivered = true; callOptions.callback(error);
    };
    const responseHandler = (response: IncomingMessage, callback: (error: Error | null) => void) => {
      const options = callOptions.options;
      if (!options.sha512 || Buffer.from(options.sha512, 'base64').length !== 64) { callback(new Error('ATS download requires SHA-512')); return; }
      const sha2 = safeGetHeader(response, 'X-Checksum-Sha2');
      if (sha2 != null && options.sha2 != null && sha2 !== options.sha2) { callback(new Error('X-Checksum-Sha2 mismatch')); return; }
      const streams = [];
      const length = safeGetHeader(response, 'content-length');
      if (options.onProgress && length !== null) streams.push(new ProgressCallbackTransform(parseInt(length, 10), options.cancellationToken, options.onProgress));
      streams.push(new DigestTransform(options.sha512, 'sha512', 'base64'));
      for (const stream of streams) this.operations.observeTransform(stream);
      const output = createWriteStream(callOptions.destination!); this.operations.observeFile(output);
      const result = op.track(pipeline([response, ...streams, output], { signal: op.controller.signal }));
      result.then(() => callback(null), error => callback(error));
    };
    super.doDownload(requestOptions, { ...callOptions, callback: settle, responseHandler }, redirects);
  }
}

export function installUpdaterCancellation(updater: AppUpdater, observer: Observer = {}, nativeFetch = updater.netSession.fetch.bind(updater.netSession)) {
  verifyUpdaterPatches();
  const native = updater as unknown as NativeHooks;
  const session = updater.netSession;
  const descriptor = Object.getOwnPropertyDescriptor(updater, 'httpExecutor');
  if (!(updater instanceof NsisUpdater) || installed.has(updater) || sessionOwners.has(session) || native.clientPromise != null ||
      !descriptor?.writable || !(descriptor.value instanceof ElectronHttpExecutor) ||
      native.doDownloadUpdate !== (NsisUpdater.prototype as unknown as NativeHooks).doDownloadUpdate ||
      native.executeDownload !== (NsisUpdater.prototype as unknown as NativeHooks).executeDownload ||
      native.dispatchUpdateDownloaded !== (NsisUpdater.prototype as unknown as NativeHooks).dispatchUpdateDownloaded) incompatible();
  const policy = () => {
    if (updater.autoDownload !== false || updater.autoInstallOnAppQuit !== false || updater.allowDowngrade !== false ||
        updater.disableDifferentialDownload !== true || updater.disableWebInstaller !== true || updater.channel !== 'latest' ||
        updater.requestHeaders?.['x-user-staging-id'] !== 'ats-public-v1') incompatible();
  };
  policy();
  const operations = new UpdaterOperations(policy, observer);
  const download = native.doDownloadUpdate.bind(updater);
  const execute = native.executeDownload.bind(updater);
  const dispatch = native.dispatchUpdateDownloaded.bind(updater);
  native.httpExecutor = new UpdaterExecutor(operations, (info, callback) => updater.emit('login', info, callback));
  native.doDownloadUpdate = options => operations.run(options.cancellationToken, async () => {
    if (options.disableDifferentialDownload !== true || options.disableWebInstaller !== true ||
        !(options.updateInfoAndProvider.provider instanceof GenericProvider) || options.updateInfoAndProvider.provider.isUseMultipleRangeRequest) incompatible();
    try { return await download(options); }
    catch (error) { if (options.cancellationToken.cancelled) { await operations.context.getStore()!.drain(); await native.downloadedUpdateHelper?.clear(); } throw error; }
  });
  native.executeDownload = options => execute({ ...options, task: async (...args) => {
    const op = operations.context.getStore(); if (!op) incompatible(); op.check();
    const result = await options.task(...args); op.check(); return result;
  } });
  native.dispatchUpdateDownloaded = event => {
    const op = operations.context.getStore(); if (!op) incompatible(); op.check(); op.complete = true; dispatch(event);
  };
  try { installUpdaterTransport(session, (request, options) => operations.fetch(request as Request, options || {}, nativeFetch)); }
  catch (error) { operations.closed = true; throw error; }
  installed.add(updater); sessionOwners.set(session, operations);
  let closed = false;
  return { operations, async close() {
    if (closed) return;
    closed = true;
    await operations.close(); session.protocol.unhandle('https'); session.protocol.unhandle('http'); sessionOwners.delete(session);
  } };
}
