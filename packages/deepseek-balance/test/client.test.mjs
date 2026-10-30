import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.join(here, '..', 'client.js');

async function loadClient() {
  const source = await readFile(clientPath, 'utf8');
  let registration = null;
  globalThis.window = {
    __ModuleLoader__: {
      load(value) {
        registration = value;
      },
    },
  };
  await import(`${pathToFileURL(clientPath).href}?test=${Date.now()}`);
  assert.ok(registration, 'the client module must register a loader factory');
  return { source, registration };
}

test('client registers under the package name and injects the slot and locale services', async () => {
  const { registration } = await loadClient();
  assert.equal(registration.id, 'dsh-deepseek-balance');
  const React = { createElement() {} };
  const plugin = registration.factory((name) => {
    assert.equal(name, 'react');
    return React;
  });
  assert.deepEqual(plugin.inject, ['slots', 'locale']);
  assert.equal(typeof plugin.apply, 'function');
});

test('client dictionaries are complete in both locales and cover static keys', async () => {
  const { source, registration } = await loadClient();
  const React = { createElement() {} };
  const plugin = registration.factory(() => React);

  let dictionaries = null;
  let slot = null;
  const ctx = {
    effect(fn) {
      return fn();
    },
    locale: {
      register(namespace, value) {
        assert.equal(namespace, 'deepseek-balance');
        dictionaries = value;
        return () => {};
      },
      bind(namespace) {
        assert.equal(namespace, 'deepseek-balance');
        return (key) => key;
      },
    },
    slots: {
      inject(name, callback) {
        assert.equal(name, 'conversation.composer.dock');
        return callback();
      },
      register(options) {
        slot = options;
        return () => {};
      },
    },
  };

  plugin.apply(ctx);
  assert.ok(dictionaries, 'the client must register its dictionaries');
  const zhKeys = Object.keys(dictionaries.zh).sort();
  const enKeys = Object.keys(dictionaries.en).sort();
  assert.deepEqual(zhKeys, enKeys, 'both locales must define the same keys');
  assert.ok(zhKeys.length > 20);

  const used = new Set([...source.matchAll(/\bt\('([^']+)'\)/g)].map((match) => match[1]));
  for (const key of used) {
    assert.ok(zhKeys.includes(key), `missing zh key: ${key}`);
    assert.ok(enKeys.includes(key), `missing en key: ${key}`);
  }

  assert.equal(slot.name, 'conversation.composer.dock');
  assert.equal(slot.id, 'deepseek-balance');
  assert.equal(slot.order, 20);
  assert.equal(slot.locale, 'deepseek-balance');
});
