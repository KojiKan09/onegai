// VAPID 鍵を作る。公開鍵は wrangler.toml の vars に、秘密鍵は wrangler secret に入れる。
//   npm run vapid
import { webcrypto as crypto } from 'node:crypto';

const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);

console.log('VAPID_PUBLIC_KEY  =', b64url(pub));
console.log('VAPID_PRIVATE_KEY =', jwk.d);
console.log('');
console.log('公開鍵は wrangler.toml の [vars] に置く(公開してよい)。');
console.log('秘密鍵は次のコマンドで登録する。リポジトリには絶対に置かない。');
console.log('  npx wrangler secret put VAPID_PRIVATE_KEY');
