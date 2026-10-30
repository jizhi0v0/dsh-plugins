import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  BalanceError,
  ROUTES,
  createFileStore,
  createHandlers,
  fetchBalance,
  getBalanceState,
  maskKey,
  noKeyState,
  normalizeApiKey,
  normalizeBalance,
} from '../index.js';

const SAMPLE = {
  is_available: true,
  balance_infos: [
    {
      currency: 'CNY',
      total_balance: '110.00',
      granted_balance: '10.00',
      topped_up_balance: '100.00',
    },
  ],
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function memoryStore(initial = {}) {
  let value = { ...initial };
  return {
    async read() {
      return { ...value };
    },
    async write(next) {
      value = { ...next };
    },
    async clear() {
      value = {};
    },
    snapshot() {
      return { ...value };
    },
  };
}

function makeReq({ method = 'GET', url = ROUTES.state, headers = {}, body = null } = {}) {
  const stream = Readable.from(body === null ? [] : [Buffer.from(body)]);
  stream.method = method;
  stream.url = url;
  stream.headers = { host: '127.0.0.1:1234', ...headers };
  stream.socket = { remoteAddress: '127.0.0.1' };
  return stream;
}

function makeRes() {
  return {
    statusCode: 0,
    headers: null,
    body: '',
    headersSent: false,
    destroyed: false,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
      this.headersSent = true;
    },
    end(text = '') {
      this.body += text;
    },
    destroy() {
      this.destroyed = true;
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

test('normalizeBalance maps the official response', () => {
  const state = normalizeBalance(SAMPLE, 1234);
  assert.equal(state.configured, true);
  assert.equal(state.ok, true);
  assert.equal(state.isAvailable, true);
  assert.equal(state.updatedAt, 1234);
  assert.deepEqual(state.balances, [
    { currency: 'CNY', total: 110, granted: 10, toppedUp: 100 },
  ]);
});

test('normalizeBalance tolerates empty and partial amounts', () => {
  const state = normalizeBalance({
    is_available: false,
    balance_infos: [
      { currency: 'usd', total_balance: '', granted_balance: null, topped_up_balance: '5' },
      { currency: 'CNY' },
    ],
  });
  assert.equal(state.isAvailable, false);
  assert.deepEqual(state.balances, [
    { currency: 'USD', total: null, granted: null, toppedUp: 5 },
  ]);
});

test('normalizeBalance rejects non-object payloads', () => {
  assert.throws(() => normalizeBalance(null), (error) => {
    assert.ok(error instanceof BalanceError);
    assert.equal(error.code, 'invalid-response');
    return true;
  });
});

test('fetchBalance sends the official bearer request', async () => {
  let seen = null;
  const state = await fetchBalance('sk-test-1234', {
    now: () => 42,
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return jsonResponse(SAMPLE);
    },
  });
  assert.equal(seen.url, 'https://api.deepseek.com/user/balance');
  assert.equal(seen.init.headers.Authorization, 'Bearer sk-test-1234');
  assert.equal(state.ok, true);
  assert.equal(state.updatedAt, 42);
  assert.equal(state.keyHint, '••••1234');
});

test('fetchBalance maps authentication, rate-limit, and server failures', async () => {
  await assert.rejects(
    fetchBalance('sk-test-1234', { fetchImpl: async () => jsonResponse({}, 401) }),
    (error) => error.code === 'invalid-key',
  );
  await assert.rejects(
    fetchBalance('sk-test-1234', { fetchImpl: async () => jsonResponse({}, 429) }),
    (error) => error.code === 'rate-limited',
  );
  await assert.rejects(
    fetchBalance('sk-test-1234', { fetchImpl: async () => jsonResponse({}, 503) }),
    (error) => error.code === 'http' && error.status === 503,
  );
  await assert.rejects(
    fetchBalance('sk-test-1234', {
      fetchImpl: async () => new Response('not json', { status: 200 }),
    }),
    (error) => error.code === 'invalid-response',
  );
  await assert.rejects(
    fetchBalance('sk-test-1234', {
      fetchImpl: async () => {
        throw new TypeError('offline');
      },
    }),
    (error) => error.code === 'network',
  );
});

test('fetchBalance reports a timeout', async () => {
  await assert.rejects(
    fetchBalance('sk-test-1234', {
      timeoutMs: 10,
      fetchImpl: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    }),
    (error) => error.code === 'timeout',
  );
});

test('normalizeApiKey and masking', () => {
  assert.equal(normalizeApiKey('  sk-abcdefghij  '), 'sk-abcdefghij');
  assert.equal(normalizeApiKey('Bearer sk-abcdefghij'), 'sk-abcdefghij');
  assert.equal(normalizeApiKey(''), '');
  assert.equal(normalizeApiKey('bad key'), null);
  assert.equal(normalizeApiKey('short'), null);
  assert.equal(normalizeApiKey(123), null);
  assert.equal(maskKey('sk-abcdefghijkl'), '••••ijkl');
  assert.equal(maskKey('short'), '••••');
});

test('getBalanceState returns structured failures instead of throwing', async () => {
  const noKey = await getBalanceState({ now: () => 7 });
  assert.equal(noKey.configured, false);
  assert.equal(noKey.error.code, 'no-key');
  assert.equal(noKey.updatedAt, null);

  const rejected = await getBalanceState({
    apiKey: 'sk-test-1234',
    now: () => 8,
    fetchImpl: async () => jsonResponse({}, 401),
  });
  assert.equal(rejected.configured, true);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'invalid-key');
  assert.equal(rejected.updatedAt, 8);
  assert.equal(rejected.keyHint, '••••1234');
});

test('noKeyState is serializable and stable', () => {
  assert.deepEqual(noKeyState(1), {
    configured: false,
    ok: false,
    isAvailable: null,
    balances: [],
    updatedAt: null,
    keyHint: null,
    error: { code: 'no-key', message: 'No DeepSeek API key is configured.' },
  });
});

test('file store keeps owner-only permissions and clears', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-deepseek-balance-'));
  try {
    const store = createFileStore(dir);
    await store.write({ apiKey: 'sk-test-1234' });
    assert.deepEqual(await store.read(), { apiKey: 'sk-test-1234' });
    const file = await stat(path.join(dir, 'config.json'));
    assert.equal(file.mode & 0o777, 0o600);
    const dirStat = await stat(dir);
    assert.equal(dirStat.mode & 0o777, 0o700);
    const raw = await readFile(path.join(dir, 'config.json'), 'utf8');
    assert.equal(raw.includes('sk-test-1234'), true);
    await store.clear();
    assert.deepEqual(await store.read(), {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('file store tolerates corrupt JSON', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-deepseek-balance-'));
  try {
    await writeFile(path.join(dir, 'config.json'), '{not json', 'utf8');
    const store = createFileStore(dir);
    assert.deepEqual(await store.read(), {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('routes save a key, return state, and clear it', async () => {
  const store = memoryStore();
  let fetches = 0;
  const handlers = createHandlers({
    ctx: {
      get(name) {
        return name === 'connection' ? { requestRejection: () => undefined } : undefined;
      },
      logger: { warn() {} },
    },
    store,
    now: () => 100,
    fetchImpl: async () => {
      fetches += 1;
      return jsonResponse(SAMPLE);
    },
  });

  const saveRes = makeRes();
  await handlers.key(
    makeReq({ method: 'POST', url: ROUTES.key, body: JSON.stringify({ apiKey: 'sk-test-1234' }) }),
    saveRes,
  );
  assert.equal(saveRes.statusCode, 200);
  assert.equal(saveRes.json().saved, true);
  assert.equal(saveRes.json().ok, true);
  assert.equal(store.snapshot().apiKey, 'sk-test-1234');

  const stateRes = makeRes();
  await handlers.state(makeReq(), stateRes);
  assert.equal(stateRes.statusCode, 200);
  assert.equal(stateRes.json().balances[0].total, 110);
  assert.equal(fetches, 1, 'the second read is served from the Host cache');

  const refreshRes = makeRes();
  await handlers.state(makeReq({ url: `${ROUTES.state}?refresh=1` }), refreshRes);
  assert.equal(refreshRes.statusCode, 200);
  assert.equal(fetches, 2);

  const clearRes = makeRes();
  await handlers.key(
    makeReq({ method: 'POST', url: ROUTES.key, body: JSON.stringify({ apiKey: '' }) }),
    clearRes,
  );
  assert.equal(clearRes.statusCode, 200);
  assert.equal(clearRes.json().configured, false);
  assert.deepEqual(store.snapshot(), {});
});

test('routes enforce authentication, methods, and key format', async () => {
  const handlers = createHandlers({
    ctx: {
      get(name) {
        return name === 'connection' ? { requestRejection: () => 403 } : undefined;
      },
      logger: { warn() {} },
    },
    store: memoryStore(),
  });

  const blocked = makeRes();
  await handlers.state(makeReq(), blocked);
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.json().error.code, 'forbidden');

  const allowed = createHandlers({
    ctx: {
      get() {
        return undefined;
      },
      logger: { warn() {} },
    },
    store: memoryStore(),
  });

  const wrongMethod = makeRes();
  await allowed.state(makeReq({ method: 'POST' }), wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);

  const untrustedHost = makeRes();
  await allowed.state(makeReq({ headers: { host: 'evil.example' } }), untrustedHost);
  assert.equal(untrustedHost.statusCode, 403);

  const wrongKeyMethod = makeRes();
  await allowed.key(makeReq({ method: 'GET' }), wrongKeyMethod);
  assert.equal(wrongKeyMethod.statusCode, 405);

  const badFormat = makeRes();
  await allowed.key(
    makeReq({ method: 'POST', url: ROUTES.key, body: JSON.stringify({ apiKey: 'bad key' }) }),
    badFormat,
  );
  assert.equal(badFormat.statusCode, 400);
  assert.equal(badFormat.json().error.code, 'invalid-key-format');

  const badBody = makeRes();
  await allowed.key(makeReq({ method: 'POST', url: ROUTES.key, body: '{}' }), badBody);
  assert.equal(badBody.statusCode, 400);
  assert.equal(badBody.json().error.code, 'invalid-body');
});

test('saving an invalid key keeps it and reports the failure', async () => {
  const store = memoryStore();
  const handlers = createHandlers({
    ctx: {
      get(name) {
        return name === 'connection' ? { requestRejection: () => undefined } : undefined;
      },
    },
    store,
    fetchImpl: async () => jsonResponse({}, 401),
  });

  const res = makeRes();
  await handlers.key(
    makeReq({ method: 'POST', url: ROUTES.key, body: JSON.stringify({ apiKey: 'sk-bad-key-1234' }) }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().saved, true);
  assert.equal(res.json().ok, false);
  assert.equal(res.json().error.code, 'invalid-key');
  assert.equal(store.snapshot().apiKey, 'sk-bad-key-1234');
});
