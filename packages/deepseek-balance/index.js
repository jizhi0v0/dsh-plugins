/**
 * Host half of the DeepSeek official API balance widget.
 *
 * The browser never receives the API key. It POSTs the key once to
 * `/dsh-deepseek-balance/key`; this half stores it under the DSH home with
 * owner-only permissions and calls `https://api.deepseek.com/user/balance`
 * on the browser's behalf.
 *
 * Routes:
 *   GET  /dsh-deepseek-balance/state       cached balance state
 *   POST /dsh-deepseek-balance/key         { apiKey: string } (empty clears)
 */

import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const API_BASE = 'https://api.deepseek.com';
const STATE_PATH = '/dsh-deepseek-balance/state';
const KEY_PATH = '/dsh-deepseek-balance/key';
const CACHE_MS = 15_000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 8 * 1024;

export class BalanceError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'BalanceError';
    this.code = code;
    this.status = status;
  }
}

/** Directory holding this plugin's private configuration. */
export function deepSeekHome(env = process.env) {
  const home =
    typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== ''
      ? env.DSH_HOME.trim()
      : path.join(homedir(), '.dsh');
  return path.join(home, 'deepseek-balance');
}

function configFile(dir) {
  return path.join(dir, 'config.json');
}

/** JSON-file store with owner-only permissions. */
export function createFileStore(dir = deepSeekHome()) {
  return {
    dir,
    async read() {
      try {
        const raw = await readFile(configFile(dir), 'utf8');
        const value = JSON.parse(raw);
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      } catch (error) {
        if (error?.code === 'ENOENT') return {};
        if (error instanceof SyntaxError) return {};
        throw error;
      }
    },
    async write(config) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await chmod(dir, 0o700).catch(() => {});
      const target = configFile(dir);
      const temp = path.join(dir, `.config.${process.pid}.${Date.now()}.tmp`);
      await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
      await rename(temp, target);
      await chmod(target, 0o600).catch(() => {});
    },
    async clear() {
      await unlink(configFile(dir)).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
    },
  };
}

/** Keep only the last four characters; never return the key itself. */
export function maskKey(apiKey) {
  const key = typeof apiKey === 'string' ? apiKey : '';
  if (key.length <= 8) return '••••';
  return `••••${key.slice(-4)}`;
}

/**
 * Accept a pasted key, tolerate a `Bearer ` prefix, and reject control
 * characters or whitespace. An empty string is the explicit clear signal.
 */
export function normalizeApiKey(value) {
  if (typeof value !== 'string') return null;
  let key = value.trim();
  if (key.startsWith('Bearer ')) key = key.slice(7).trim();
  if (key === '') return '';
  if (key.length < 10 || key.length > 512) return null;
  if (/[\u0000-\u001f\u007f]/.test(key) || /\s/.test(key)) return null;
  return key;
}

function amount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.replace(/,/g, '').trim();
  if (text === '') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Convert the official response into the client's stable shape. */
export function normalizeBalance(payload, now = Date.now()) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new BalanceError('invalid-response', 'DeepSeek returned an unexpected response.');
  }
  const infos = Array.isArray(payload.balance_infos) ? payload.balance_infos : [];
  const balances = [];
  for (const info of infos) {
    if (!info || typeof info !== 'object') continue;
    const total = amount(info.total_balance);
    const granted = amount(info.granted_balance);
    const toppedUp = amount(info.topped_up_balance);
    if (total === null && granted === null && toppedUp === null) continue;
    balances.push({
      currency:
        typeof info.currency === 'string' && info.currency.trim() !== ''
          ? info.currency.trim().toUpperCase()
          : 'CNY',
      total,
      granted,
      toppedUp,
    });
  }
  return {
    configured: true,
    ok: true,
    isAvailable: typeof payload.is_available === 'boolean' ? payload.is_available : null,
    balances,
    updatedAt: now,
    error: null,
  };
}

