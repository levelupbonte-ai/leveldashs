// Run with `bun test`. The staff preview of LevelStudio HTML: policy injection and
// the share link address.
import { describe, it as test } from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_CSP, PREVIEW_SANDBOX, previewDocument, studioShareUrl } from './preview';

describe('studio preview document', () => {
  test('the policy is the first thing in <head>', () => {
    const out = previewDocument(
      '<!DOCTYPE html><html lang="en"><head><script src="https://cdn.tailwindcss.com"></script></head><body>Hi</body></html>'
    );
    assert.match(
      out,
      /^<!DOCTYPE html><html lang="en"><head><meta http-equiv="Content-Security-Policy"/
    );
    assert.ok(out.indexOf('Content-Security-Policy') < out.indexOf('cdn.tailwindcss.com'));
  });
  test('a head is added when missing, after the doctype (no quirks mode)', () => {
    assert.match(previewDocument('<html><body>x</body></html>'), /^<html><head><meta /);
    assert.match(previewDocument('<!doctype html><p>x</p>'), /^<!doctype html><head><meta /);
    assert.match(previewDocument('<p>x</p>'), /^<head><meta /);
  });
  test('the policy blocks network calls, forms, frames and <base>', () => {
    for (const d of [
      "connect-src 'none'",
      "form-action 'none'",
      "frame-src 'none'",
      "base-uri 'none'",
      "default-src 'none'"
    ]) {
      assert.ok(PREVIEW_CSP.includes(d), d);
    }
  });
  test('the sandbox never allows same-origin, top navigation, pop-ups or forms', () => {
    const flags = PREVIEW_SANDBOX.split(/\s+/);
    for (const f of [
      'allow-same-origin',
      'allow-top-navigation',
      'allow-popups',
      'allow-forms',
      'allow-modals'
    ]) {
      assert.ok(!flags.includes(f), f);
    }
  });
});

describe('studio share link', () => {
  test('only a well-formed /p/<token> path', () => {
    const token = 'a'.repeat(32);
    assert.equal(studioShareUrl(`/p/${token}`), `https://studio.levelup-ecosystem.com/p/${token}`);
    assert.equal(studioShareUrl(null), null);
    assert.equal(studioShareUrl('/p/../admin'), null);
    assert.equal(studioShareUrl('//evil.example/p/x'), null);
  });
});
