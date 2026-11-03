// Run with `bun test` (node:test API). Files attached to the dashboard assistant.
import { describe, it as test } from 'node:test';
import assert from 'node:assert/strict';
import { AttachmentInput, checkAttachment } from './check-attachment';

const b64 = (bytes: number[] | string) =>
  Buffer.from(typeof bytes === 'string' ? bytes : Uint8Array.from(bytes)).toString('base64');

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];

describe('assistant attachments', () => {
  test('a real PNG declared as PNG is accepted as an image', () => {
    const file = checkAttachment(
      AttachmentInput.parse({ name: 'shot.png', mime: 'image/png', data: b64(PNG) })
    );
    assert.equal(file?.kind, 'image');
  });

  test('bytes that do not match the declared type are refused', () => {
    assert.equal(
      checkAttachment({ name: 'x.png', mime: 'image/png', data: b64('<html><script>') }),
      null
    );
    assert.equal(
      checkAttachment({ name: 'x.pdf', mime: 'image/png', data: b64('%PDF-1.7 ...') }),
      null
    );
  });

  test('a PDF and a text file are accepted with their kind', () => {
    assert.equal(
      checkAttachment({ name: 'a.pdf', mime: 'application/pdf', data: b64('%PDF-1.7 hello') })
        ?.kind,
      'pdf'
    );
    const text = checkAttachment({
      name: 'notes.txt',
      mime: 'text/plain',
      data: b64('Bookings fail since Monday')
    });
    assert.equal(text?.kind, 'text');
    assert.equal(text?.data, 'Bookings fail since Monday');
  });

  test('binary data sent as text is refused', () => {
    assert.equal(
      checkAttachment({ name: 'a.txt', mime: 'text/plain', data: b64([0x41, 0, 0x42]) }),
      null
    );
  });

  test('file names are cleaned and oversized data is rejected by the schema', () => {
    assert.equal(
      AttachmentInput.parse({ name: '../../<b>evil</b>.png', mime: 'image/png', data: b64(PNG) })
        .name,
      '....bevilb.png'
    );
    assert.equal(
      AttachmentInput.safeParse({ name: 'big.png', mime: 'image/png', data: 'A'.repeat(1_700_000) })
        .success,
      false
    );
  });
});
