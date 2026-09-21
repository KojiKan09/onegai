// API の通し検証。`npx wrangler dev --port 8788 --local` を別で動かした状態で実行する。
const BASE = process.env.BASE || 'http://127.0.0.1:8788';

let pass = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) { pass++; console.log('ok  :', msg); } else { fails.push(msg); console.error('FAIL:', msg); } };

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const find = (state, title) => state.items.find((i) => i.title === title);

// --- 紐づけ ---
const created = await call('/pair/create', { method: 'POST', body: { studentName: 'ゆうき', motherName: 'お母さん' } });
ok(created.status === 200 && created.data.token, '世帯を作れる');
ok(/^[A-Z2-9]{6}$/.test(created.data.code), 'コードは紛らわしい文字を含まない6文字: ' + created.data.code);
const student = created.data.token;

ok((await call('/state')).status === 401, 'トークンなしでは読めない');
ok((await call('/state', { token: 'not-a-real-token' })).status === 401, '不正なトークンでは読めない');

const joinedBad = await call('/pair/join', { method: 'POST', body: { code: 'ZZZZZZ' } });
ok(joinedBad.status === 400, '間違ったコードでは参加できない');

const joined = await call('/pair/join', { method: 'POST', body: { code: created.data.code } });
ok(joined.status === 200 && joined.data.role === 'mother', 'コードで渡す側として参加できる');
const mother = joined.data.token;

const reuse = await call('/pair/join', { method: 'POST', body: { code: created.data.code } });
ok(reuse.status === 400, '同じコードは二度使えない');

// --- メモは渡す側に見えない ---
await call('/act', { method: 'POST', token: student, body: { type: 'addMemo', amount: 4500, title: '食費(今週分)' } });
await call('/act', { method: 'POST', token: student, body: { type: 'addMemo', amount: 1980, title: '日用品' } });
const memoRes = await call('/act', { method: 'POST', token: student, body: { type: 'addMemo', amount: 3200, title: '参考書' } });
ok(memoRes.data.items.length === 3, '受け取る側にはメモが3件見える');

let mState = (await call('/state', { token: mother })).data;
ok(mState.items.length === 0, '渡す側にメモは1件も見えない');

const noAmount = await call('/act', { method: 'POST', token: student, body: { type: 'addMemo', amount: 0, title: 'ゼロ' } });
ok(noAmount.status === 400, '金額なしのメモは作れない');

const motherMemo = await call('/act', { method: 'POST', token: mother, body: { type: 'addMemo', amount: 100, title: '不正' } });
ok(motherMemo.status === 400, '渡す側はメモを作れない');

// --- 自腹記録は渡す側に見えない ---
let sState = (await call('/state', { token: student })).data;
const ref = find(sState, '参考書');
await call('/act', { method: 'POST', token: student, body: { type: 'selfPaid', id: ref.id } });
mState = (await call('/state', { token: mother })).data;
ok(!mState.items.some((i) => i.title === '参考書'), '自腹の記録は渡す側に見えない');
sState = (await call('/state', { token: student })).data;
ok(sState.items.some((i) => i.title === '参考書' && i.selfPaid), '自腹の記録は受け取る側に残る');

// --- まとめ送信 ---
const ids = sState.items.filter((i) => !i.sentAt && !i.selfPaid).map((i) => i.id);
const sent = await call('/act', { method: 'POST', token: student, body: { type: 'send', ids } });
ok(sent.status === 200, 'まとめて送れる');
mState = (await call('/state', { token: mother })).data;
ok(mState.items.length === 2, '渡す側に2件届く');
ok(new Set(mState.items.map((i) => i.batchId)).size === 1, '同じ送信は1つの束になる');

const motherSend = await call('/act', { method: 'POST', token: mother, body: { type: 'send', ids: mState.items.map((i) => i.id) } });
ok(motherSend.status === 400, '渡す側は送信できない');

// --- 返事 ---
const food = find(mState, '食費(今週分)');
const partial = await call('/act', {
  method: 'POST', token: mother,
  body: { type: 'decide', id: food.id, choice: 'partial', amount: 3000, remainder: 'later', note: '残りは来月に' },
});
ok(partial.status === 200, '一部を渡す返事ができる');
const rest = partial.data.items.find((i) => i.title === '食費(今週分)(残り)');
ok(rest && rest.amount === 1500 && rest.decision === 'full', '残額は渡す側の約束として受け渡し待ちに入る(¥1,500)');

const tooMuch = await call('/act', {
  method: 'POST', token: mother,
  body: { type: 'decide', id: find(partial.data, '日用品').id, choice: 'partial', amount: 99999 },
});
ok(tooMuch.status === 400, '申し出より多い金額は返事できない');

const studentDecide = await call('/act', { method: 'POST', token: student, body: { type: 'decide', id: find(partial.data, '日用品').id, choice: 'full' } });
ok(studentDecide.status === 400, '受け取る側は返事できない');

const goods = find(partial.data, '日用品');
const bulk = await call('/act', { method: 'POST', token: mother, body: { type: 'approveBatch', batchId: goods.batchId } });
ok(bulk.status === 200 && find(bulk.data, '日用品').decision === 'full', '一括承認ができる');

// --- 受け渡し ---
const g = find(bulk.data, '日用品');
const wrongTick = await call('/act', { method: 'POST', token: student, body: { type: 'tick', id: g.id, who: 'mother' } });
ok(wrongTick.status === 400, '相手の欄はチェックできない');

await call('/act', { method: 'POST', token: mother, body: { type: 'tick', id: g.id, who: 'mother' } });
sState = (await call('/state', { token: student })).data;
ok(find(sState, '日用品').motherTickedAt, '渡す側のチェックが受け取る側に反映される');

const done = await call('/act', { method: 'POST', token: student, body: { type: 'tick', id: g.id, who: 'student' } });
const dg = find(done.data, '日用品');
ok(dg.motherTickedAt && dg.studentTickedAt, '両方のチェックで完了になる');

// --- 通知の状態 ---
ok(sState.push.publicKey, '公開鍵が画面に渡る');
ok(sState.partner.joined === true, '相手がつながっていることが分かる');
ok(sState.partner.pushVerified === false, '通知が確かめられていないことが分かる');
const testNoSub = await call('/push/test', { method: 'POST', token: student });
ok(testNoSub.status === 400, '購読していない端末はテスト通知を送れない');

// --- 再接続 ---
const recode = await call('/pair/code', { method: 'POST', token: student, body: { role: 'mother' } });
ok(recode.status === 200 && recode.data.code, '受け取る側が再接続コードを出せる');
const rejoin = await call('/pair/join', { method: 'POST', body: { code: recode.data.code } });
ok(rejoin.status === 200, '新しいコードで別の端末がつながる');
const m2 = (await call('/state', { token: rejoin.data.token })).data;
const m1 = (await call('/state', { token: mother })).data;
ok(m2.role === 'mother', 'つなぎ直した端末は渡す側になる');
ok(m2.items.length === m1.items.length && m2.items.length > 0,
  'つなぎ直した端末に同じ記録が見える(' + m2.items.length + '件)');
ok(!m2.items.some((i) => i.selfPaid), 'つなぎ直しても自腹の記録は見えない');

// --- 定時処理 ---
const cron = await fetch(BASE + '/__cron');
ok(cron.ok, '定時処理が例外なく動く');

console.log('');
if (fails.length) { console.error(fails.length + ' FAILED'); process.exit(1); }
console.log(pass + ' checks passed');
