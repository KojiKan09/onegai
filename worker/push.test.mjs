// Web Push の暗号処理を、実際に復号して確かめる。
// 送信先を自前のサーバーに向け、受け取った本文を購読者の秘密鍵で開く。
import http from 'node:http';
import { sendPush, bytesToB64url, b64urlToBytes } from './src/push.js';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('ok  :', m); } else { fails.push(m); console.error('FAIL:', m); } };

const enc = new TextEncoder();
const concat = (...a) => { const n = a.reduce((s, x) => s + x.length, 0); const o = new Uint8Array(n); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}

// --- 購読者の鍵を作る ---
const subKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const subPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', subKeys.publicKey));
const authSecret = crypto.getRandomValues(new Uint8Array(16));

// --- 受け取り役のサーバー ---
let captured = null;
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    captured = { headers: req.headers, body: new Uint8Array(Buffer.concat(chunks)) };
    res.writeHead(201).end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const vapidPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const vapidPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', vapidPair.publicKey));
const vapidJwk = await crypto.subtle.exportKey('jwk', vapidPair.privateKey);

const subscription = {
  endpoint: 'http://127.0.0.1:' + port + '/push/abc',
  keys: { p256dh: bytesToB64url(subPubRaw), auth: bytesToB64url(authSecret) },
};
const payload = JSON.stringify({ title: 'ゆうきさんから 3件', body: '内容を見て、返事ができます。', tag: 'batch' });

const res = await sendPush(subscription, payload, {
  publicKey: bytesToB64url(vapidPubRaw),
  privateKey: vapidJwk.d,
  subject: 'mailto:test@example.com',
});

ok(res.ok, '送信先が受け付ける');
ok(!!captured, '本文が届く');
ok(captured.headers['content-encoding'] === 'aes128gcm', 'Content-Encoding が aes128gcm');
ok(/^vapid t=.+, k=.+$/.test(captured.headers.authorization || ''), 'VAPID の Authorization が付く');

// --- VAPID の署名を検証 ---
const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(captured.headers.authorization);
ok(!!m, 'Authorization を分解できる');
if (m) {
  const [, h, c, sig, k] = m;
  const jwtOk = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    await crypto.subtle.importKey('raw', b64urlToBytes(k), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']),
    b64urlToBytes(sig),
    enc.encode(h + '.' + c),
  );
  ok(jwtOk, 'VAPID の署名が正しい');
  const claims = JSON.parse(Buffer.from(b64urlToBytes(c)).toString('utf8'));
  ok(claims.aud === 'http://127.0.0.1:' + port, 'aud が送信先のオリジンと一致する');
  ok(claims.sub === 'mailto:test@example.com', 'sub が設定どおり');
  ok(claims.exp > Math.floor(Date.now() / 1000), 'exp が未来');
  ok(bytesToB64url(vapidPubRaw) === k, '鍵が公開鍵と一致する');
}

// --- 本文を購読者の鍵で復号 ---
const body = captured.body;
const salt = body.slice(0, 16);
const keyLen = body[20];
const serverPub = body.slice(21, 21 + keyLen);
const ct = body.slice(21 + keyLen);

const serverKey = await crypto.subtle.importKey('raw', serverPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: serverKey }, subKeys.privateKey, 256));
const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), subPubRaw, serverPub), 32);
const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);

let plain = null;
try {
  const out = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, ct));
  plain = Buffer.from(out.slice(0, out.length - 1)).toString('utf8');
} catch (e) {
  console.error(String(e));
}
ok(plain === payload, '購読者の鍵で復号すると元の本文に戻る');
ok(plain && JSON.parse(plain).title === 'ゆうきさんから 3件', '日本語がそのまま復元される');

// --- 失効した購読を見分ける ---
server.close();
const gone = http.createServer((req, res) => { res.writeHead(410).end(); });
await new Promise((r) => gone.listen(0, '127.0.0.1', r));
const res2 = await sendPush(
  { ...subscription, endpoint: 'http://127.0.0.1:' + gone.address().port + '/x' },
  'x',
  { publicKey: bytesToB64url(vapidPubRaw), privateKey: vapidJwk.d, subject: 'mailto:test@example.com' },
);
ok(res2.gone === true, '410 を失効として扱う');
gone.close();

console.log('');
if (fails.length) { console.error(fails.length + ' FAILED'); process.exit(1); }
console.log(pass + ' checks passed');
