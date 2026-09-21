// Phase 2a 検証: 下書き(メモ) → まとめ送信 → 母の一括/個別判断 → 受け渡し → 完了
import { writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'file:///C:/Users/kanta/dev/onegai/index.html';
const out = process.argv[2] ?? './shots';
mkdirSync(out, { recursive: true });

const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9334', `--user-data-dir=${out}\\edge-profile2`, '--no-first-run', '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let list;
for (let i = 0; i < 40; i++) { try { list = await (await fetch('http://127.0.0.1:9334/json')).json(); if (list.length) break; } catch {} await sleep(250); }
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
const click = async (label, nth = 0) => {
  const ok = await evalJs(`(() => { const bs=[...document.querySelectorAll('button')].filter(b=>!b.disabled && b.innerText.trim().startsWith(${JSON.stringify(label)})); const b=bs[${nth}]; if(!b) return false; b.click(); return true; })()`);
  if (!ok) throw new Error('button not found: ' + label);
  await sleep(180);
};
const act = async (sel) => { const ok = await evalJs(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.click(); return true;})()`); if (!ok) throw new Error('no element: ' + sel); await sleep(180); };
const type = async (sel, v) => { await evalJs(`(() => { const el=document.querySelector(${JSON.stringify(sel)}); const p= el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p,'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input',{bubbles:true})); })()`); await sleep(100); };
const tab = async (t) => act(`[data-action="tab"][data-tab="${t}"]`);
const text = async () => evalJs('document.getElementById("app").innerText');
const has = async (s) => (await text()).includes(s);
const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}/${n}.png`, Buffer.from(r.result.data, 'base64')); console.log('shot', n); };
const assert = async (c, m) => { if (!(await c)) { console.error('FAIL:', m); await shot('fail'); process.exitCode = 1; throw new Error(m); } console.log('ok  :', m); };
const errors = [];
await send('Runtime.enable');
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(d.params.exceptionDetails.exception?.description ?? d.params)); });

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.enable');
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await send('Page.navigate', { url: URL });
await sleep(1200);
await evalJs('localStorage.clear()');
await send('Page.navigate', { url: URL });
await sleep(1500);

// --- 1. 学生ホーム
await assert(has('メモ'), '学生ホームにメモ欄');
await assert(has('メモ 3件'), 'メモの件数が静かに出る(催促でない)');
await assert(evalJs('!document.querySelector(".notice")'), '件数が注意色のブロックになっていない');
await assert(has('受け取っていれば「受け取った」をどうぞ'), '受け渡しリマインド');
await shot('01-student-home');

// --- 2. メモ作成: 金額が先、品目は任意、補足は初期非表示
await click('メモしておく');
await assert(evalJs(`document.activeElement && document.activeElement.name === 'amount'`), '金額欄に自動でフォーカスする');
await assert(evalJs(`(()=>{const ls=[...document.querySelectorAll('.field label')].map(l=>l.innerText.trim()); return ls[0]==='いくら';})()`), '金額の欄が最初');
await assert(!(await has('補足(任意)')), '補足は初期状態で非表示');
await assert(evalJs('!document.querySelector("textarea")'), '補足欄のtextareaが存在しない');
await shot('02-add');
await click('メモしておく');   // 金額空
await assert(has('金額を入力してください'), '金額空はインラインヒント');
await type('input[name="amount"]', '2480');
await click('メモしておく');   // 品目なしで通ること
await sleep(200);
await assert(evalJs('document.body.innerText.includes("メモしました")'), '品目なしでもメモできる(最短経路)');
await assert(has('品目なし'), '品目なしとして表示');
await shot('03-memo-added');

// --- 3. まとめ送信: 合計を出さない
await act('[data-action="select"][data-id="i-food"]');
await act('[data-action="select"][data-id="i-goods"]');
await assert(has('2件を送る'), '選択件数が出る');
const beforeSend = await text();
await assert(Promise.resolve(!/合計/.test(beforeSend)), '送信前画面に「合計」の語がない');
await assert(Promise.resolve(!/6,480|¥6,480/.test(beforeSend)), '送信前画面に合計額が出ていない');
await shot('04-selected');
await click('2件を送る');
await assert(evalJs('document.body.innerText.includes("2件を送りますか")'), '送信確認シート');
const sheetTxt = await evalJs('document.querySelector(".sheet").innerText');
await assert(Promise.resolve(!/合計|6,480/.test(sheetTxt)), '確認シートにも合計額がない');
await act('[data-action="sheet-confirm"]');
await sleep(300);
await assert(has('送ったもの'), '送信後に「送ったもの」へ移る');
await shot('05-after-send');

