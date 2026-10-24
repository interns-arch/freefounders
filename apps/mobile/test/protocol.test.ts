// The bridge between the web app and the shell (src/lib/protocol.ts, PLAN.md §19.17).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fromServer,
  isLocalHost,
  isPaymentPage,
  linkTarget,
  MAX_BASE64,
  normalizeServerUrl,
  originOf,
  outsideUrl,
  parseMessage,
  paymentStep,
  replyError,
  replyOk,
  upiAppUrl,
  voiceLang,
} from '../src/lib/protocol.ts';

test('requests: location, photo, download, print', () => {
  assert.deepEqual(parseMessage('{"id":"r1","type":"location"}'), { kind: 'request', request: { id: 'r1', type: 'location' } });
  assert.deepEqual(parseMessage('{"id":"r2","type":"photo","title":" Check in ","optional":true}'), {
    kind: 'request',
    request: { id: 'r2', type: 'photo', title: 'Check in', optional: true, facing: 'front' },
  });
  assert.deepEqual(parseMessage('{"id":"r2","type":"photo"}'), { kind: 'request', request: { id: 'r2', type: 'photo', title: 'Selfie', optional: false, facing: 'front' } });
  // Photos of things (asset photos) ask for the back camera; anything else means the front one.
  assert.deepEqual(parseMessage('{"id":"r2","type":"photo","title":"Asset photo","facing":"back"}'), {
    kind: 'request',
    request: { id: 'r2', type: 'photo', title: 'Asset photo', optional: false, facing: 'back' },
  });
  assert.deepEqual(parseMessage('{"id":"r2","type":"photo","facing":"sideways"}'), { kind: 'request', request: { id: 'r2', type: 'photo', title: 'Selfie', optional: false, facing: 'front' } });
  assert.deepEqual(parseMessage(JSON.stringify({ id: 'r3', type: 'download', filename: 'a.csv', mime: 'text/csv;charset=utf-8', base64: 'YQ==' })), {
    kind: 'request',
    request: { id: 'r3', type: 'download', filename: 'a.csv', mime: 'text/csv', base64: 'YQ==' },
  });
  assert.deepEqual(parseMessage('{"id":"r4","type":"print","html":"<p>x</p>"}'), { kind: 'request', request: { id: 'r4', type: 'print', html: '<p>x</p>' } });
});

