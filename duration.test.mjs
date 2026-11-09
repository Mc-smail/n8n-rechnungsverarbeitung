import test from 'node:test';
import assert from 'node:assert/strict';
import { documentDurationSeconds } from './Server/duration.mjs';

test('Unix milliseconds and ISO timestamps measure the same 12.345 seconds', () => {
  const start = Date.parse('2026-11-04T12:00:00.000Z');
  assert.equal(documentDurationSeconds(start, start + 12345), 12.345);
  assert.equal(documentDurationSeconds('2026-11-04T12:00:00.000Z', '2026-11-04T12:00:12.345Z'), 12.345);
  assert.equal(documentDurationSeconds(start, '2026-11-04T13:00:12.345+01:00'), 12.345);
});

test('a measured zero is valid, including the Unix epoch', () => {
  assert.equal(documentDurationSeconds(0, 0), 0);
  assert.equal(documentDurationSeconds('2026-11-04', '2026-11-04T00:00:00Z'), 0);
});

test('sub-millisecond inputs round to three decimal places in seconds', () => {
  assert.equal(documentDurationSeconds(1000, 1000.499), 0);
  assert.equal(documentDurationSeconds(1000, 1000.5), 0.001);
  assert.equal(documentDurationSeconds(1000, 1334.5), 0.335);
});

test('missing timestamps and incorrect types do not become zero', () => {
  for (const value of [undefined, null, '', ' ', false, true, {}, [], new Date(0), '0', '12345']) {
    assert.equal(documentDurationSeconds(value, 12345), null);
    // An omitted/undefined finish intentionally uses Date.now() by API contract.
    if (value !== undefined) assert.equal(documentDurationSeconds(0, value), null);
  }
});

test('invalid and ambiguous date strings remain unavailable', () => {
  for (const value of ['not-a-date', '04.11.2026', '2026-02-30', '2025-02-29', '2026-13-01', '2026-11-04T24:00:00Z', '2026-11-04T12:60:00Z', '2026-11-04T12:00:60Z', '2026-11-04T12:00:00', '2026-11-04T12:00:00+25:00']) {
    assert.equal(documentDurationSeconds(value, '2026-12-01'), null, value);
    assert.equal(documentDurationSeconds(0, value), null, value);
  }
  assert.equal(documentDurationSeconds('2024-02-29', '2024-03-01'), 86400);
});

test('non-finite and out-of-range Unix timestamps remain unavailable', () => {
  for (const value of [NaN, Infinity, -Infinity, 8.64e15 + 1, -8.64e15 - 1]) {
    assert.equal(documentDurationSeconds(value, 0), null);
    assert.equal(documentDurationSeconds(0, value), null);
  }
  assert.equal(documentDurationSeconds(-1, 0), 0.001);
});

test('a future start relative to the finish never yields a negative duration', () => {
  assert.equal(documentDurationSeconds(12346, 12345), null);
  assert.equal(documentDurationSeconds(1000.1, 1000), null);
  assert.equal(documentDurationSeconds('2026-11-04T12:00:01Z', '2026-11-04T12:00:00Z'), null);
});

test('omitting the finish uses the current clock', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  assert.equal(documentDurationSeconds(87655), 12.345);
  assert.equal(documentDurationSeconds(100001), null);
});
