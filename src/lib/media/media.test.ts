// Run with `bun test`. Media object paths (same rule as private.media_path_ok in
// migration media_storage), image sizing and the no-WebP fallback.
import { describe, it as test } from 'node:test';
import assert from 'node:assert/strict';
import { fallbackType, fitWithin, MEDIA_MAX_EDGE } from './optimize-image';
import { mediaObjectPath, storedFileName, thumbPathFor } from './paths';

const ORG = 'd2d91733-77fe-4840-8a47-4564de49dd29';
const SITE = 'ws_d5e600b7dc2ec9a9';
const ID = '0b7c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3';
// Same rule as private.media_path_ok (migration media_storage).
const LAYOUT =
  /^org\/[0-9a-f-]{36}\/site\/ws_[a-z0-9]{8,32}\/20[2-9][0-9]\/(0[1-9]|1[0-2])\/[0-9a-f-]{36}(_thumb\.webp|\.(jpg|png|webp|gif|avif|pdf|mp4|webm))$/;

describe('media paths', () => {
  test('builds org/<org>/site/<site>/<yyyy>/<mm>/<uuid>.<ext> in UTC', () => {
    const path = mediaObjectPath(ORG, SITE, ID, 'webp', new Date('2026-01-31T23:30:00-05:00'));
    assert.equal(path, `org/${ORG}/site/${SITE}/2026/02/${ID}.webp`);
    assert.equal(LAYOUT.test(path), true);
  });

  test('thumbnail sits next to the file, always WebP', () => {
    const path = mediaObjectPath(ORG, SITE, ID, 'jpg', new Date('2026-10-26T12:00:00Z'));
    const thumb = thumbPathFor(path);
    assert.equal(thumb, `org/${ORG}/site/${SITE}/2026/10/${ID}_thumb.webp`);
    assert.equal(LAYOUT.test(thumb), true);
  });

  test('stored file name keeps the base name with the stored extension', () => {
    assert.equal(storedFileName('IMG_1234.HEIC.jpeg', 'webp'), 'IMG_1234.HEIC.webp');
    assert.equal(storedFileName('logo', 'png'), 'logo.png');
    assert.equal(storedFileName('.jpg', 'webp'), 'upload.webp');
  });
});

describe('image sizing', () => {
  test('long edge capped, ratio kept', () => {
    assert.deepEqual(fitWithin(6000, 4000, MEDIA_MAX_EDGE), { width: 2400, height: 1600 });
    assert.deepEqual(fitWithin(3000, 6000, MEDIA_MAX_EDGE), { width: 1200, height: 2400 });
  });

  test('never enlarged', () => {
    assert.deepEqual(fitWithin(800, 600, MEDIA_MAX_EDGE), { width: 800, height: 600 });
  });

  test('tiny images keep at least one pixel', () => {
    assert.deepEqual(fitWithin(10000, 1, 512), { width: 512, height: 1 });
  });

  test('without WebP: PNG keeps transparency, JPEG otherwise', () => {
    assert.equal(fallbackType(true), 'image/png');
    assert.equal(fallbackType(false), 'image/jpeg');
  });
});