/** State shape used when no key has been configured yet. */
export function noKeyState(now = Date.now()) {
  return {
    configured: false,
    ok: false,
    isAvailable: null,
    balances: [],
    updatedAt: null,
    keyHint: null,
    error: { code: 'no-key', message: 'No DeepSeek API key is configured.' },
  };
}

/** Call the official balance endpoint and normalize its answer. */
export async function fetchBalance(apiKey, options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    now = Date.now,
    timeoutMs = FETCH_TIMEOUT_MS,
  } = options;
  if (typeof fetchImpl !== 'function') {
    throw new BalanceError('unsupported', 'Fetch is not available in this host.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(`${API_BASE}/user/balance`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new BalanceError('timeout', 'The DeepSeek API request timed out.');
      }
      throw new BalanceError('network', 'Could not reach api.deepseek.com.');
    }

    if (response.status === 401 || response.status === 403) {
      throw new BalanceError('invalid-key', 'The DeepSeek API key was rejected.', response.status);
    }
    if (response.status === 429) {
      throw new BalanceError('rate-limited', 'The DeepSeek API is rate limiting this key.', response.status);
    }
    if (!response.ok) {
      throw new BalanceError('http', `The DeepSeek API answered HTTP ${response.status}.`, response.status);
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new BalanceError('timeout', 'The DeepSeek API request timed out.');
      }
      throw new BalanceError('invalid-response', 'The DeepSeek API did not return JSON.');
    }

    const state = normalizeBalance(payload, now());
    state.keyHint = maskKey(apiKey);
    return state;
  } finally {
    clearTimeout(timer);
  }
}

/** Always resolve to a JSON-serializable state, even on failure. */
export async function getBalanceState(options = {}) {
  const { apiKey, fetchImpl, now = Date.now } = options;
  if (typeof apiKey !== 'string' || apiKey.trim() === '') return noKeyState(now());
  const key = apiKey.trim();
  try {
    return await fetchBalance(key, { fetchImpl, now });
  } catch (error) {
    const code = error instanceof BalanceError ? error.code : 'unknown';
    return {
      configured: true,
      ok: false,
      isAvailable: null,
      balances: [],
      updatedAt: now(),
      keyHint: maskKey(key),
      error: {
        code,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function sendJson(res, status, body, extraHeaders = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  });
  res.end(text);
}

function sendRejection(res, status) {
  sendJson(res, status, {
    error: {
      code: status === 401 ? 'unauthorized' : 'forbidden',
      message: status === 401 ? 'Authentication required.' : 'Request refused.',
    },
  });
}

function sendMethodNotAllowed(res, allow) {
  sendJson(
    res,
    405,
    {
      error: { code: 'method-not-allowed', message: 'Method not allowed.' },
      allow,
    },
    { allow },
  );
}

/**
 * The Host/Origin fence used by DSH's own `/api` route, with a loopback-only
 * fallback for hosts that do not compose the connection service.
 */
function requestRejection(ctx, req) {
  const connection =
    ctx && typeof ctx.get === 'function' ? ctx.get('connection') : undefined;
  if (connection && typeof connection.requestRejection === 'function') {
    try {
      return connection.requestRejection(req);
    } catch {
      return 403;
    }
  }
  const host = req.headers?.host;
  if (typeof host !== 'string' || host === '') return 403;
  const hostname = host.startsWith('[')
    ? host.slice(1, host.indexOf(']'))
    : host.split(':')[0];
  if (!['127.0.0.1', '::1', 'localhost'].includes(hostname)) return 403;

  const origin = req.headers?.origin;
  if (typeof origin === 'string' && origin !== '') {
    try {
      if (new URL(origin).host !== host) return 403;
    } catch {
      return 403;
    }
  }
  const remote = req.socket?.remoteAddress;
  if (
    typeof remote === 'string' &&
    !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)
  ) {
    return 403;
  }
  return undefined;
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new BalanceError('body-too-large', 'The request body is too large.');
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BalanceError('invalid-body', 'The request body is not valid JSON.');
  }
}

