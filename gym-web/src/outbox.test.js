import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { flush, queue } from './outbox.js';

// Just enough of the browser for outbox.js: a localStorage and a window to send events on
const store = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
  },
});
globalThis.window = new EventTarget();

// A login token for user `id`: only its middle part is read
const tokenFor = (id) => `x.${btoa(JSON.stringify({ sub: id }))}.y`;
const token = tokenFor('7');
const workout = (clientId) => ({ clientId, name: 'Push', exercises: [] });
const failWith = (status) => async () => {
  throw Object.assign(new Error('refused'), { status });
};
const waiting = () => JSON.parse(localStorage.getItem('outbox'));

beforeEach(() => store.clear());

test('a sent workout leaves the outbox', async () => {
  queue(token, workout('a'));
  await flush(token, async () => {});
  assert.deepEqual(waiting(), []);
});

test('no signal, a server error or an expired login keep it for the next try', async () => {
  for (const status of [undefined, 500, 401, 429]) {
    store.clear();
    queue(token, workout('a'));
    await flush(token, failWith(status));
    assert.equal(waiting()[0].error, undefined, `status ${status}`);
  }
});

test('a refused workout is marked, and the ones behind it still send', async () => {
  queue(token, workout('a'));
  queue(token, workout('b'));
  const sent = [];
  await flush(token, async (_, w) => {
    if (w.clientId === 'a') throw Object.assign(new Error('bad weight'), { status: 422 });
    sent.push(w.clientId);
  });
  assert.deepEqual(sent, ['b']);
  assert.deepEqual(
    waiting().map((i) => i.error),
    ['bad weight'],
  );
});

test("another member's workouts stay on the phone", async () => {
  queue(tokenFor('8'), workout('a'));
  let sent = false;
  await flush(token, async () => {
    sent = true;
  });
  assert.equal(sent, false);
  assert.equal(waiting().length, 1);
});
