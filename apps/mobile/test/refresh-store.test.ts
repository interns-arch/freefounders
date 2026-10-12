import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRefreshStore, REFRESH_KEY, type SecureStorage } from '../src/lib/refresh-store.ts';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const calls: string[] = [];
  const storage: SecureStorage = {
    async getItemAsync(k) {
      calls.push(`get ${k}`);
      return data.get(k) ?? null;
    },
    async setItemAsync(k, v) {
      calls.push(`set ${k}`);
      data.set(k, v);
    },
    async deleteItemAsync(k) {
      calls.push(`delete ${k}`);
      data.delete(k);
    },
  };
  return { storage, data, calls };
}

test('reads the stored token once, then from memory', async () => {
  const f = fakeStorage({ [REFRESH_KEY]: 'abc' });
  const store = createRefreshStore(f.storage);
  assert.equal(await store.get(), 'abc');
  assert.equal(await store.get(), 'abc');
  assert.deepEqual(f.calls, [`get ${REFRESH_KEY}`]);
});

test('set keeps the new (rotated) token, null deletes it', async () => {
  const f = fakeStorage();
  const store = createRefreshStore(f.storage);
  assert.equal(await store.get(), null);
  await store.set('rotated');
  assert.equal(f.data.get(REFRESH_KEY), 'rotated');
  assert.equal(await store.get(), 'rotated');
  await store.set(null);
  assert.equal(f.data.has(REFRESH_KEY), false);
  assert.equal(await store.get(), null);
});

test('a broken secure store means signed out, never a crash', async () => {
  const broken: SecureStorage = {
    getItemAsync: () => Promise.reject(new Error('keystore')),
    setItemAsync: () => Promise.reject(new Error('keystore')),
    deleteItemAsync: () => Promise.reject(new Error('keystore')),
  };
  const store = createRefreshStore(broken);
  assert.equal(await store.get(), null);
  await store.set('t'); // does not throw; this session keeps it in memory
  assert.equal(await store.get(), 't');
});
