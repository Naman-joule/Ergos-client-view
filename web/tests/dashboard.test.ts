import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DashboardSpecSchema, validateSpec } from '../lib/dashboard/schema.ts';
import { DEFAULT_SPEC } from '../lib/dashboard/defaults.ts';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

test('the default spec validates', () => {
  const r = validateSpec(DEFAULT_SPEC);
  assert.equal(r.ok, true);
});

test('span defaults to full', () => {
  const s = clone(DEFAULT_SPEC) as any;
  s.pages.today.widgets = [{ type: 'today.supply' }];
  const r = DashboardSpecSchema.parse(s);
  assert.equal(r.pages.today.widgets[0]!.span, 'full');
});

test('a duplicate widget is rejected', () => {
  const s = clone(DEFAULT_SPEC) as any;
  s.pages.today.widgets.push({ type: 'today.supply' });
  const r = validateSpec(s);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /appears more than once/);
});

test('an unknown widget type is rejected', () => {
  const s = clone(DEFAULT_SPEC) as any;
  s.pages.savings.widgets.push({ type: 'savings.crypto' });
  assert.equal(validateSpec(s).ok, false);
});

test('free-form fields are rejected', () => {
  const s = clone(DEFAULT_SPEC) as any;
  s.pages.today.widgets[0].html = '<script>';
  assert.equal(validateSpec(s).ok, false);
  const t = clone(DEFAULT_SPEC) as any;
  t.theme.css = 'body{}';
  assert.equal(validateSpec(t).ok, false);
});

test('props are bounded', () => {
  const s = clone(DEFAULT_SPEC) as any;
  s.pages.savings.widgets.find((w: any) => w.type === 'savings.profile').days = 30;
  assert.equal(validateSpec(s).ok, false);
  const t = clone(DEFAULT_SPEC) as any;
  t.pages.today.widgets.find((w: any) => w.type === 'today.tiles').tiles = ['grid', 'grid'];
  assert.equal(validateSpec(t).ok, false);
  const u = clone(DEFAULT_SPEC) as any;
  u.pages.today.widgets[0].title = 'x'.repeat(61);
  assert.equal(validateSpec(u).ok, false);
  const v = clone(DEFAULT_SPEC) as any;
  v.theme.palette = 'neon';
  assert.equal(validateSpec(v).ok, false);
});
