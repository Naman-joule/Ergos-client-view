import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageWindow, resolveIexView, resolvePage } from '../lib/iex-period.ts';

test('no range in the URL: one day, a valid ?date or the default', () => {
  assert.deepEqual(resolveIexView({}, '2026-11-26', '2026-11-27'), { mode: 'day', from: '2026-11-26', to: '2026-11-26', preset: null, clamped: false });
  assert.equal(resolveIexView({ date: '2026-11-27' }, '2026-11-26', '2026-11-27').from, '2026-11-27');   // tomorrow's DAM
  assert.equal(resolveIexView({ date: '2026-11-28' }, '2026-11-26', '2026-11-27').from, '2026-11-26');   // past max
  assert.equal(resolveIexView({ date: 'junk' }, '2026-11-26', '2026-11-27').from, '2026-11-26');
});

test('presets end on the default day', () => {
  assert.deepEqual(resolveIexView({ preset: 'last7' }, '2026-11-26', '2026-11-27'), { mode: 'range', from: '2026-11-20', to: '2026-11-26', preset: 'last7', clamped: false });
  assert.equal(resolveIexView({ preset: 'last30' }, '2026-11-26', '2026-11-27').from, '2026-10-28');
  assert.equal(resolveIexView({ preset: 'mtd' }, '2026-11-26', '2026-11-27').from, '2026-11-01');
});

test('custom range: ordered, capped at max and at 366 days', () => {
  const v = resolveIexView({ from: '2026-11-20', to: '2026-11-10' }, '2026-11-26', '2026-11-27');
  assert.deepEqual([v.from, v.to], ['2026-11-10', '2026-11-20']);
  assert.equal(resolveIexView({ from: '2026-11-20', to: '2027-01-01' }, '2026-11-26', '2026-11-27').to, '2026-11-27');
  const long = resolveIexView({ from: '2020-01-01', to: '2026-11-26' }, '2026-11-26', '2026-11-27');
  assert.equal(long.from, '2025-11-26'); assert.equal(long.clamped, true);
});

test('pages: size from the allowed list, page kept in range', () => {
  assert.deepEqual(resolvePage({}, 96 * 7), { page: 1, size: 96, pages: 7, offset: 0, total: 672 });
  assert.equal(resolvePage({ size: '13' }, 100).size, 96);
  assert.deepEqual(resolvePage({ page: '99', size: '200' }, 672), { page: 4, size: 200, pages: 4, offset: 600, total: 672 });
  assert.equal(resolvePage({ page: '-3' }, 10).page, 1);
  assert.equal(resolvePage({}, 0).pages, 1);
});

test('page window', () => {
  assert.deepEqual(pageWindow(1, 1), [1]);
  assert.deepEqual(pageWindow(5, 10), [1, null, 4, 5, 6, null, 10]);
  assert.deepEqual(pageWindow(2, 4), [1, 2, 3, 4]);
});
