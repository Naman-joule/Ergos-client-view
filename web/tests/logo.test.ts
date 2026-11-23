import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLogoUrl } from '../lib/logo.ts';

test('client logo URLs', () => {
  assert.equal(resolveLogoUrl('https://cdn.example.com/a.png', undefined), 'https://cdn.example.com/a.png');
  assert.equal(resolveLogoUrl('http://cdn.example.com/a.png', undefined), 'https://cdn.example.com/a.png');
  assert.equal(resolveLogoUrl('/uploads/a.png', 'https://ergos.joulewise.com'), 'https://ergos.joulewise.com/uploads/a.png');
  assert.equal(resolveLogoUrl('uploads/a.png', 'https://ergos.joulewise.com/'), 'https://ergos.joulewise.com/uploads/a.png');
  assert.equal(resolveLogoUrl('/uploads/a.png', undefined), null);
  assert.equal(resolveLogoUrl('data:image/png;base64,AAAA', undefined), 'data:image/png;base64,AAAA');
  assert.equal(resolveLogoUrl('javascript:alert(1)', 'https://x.example'), 'https://x.example/javascript:alert(1)');
  assert.equal(resolveLogoUrl('', 'https://x.example'), null);
  assert.equal(resolveLogoUrl(null, 'https://x.example'), null);
  assert.equal(resolveLogoUrl('data:text/html;base64,AAAA', undefined), null);
});
