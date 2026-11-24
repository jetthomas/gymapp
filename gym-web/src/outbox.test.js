import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { drop, flush, queue } from './outbox.js';

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

const failWith = (status) => async () => {
  throw Object.assign(new Error('refused'), { status });
};
// A login token for user `id`: only its middle part is read. Out of A–Z order on purpose:
// `token` calls it while the file loads, so it has to come first
const tokenFor = (id) => `x.${btoa(JSON.stringify({ sub: id }))}.y`;
const token = tokenFor('7');
const waiting = () => JSON.parse(localStorage.getItem('outbox'));
const workout = (clientId) => ({ clientId, name: 'Push', exercises: [] });

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

// Coming back online and finishing a workout can both start a flush at the same moment
test('two flushes at once send each workout once', async () => {
  queue(token, workout('a'));
  const sent = [];
  const slowSend = async (_, w) => {
    sent.push(w.clientId);
    await new Promise((r) => setTimeout(r, 10));
  };
  await Promise.all([flush(token, slowSend), flush(token, slowSend)]);
  assert.deepEqual(sent, ['a']);
  assert.deepEqual(waiting(), []);
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

test("discarding removes only this member's refused workouts", async () => {
  queue(token, workout('a'));
  queue(token, workout('b'));
  queue(tokenFor('8'), workout('c'));
  await flush(token, async (_, w) => {
    if (w.clientId === 'a') throw Object.assign(new Error('bad weight'), { status: 400 });
    throw new Error('no signal');
  });
  drop(token);
  assert.deepEqual(
    waiting().map((i) => i.workout.clientId),
    ['b', 'c'],
  );
});

test('offline, a workout is queued for the saved member and waits for a real login', async () => {
  localStorage.setItem('user-id', '7');
  queue(null, workout('a'));
  let sent = false;
  await flush(null, async () => {
    sent = true;
  });
  assert.equal(sent, false);
  await flush(token, async () => {});
  assert.deepEqual(waiting(), []);
});