// --- 4. 母: まとめて届く / 一括承認
await click('お母さん');
await assert(has('まだ見ていないもの'), '母のホーム見出し');
await assert(has('さんから'), '「◯◯さんから ◯件」の形式');
await assert(!(await has('お願い')), '母の画面に「お願い」の語がない');
await assert(!(await has('支給')), '母の画面に「支給」の語がない');
const motherHome = await text();
await assert(Promise.resolve(!/合計/.test(motherHome)), '母ホームに合計がない');
await shot('06-mother-home');
// 個別: 1件だけ一部を渡す(残りは後日)
await act('[data-action="open"][data-id="i-lab2"]');
await click('一部を渡す');
await type('input[name="decisionAmount"]', '400');
await click('後日渡す');
await click('返事する');
await sleep(300);
await assert(has('受け渡し待ち'), '一部を渡す→受け渡し待ち');
await assert(has('(残り)'), '残りは後日→後続の項目が作られる');
await shot('07-mother-partial');
// 一括: 残りをまとめて承認
for (let i = 0; i < 5; i++) {
  const n = await evalJs(`document.querySelectorAll('[data-action="approve-batch"]').length`);
  if (!n) break;
  await act('[data-action="approve-batch"]');
  await sleep(200);
}
await assert(evalJs(`document.querySelectorAll('[data-action="approve-batch"]').length === 0`), '一括承認ですべての未確認分がなくなる');
await assert(has('新しく届いたものはありません'), '母ホームの空状態');
await shot('08-mother-bulk');

// --- 5. 受け渡し → 完了
await act('[data-action="tick"][data-id="i-book"][data-who="mother"]');
await click('ゆうき');
await assert(has('確認待ち'), '学生側が確認待ちになる');
await act('[data-action="open"][data-id="i-book"]');
await click('受け取った');
await sleep(250);
await assert(has('完了'), '両方チェックで完了');
await shot('09-done');

// --- 6. 自腹記録は学生専用
await act('[data-action="back"]');
await click('自分で払った');
await sleep(200);
await tab('history');
await click('自分で払った');
await assert(has('自分で払った分'), '学生の履歴に自腹の小計');
await shot('10-selfpaid');
await click('お母さん');
await tab('history');
const mh = await text();
await assert(Promise.resolve(!/自分で払った/.test(mh)), '母の履歴に自腹記録が出ない');
await assert(Promise.resolve(!/参考書/.test(mh)), '母の履歴に自腹項目(参考書)が出ない');
await shot('11-mother-history');

// --- 7. 見送りフィルタ削除 / 合計トグル
await assert(Promise.resolve(!/見送り<\/button>/.test(await evalJs('document.getElementById("app").innerHTML'))), '履歴に「見送り」絞り込みがない');
await tab('settings');
await click('履歴に月の合計を表示');
await click('ダーク');
await tab('history');
await assert(has('この月の受け渡し合計'), '設定ONで履歴に合計');
await shot('12-history-dark');
await tab('home');
await assert(!(await has('合計')), '母ホームには合計が出ない');
await shot('13-mother-home-dark');

// --- 8. レイアウト・禁止語
await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(300);
await assert(evalJs('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'デスクトップで横スクロールなし');
await shot('14-desktop');

const src = await evalJs('document.documentElement.outerHTML');
for (const w of ['却下', '未払い', '未処理', '期限', '催促', '拒否', 'お願い', '支給', '依頼', '請求', '申請', '下書き', '未送信', '一時保存', 'たまって']) {
  await assert(Promise.resolve(!src.includes(w)), `禁止語なし: ${w}`);
}
// 「まだ」は相手の行動を指す用法のみ禁止。自分の状態を述べる「まだ見ていないもの」は可。
const visible = src.replace(/<script[\s\S]*?<\/script>/g, '');
const mada = [...visible.matchAll(/.{0,6}まだ.{0,10}/g)].map((m) => m[0]);
await assert(Promise.resolve(mada.every((s) => s.includes('まだ見ていないもの'))), `「まだ」は自分の状態のみ: ${JSON.stringify(mada)}`);
await assert(Promise.resolve(errors.length === 0), 'JS例外なし ' + errors.join(' | '));

ws.close(); edge.kill();
console.log(process.exitCode ? 'FAILED' : 'ALL PASSED');
process.exit(process.exitCode ?? 0);
