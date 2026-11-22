import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appearanceEggs,
  imageUrlOrNull,
  imageUrlProblem,
  MAX_IMAGE_URL_LENGTH,
  uploadFileName,
} from '../frontend/src/lib/images.ts';

test('image URLs must be absolute https, like the backend checks them', () => {
  assert.equal(imageUrlProblem('https://cdn.example.com/eggs/paper.png'), null);
  assert.equal(imageUrlProblem('  https://example.com  '), null);
  assert.equal(imageUrlProblem(''), null);
  assert.equal(imageUrlProblem('   '), null);

  for (const rejected of [
    'http://example.com/a.png',
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    '/assets/a.png',
    '//example.com/a.png',
    'example.com/a.png',
    'https://',
    'https://user:secret@example.com/a.png',
    'https://example.com/a b.png',
    'https://example.com/a\n.png',
  ]) {
    assert.notEqual(imageUrlProblem(rejected), null, JSON.stringify(rejected));
  }
});

test('image URLs are capped at 1024 bytes, also after normalisation', () => {
  const base = 'https://example.com/';
  const longest = base + 'a'.repeat(MAX_IMAGE_URL_LENGTH - base.length);
  assert.equal(imageUrlProblem(longest), null);
  assert.match(imageUrlProblem(`${longest}a`) ?? '', /1024/);
  // each `"` becomes `%22`
  assert.match(imageUrlProblem(base + '"'.repeat(400)) ?? '', /1024/);
});

test('a blank URL is stored as no image', () => {
  assert.equal(imageUrlOrNull('  '), null);
  assert.equal(imageUrlOrNull(' https://example.com/a.png '), 'https://example.com/a.png');
});

test('uploads get a unique asset name and only raster image types', () => {
  assert.equal(uploadFileName('egg-1', 'icon', 'My Icon.PNG', 36 ** 3), 'egg-1-icon-1000.png');
  assert.equal(uploadFileName('egg-1', 'banner', 'b.webp', 35), 'egg-1-banner-z.webp');
  for (const name of ['icon.svg', 'icon.html', 'icon', 'png', 'archive.png.zip']) {
    assert.equal(uploadFileName('egg-1', 'icon', name, 1), null, name);
  }
});

test('eggs offered for pictures are the rule targets, then eggs that still have pictures', () => {
  const rules = [{ allowed_eggs: ['b', 'c'] }, { allowed_eggs: ['c', 'd'] }];
  assert.deepEqual(
    appearanceEggs(rules, {
      x: { icon: 'https://example.com/x.png', banner: null },
      b: { icon: null, banner: 'https://example.com/b.png' },
      y: { icon: null, banner: null },
    }),
    ['b', 'c', 'd', 'x'],
  );
  assert.deepEqual(appearanceEggs([], {}), []);
});
