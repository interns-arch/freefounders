// The bridge between the web app and the shell (src/lib/protocol.ts, PLAN.md §19.17).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkTarget, MAX_BASE64, normalizeServerUrl, originOf, parseMessage, replyError, replyOk } from '../src/lib/protocol.ts';

test('requests: location, photo, download, print', () => {
  assert.deepEqual(parseMessage('{"id":"r1","type":"location"}'), { kind: 'request', request: { id: 'r1', type: 'location' } });
  assert.deepEqual(parseMessage('{"id":"r2","type":"photo","title":" Check in ","optional":true}'), {
    kind: 'request',
    request: { id: 'r2', type: 'photo', title: 'Check in', optional: true },
  });
  assert.deepEqual(parseMessage('{"id":"r2","type":"photo"}'), { kind: 'request', request: { id: 'r2', type: 'photo', title: 'Selfie', optional: false } });
  assert.deepEqual(parseMessage(JSON.stringify({ id: 'r3', type: 'download', filename: 'a.csv', mime: 'text/csv;charset=utf-8', base64: 'YQ==' })), {
    kind: 'request',
    request: { id: 'r3', type: 'download', filename: 'a.csv', mime: 'text/csv', base64: 'YQ==' },
  });
  assert.deepEqual(parseMessage('{"id":"r4","type":"print","html":"<p>x</p>"}'), { kind: 'request', request: { id: 'r4', type: 'print', html: '<p>x</p>' } });
});

test('events from the injected script have no id', () => {
  assert.deepEqual(parseMessage('{"type":"scroll","atTop":true}'), { kind: 'event', event: { type: 'scroll', atTop: true } });
  assert.deepEqual(parseMessage('{"type":"scroll","atTop":"yes"}'), { kind: 'event', event: { type: 'scroll', atTop: false } });
  assert.deepEqual(parseMessage('{"type":"camera-for-files"}'), { kind: 'event', event: { type: 'camera-for-files' } });
});

test('bad messages are refused, with the id when there is one', () => {
  assert.equal(parseMessage('not json').kind, 'invalid');
  assert.equal(parseMessage(42).kind, 'invalid');
  assert.equal(parseMessage('[1]').kind, 'invalid');
  assert.equal(parseMessage('{"type":"location"}').kind, 'invalid');
  const unknown = parseMessage('{"id":"r9","type":"face"}');
  assert.equal(unknown.kind, 'invalid');
  assert.equal(unknown.kind === 'invalid' && unknown.id, 'r9');
  assert.match(unknown.kind === 'invalid' ? unknown.error : '', /cannot do "face"/);
  assert.equal(parseMessage('{"id":"r5","type":"download","filename":"a"}').kind, 'invalid');
  assert.equal(parseMessage('{"id":"r6","type":"print","html":""}').kind, 'invalid');
  const big = parseMessage(JSON.stringify({ id: 'r7', type: 'download', base64: 'A'.repeat(MAX_BASE64 + 4) }));
  assert.match(big.kind === 'invalid' ? big.error : '', /too big/);
  // A strange MIME type falls back to binary.
  const odd = parseMessage(JSON.stringify({ id: 'r8', type: 'download', mime: 'nonsense', base64: 'YQ==' }));
  assert.equal(odd.kind === 'request' && odd.request.type === 'download' && odd.request.mime, 'application/octet-stream');
});

test('replies are what apps/web/src/lib/native-bridge.ts reads', () => {
  assert.deepEqual(JSON.parse(replyOk('r1', { latitude: 1, longitude: 2, accuracy: 5 })), { id: 'r1', ok: true, data: { latitude: 1, longitude: 2, accuracy: 5 } });
  assert.deepEqual(JSON.parse(replyOk('r2')), { id: 'r2', ok: true, data: null });
  assert.deepEqual(JSON.parse(replyError('r2', 'cancelled')), { id: 'r2', ok: false, error: 'cancelled' });
});

test('links: the FreeFounders server stays inside, everything else opens outside', () => {
  const s = 'http://192.168.137.1:8080';
  assert.equal(linkTarget('http://192.168.137.1:8080/attendance', s), 'inside');
  assert.equal(linkTarget('http://192.168.137.1:8080', s), 'inside');
  assert.equal(linkTarget('HTTP://192.168.137.1:8080/x?y#z', s), 'inside');
  assert.equal(linkTarget('about:blank', s), 'inside');
  assert.equal(linkTarget('blob:http://192.168.137.1:8080/abc', s), 'inside');
  assert.equal(linkTarget('http://192.168.137.1:8081/', s), 'outside');
  assert.equal(linkTarget('https://192.168.137.1:8080/', s), 'outside');
  assert.equal(linkTarget('https://wa.me/919876543210', s), 'outside');
  assert.equal(linkTarget('tel:+919876543210', s), 'outside');
  assert.equal(linkTarget('mailto:a@b.c', s), 'outside');
  assert.equal(linkTarget('intent://scan/#Intent;end', s), 'outside');
  assert.equal(linkTarget('http://evil.test/@192.168.137.1:8080', s), 'outside');
  assert.equal(linkTarget('http://192.168.137.1:8080@evil.test/', s), 'outside');
  assert.equal(linkTarget('https://app.example.com:443/a', 'https://app.example.com'), 'inside');
});

test('origins and typed server addresses', () => {
  assert.equal(originOf('http://Example.com:80/a'), 'http://example.com');
  assert.equal(originOf('https://[::1]:8443/'), 'https://[::1]:8443');
  assert.equal(originOf('ftp://x'), null);
  assert.equal(normalizeServerUrl(' 192.168.137.1:8080 '), 'http://192.168.137.1:8080');
  assert.equal(normalizeServerUrl('http://192.168.2.72:8080/attendance?x=1'), 'http://192.168.2.72:8080');
  assert.equal(normalizeServerUrl('https://app.freefounders.example/'), 'https://app.freefounders.example');
  assert.equal(normalizeServerUrl(''), null);
  assert.equal(normalizeServerUrl('ftp://host'), null);
  assert.equal(normalizeServerUrl('not a host'), null);
});