/**
 * Build the two route handlers. Exported for tests; `apply()` wires the
 * default file store and the live webserver.
 */
export function createHandlers(options = {}) {
  const {
    ctx,
    store = createFileStore(),
    fetchImpl = globalThis.fetch,
    now = Date.now,
    logger,
  } = options;

  let cache = null;
  let writeTail = Promise.resolve();

  async function state(force) {
    const config = await store.read();
    const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
    if (apiKey === '') {
      cache = null;
      return noKeyState(now());
    }
    if (!force && cache && cache.apiKey === apiKey && now() - cache.at < CACHE_MS) {
      return cache.state;
    }
    const result = await getBalanceState({ apiKey, fetchImpl, now });
    cache = { apiKey, at: now(), state: result };
    return result;
  }

  function saveKey(apiKey) {
    const run = async () => {
      if (apiKey === '') {
        await store.clear();
      } else {
        const current = await store.read();
        await store.write({ ...current, apiKey });
      }
      cache = null;
    };
    const next = writeTail.then(run, run);
    writeTail = next.catch(() => {});
    return next;
  }

  async function stateHandler(req, res) {
    try {
      const rejection = requestRejection(ctx, req);
      if (rejection !== undefined) {
        return sendRejection(res, rejection === 401 ? 401 : 403);
      }
      if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET');
      const url = new URL(req.url ?? '/', 'http://localhost');
      const force = url.searchParams.get('refresh') === '1';
      sendJson(res, 200, await state(force));
    } catch (error) {
      logger?.warn?.(
        '[deepseek-balance] state route failed:',
        error instanceof Error ? error.message : String(error),
      );
      if (res.headersSent) return res.destroy();
      sendJson(res, 500, { error: { code: 'internal', message: 'Internal error.' } });
    }
  }

  async function keyHandler(req, res) {
    try {
      const rejection = requestRejection(ctx, req);
      if (rejection !== undefined) {
        return sendRejection(res, rejection === 401 ? 401 : 403);
      }
      if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST');
      const body = await readJson(req);
      if (!body || typeof body.apiKey !== 'string') {
        return sendJson(res, 400, {
          error: { code: 'invalid-body', message: 'apiKey must be a string.' },
        });
      }
      const apiKey = normalizeApiKey(body.apiKey);
      if (apiKey === null) {
        return sendJson(res, 400, {
          error: { code: 'invalid-key-format', message: 'The API key has an invalid format.' },
        });
      }
      await saveKey(apiKey);
      sendJson(res, 200, { ...(await state(true)), saved: true });
    } catch (error) {
      if (error instanceof BalanceError && (error.code === 'body-too-large' || error.code === 'invalid-body')) {
        return sendJson(res, error.code === 'body-too-large' ? 413 : 400, {
          error: { code: error.code, message: error.message },
        });
      }
      logger?.warn?.(
        '[deepseek-balance] key route failed:',
        error instanceof Error ? error.message : String(error),
      );
      if (res.headersSent) return res.destroy();
      sendJson(res, 500, { error: { code: 'internal', message: 'Internal error.' } });
    }
  }

  return {
    state: stateHandler,
    key: keyHandler,
    resetCache() {
      cache = null;
    },
  };
}

/** Mount the two exact routes. */
export function apply(ctx) {
  const handlers = createHandlers({ ctx, logger: ctx.logger });
  ctx.inject(['webServer'], (hostCtx) => {
    hostCtx.effect(() => {
      const disposeState = hostCtx.webServer.register({
        kind: 'exact',
        path: STATE_PATH,
        handler: handlers.state,
      });
      const disposeKey = hostCtx.webServer.register({
        kind: 'exact',
        path: KEY_PATH,
        handler: handlers.key,
      });
      return () => {
        disposeState();
        disposeKey();
      };
    }, 'deepseek-balance: HTTP routes');
  });
}

export const ROUTES = Object.freeze({ state: STATE_PATH, key: KEY_PATH });
