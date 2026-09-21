// Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) を WebCrypto だけで実装する。
// Workers 上で動かすため外部依存を持たない。

const enc = new TextEncoder();

export const b64urlToBytes = (s) => {
  const p = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(p + '==='.slice((p.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export const bytesToB64url = (b) => {
  let s = '';
  const a = new Uint8Array(b);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const concat = (...arrs) => {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};

async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

// VAPID の秘密鍵(生の32バイト)から署名用の CryptoKey を作る。
async function importVapidKey(privB64, pubB64) {
  const d = b64urlToBytes(privB64);
  const pub = b64urlToBytes(pubB64); // 0x04 || X || Y
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: true,
    d: bytesToB64url(d),
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function vapidHeader(audience, subject, publicKey, privateKey) {
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToB64url(enc.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  })));
  const unsigned = header + '.' + claims;
  const key = await importVapidKey(privateKey, publicKey);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned));
  return 'vapid t=' + unsigned + '.' + bytesToB64url(sig) + ', k=' + publicKey;
}

// 本文を購読者の公開鍵で暗号化する(aes128gcm、レコード1つ)。
async function encryptPayload(payload, p256dhB64, authB64) {
  const clientPub = b64urlToBytes(p256dhB64);
  const authSecret = b64urlToBytes(authB64);

  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const clientKey = await crypto.subtle.importKey('raw', clientPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, local.privateKey, 256));

  // PRK: HKDF(auth, ecdh, "WebPush: info" || clientPub || serverPub)
  const info = concat(enc.encode('WebPush: info\0'), clientPub, localPubRaw);
  const ikm = await hkdf(authSecret, shared, info, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const body = concat(enc.encode(payload), new Uint8Array([0x02])); // レコード末尾の区切り
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, body));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([localPubRaw.length]), localPubRaw, ct);
}

/**
 * 1件の購読へ通知を送る。
 * 返り値の gone が true なら購読は失効しているので保存先から消してよい。
 */
export async function sendPush(subscription, payload, vapid) {
  const url = new URL(subscription.endpoint);
  const audience = url.origin;
  const auth = await vapidHeader(audience, vapid.subject, vapid.publicKey, vapid.privateKey);
  const body = await encryptPayload(payload, subscription.keys.p256dh, subscription.keys.auth);

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body,
  });
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}
