import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { ROUTES, createHandlers } from '../index.js';

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
  };
}

test('HTTP routes work through a real node:http server', async (t) => {
  const handlers = createHandlers({
    ctx: { get: () => undefined },
    store: memoryStore(),
    fetchImpl: async () =>
      new Response(JSON.stringify(SAMPLE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });

  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname === ROUTES.state) return handlers.state(req, res);
    if (pathname === ROUTES.key) return handlers.key(req, res);
    res.writeHead(404);
    res.end();
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const empty = await fetch(`${base}${ROUTES.state}`);
  assert.equal(empty.status, 200);
  assert.equal((await empty.json()).configured, false);

  const bad = await fetch(`${base}${ROUTES.key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey: 'bad key' }),
  });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, 'invalid-key-format');

  const saved = await fetch(`${base}${ROUTES.key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey: 'sk-test-1234' }),
  });
  assert.equal(saved.status, 200);
  const savedBody = await saved.json();
  assert.equal(savedBody.saved, true);
  assert.equal(savedBody.ok, true);
  assert.equal(savedBody.balances[0].total, 110);

  const state = await fetch(`${base}${ROUTES.state}?refresh=1`);
  assert.equal(state.status, 200);
  assert.equal((await state.json()).keyHint, '••••1234');

  const wrongMethod = await fetch(`${base}${ROUTES.key}`);
  assert.equal(wrongMethod.status, 405);
});