test('voice: the phone listens (Indian English or Hindi), and "Done" stops it', () => {
  assert.deepEqual(parseMessage('{"id":"r5","type":"voice","lang":"hi-IN"}'), { kind: 'request', request: { id: 'r5', type: 'voice', lang: 'hi-IN' } });
  // anything else falls back to Indian English
  assert.deepEqual(parseMessage('{"id":"r5","type":"voice","lang":"fr-FR"}'), { kind: 'request', request: { id: 'r5', type: 'voice', lang: 'en-IN' } });
  assert.deepEqual(parseMessage('{"id":"r5","type":"voice"}'), { kind: 'request', request: { id: 'r5', type: 'voice', lang: 'en-IN' } });
  assert.deepEqual(parseMessage('{"id":"r6","type":"voice-stop"}'), { kind: 'request', request: { id: 'r6', type: 'voice-stop' } });
  assert.equal(voiceLang(undefined), 'en-IN');
  // a blocked microphone tells the web app it can only be allowed in Settings
  assert.deepEqual(JSON.parse(replyError('r5', 'Blocked', { code: 'permission', permission: 'microphone', settings: true })), {
    id: 'r5', ok: false, error: 'Blocked', code: 'permission', permission: 'microphone', settings: true,
  });
  assert.deepEqual(JSON.parse(replyOk('r5', { text: 'Rahul ko kal' })), { id: 'r5', ok: true, data: { text: 'Rahul ko kal' } });
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

test('links: the Kaampilot server stays inside, everything else opens outside', () => {
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

test('security: data: pages, foreign blobs and foreign frames never load; frames never start other apps', () => {
  const s = 'https://app.example.com';
  assert.equal(linkTarget('data:text/html,<script>x</script>', s), 'block');
  assert.equal(linkTarget('DATA:text/html;base64,PHA+', s), 'block');
  assert.equal(linkTarget('blob:https://evil.test/abc', s), 'block');
  assert.equal(linkTarget('blob:https://app.example.com/abc', s), 'inside');
  assert.equal(linkTarget('about:srcdoc', s, false), 'inside');
  assert.equal(linkTarget('https://app.example.com/x', s, false), 'inside');
  assert.equal(linkTarget('https://ads.evil.test/frame', s, false), 'block');
  assert.equal(linkTarget('intent://scan/#Intent;end', s, false), 'block');
  assert.equal(linkTarget('https://ads.evil.test/page', s, true), 'outside');
});

test('security: bridge messages count only from pages of the server', () => {
  const s = 'http://192.168.137.1:8080';
  assert.equal(fromServer('http://192.168.137.1:8080/attendance?x=1', s), true);
  assert.equal(fromServer('http://192.168.137.1:8080', s), true);
  assert.equal(fromServer('http://192.168.137.1:8081/', s), false);
  assert.equal(fromServer('https://evil.test/', s), false);
  assert.equal(fromServer('http://192.168.137.1:8080@evil.test/', s), false);
  assert.equal(fromServer('data:text/html,x', s), false);
  assert.equal(fromServer('about:blank', s), false);
  assert.equal(fromServer(undefined, s), false);
});

test('security: plain http only for the office network; anything else needs https', () => {
  for (const local of ['http://192.168.1.5:8080', 'http://10.0.0.2', 'http://172.20.1.1:8080', 'http://127.0.0.1:8080', 'http://localhost:8080', 'http://mypc:8080', 'http://office.local'])
    assert.equal(isLocalHost(local), true, local);
  for (const remote of ['http://8.8.8.8', 'http://172.32.0.1', 'http://app.example.com', 'http://192.169.1.1']) assert.equal(isLocalHost(remote), false, remote);
  assert.equal(normalizeServerUrl('app.freefounders.example'), 'https://app.freefounders.example');
  assert.equal(normalizeServerUrl('http://app.freefounders.example'), null);
  assert.equal(normalizeServerUrl('http://203.0.113.9:8080'), null);
  assert.equal(normalizeServerUrl('https://203.0.113.9:8443/'), 'https://203.0.113.9:8443');
  assert.equal(normalizeServerUrl('10.1.2.3:8080'), 'http://10.1.2.3:8080');
  assert.equal(normalizeServerUrl('javascript:alert(1)'), null);
});

test('payments (PLAN.md §21.10): Cashfree pages stay in the app, also in a frame; UPI links open the UPI app', () => {
  const s = 'https://app.example.com';
  assert.equal(isPaymentPage('https://sdk.cashfree.com/js/v3/cashfree.js'), true);
  assert.equal(isPaymentPage('https://payments.cashfree.com/order/'), true);
  assert.equal(isPaymentPage('http://payments.cashfree.com/'), false, 'https only');
  assert.equal(isPaymentPage('https://cashfree.com.evil.test/'), false);
  assert.equal(isPaymentPage('https://evilcashfree.com/'), false);
  assert.equal(isPaymentPage('https://cashfree.com.evil.test/'), false);
  assert.equal(linkTarget('https://sandbox.cashfree.com/pg/view/sessions/checkout', s, false), 'inside', 'checkout frame');
  assert.equal(linkTarget('https://payments.cashfree.com/order/#session', s, true), 'inside', 'redirect');

  // UPI: upi:// and Android intent:// for a UPI app open outside, even from Cashfree's page.
  const intent = 'intent://pay?pa=merchant@cashfree&pn=Kaampilot&am=584.10&cu=INR#Intent;scheme=upi;package=com.phonepe.app;end';
  assert.equal(linkTarget('upi://pay?pa=merchant@cashfree&am=1.00', s, false), 'outside');
  assert.equal(linkTarget(intent, s, false), 'outside');
  assert.equal(upiAppUrl(intent), 'upi://pay?pa=merchant@cashfree&pn=Kaampilot&am=584.10&cu=INR');
  assert.equal(upiAppUrl('intent://pay?pa=x#Intent;package=com.google.android.apps.nbu.paisa.user;scheme=tez;end'), 'tez://pay?pa=x');
  assert.equal(upiAppUrl('phonepe://pay?pa=x'), 'phonepe://pay?pa=x');
  assert.equal(outsideUrl(intent), 'upi://pay?pa=merchant@cashfree&pn=Kaampilot&am=584.10&cu=INR');
  assert.equal(outsideUrl('tel:+919876543210'), 'tel:+919876543210');
  // Anything else stays as before: other intents never from a frame, other sites never in a frame.
  assert.equal(upiAppUrl('intent://scan/#Intent;scheme=zxing;end'), null);
  assert.equal(upiAppUrl('https://upi.example.com/'), null);
  assert.equal(linkTarget('intent://scan/#Intent;scheme=zxing;end', s, false), 'block');
  assert.equal(linkTarget('https://bank.example.com/3ds', s, false), 'block');
});

test('payments: the bank pages of a payment stay in the app until it is back on the server', () => {
  const s = 'http://192.168.2.72:8080';
  let paying = false;
  paying = paymentStep('http://192.168.2.72:8080/billing/pay/abc', s, paying);
  assert.equal(paying, false);
  assert.equal(linkTarget('https://acs.bank.example.com/3ds', s, true, paying), 'outside', 'no payment on: other sites open outside');
  paying = paymentStep('https://payments.cashfree.com/order/#session', s, paying);
  assert.equal(paying, true);
  paying = paymentStep('https://acs.bank.example.com/3ds', s, paying);
  assert.equal(paying, true);
  assert.equal(linkTarget('https://acs.bank.example.com/3ds', s, true, paying), 'inside');
  assert.equal(linkTarget('http://plain.example.com/', s, true, paying), 'outside', 'https only');
  assert.equal(linkTarget('https://acs.bank.example.com/3ds', s, false, paying), 'block', 'never in a frame');
  paying = paymentStep('http://192.168.2.72:8080/billing/pay/abc?order_id=kp_abc', s, paying);
  assert.equal(paying, false);
  assert.equal(linkTarget('https://acs.bank.example.com/3ds', s, true, paying), 'outside');
});
