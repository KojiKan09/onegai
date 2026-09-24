// 実データ版の通し検証。2つのブラウザで紐づけ、片方の操作がもう片方に反映されることを見る。
// 先に `npx wrangler dev --port 8788 --local` を動かしておく。
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const out = resolve(process.argv[2] ?? './shots-live');
rmSync(out, { recursive: true, force: true });   // 端末を毎回まっさらにする
mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('ok  :', m); } else { fails.push(m); console.error('FAIL:', m); } };

// 1つのブラウザ(=1人の端末)を表す
async function openDevice(port, profile) {
  const proc = spawn(EDGE, [
    '--headless=new', '--remote-debugging-port=' + port,
    '--user-data-dir=' + out + '\\' + profile,
    '--no-first-run', '--window-size=390,844',
    'about:blank',
  ], { stdio: 'ignore' });

  let list;
  for (let i = 0; i < 60; i++) {
    try { list = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); if (list.length) break; } catch {}
    await sleep(250);
  }
  const pages = (list || []).filter((t) => t.type === 'page');
  const target = pages.find((t) => t.url === 'about:blank') || pages[0];
  if (!target) throw new Error('ブラウザを起動できませんでした @' + profile);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

  const dev = {
    proc, ws, send,
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails));
      return r.result.result.value;
    },
    async goto(url) { await send('Page.navigate', { url }); await sleep(1600); },
    text() { return dev.eval('document.getElementById("app").innerText'); },
    async has(s) { return (await dev.text()).includes(s); },
    async click(label, nth = 0) {
      const found = await dev.eval(`(() => { const bs=[...document.querySelectorAll('button')].filter(b=>!b.disabled && b.innerText.trim().startsWith(${JSON.stringify(label)})); const b=bs[${nth}]; if(!b) return false; b.click(); return true; })()`);
      if (!found) throw new Error('button not found: ' + label + ' @' + profile);
      await sleep(400);
    },
    async act(sel) {
      const found = await dev.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.click(); return true;})()`);
      if (!found) throw new Error('no element: ' + sel + ' @' + profile);
      await sleep(400);
    },
    async type(sel, v) {
      await dev.eval(`(() => { const el=document.querySelector(${JSON.stringify(sel)}); const p= el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p,'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
      await sleep(150);
    },
    async shot(name) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(out + '/' + name + '.png', Buffer.from(r.result.data, 'base64'));
      console.log('shot', name);
    },
    close() { ws.close(); proc.kill(); },
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  return dev;
}

const student = await openDevice(9401, 'student');
const mother = await openDevice(9402, 'mother');

try {
  // --- 受け取る側: 世帯を作る ---
  await student.goto(BASE + '/');
  ok(await student.has('はじめる'), '最初にペアリングの画面が出る');
  await student.shot('01-start');
  await student.click('はじめる');
  await student.type('input[name="pairStudent"]', 'ゆうき');
  await student.type('input[name="pairMother"]', 'お母さん');
  await student.click('コードを出す');
  await sleep(600);
  const code = (await student.eval('document.querySelector(".code") && document.querySelector(".code").innerText') || '').trim();
  ok(/^[A-Z2-9]{6}$/.test(code), 'コードが表示される: ' + code);
  ok(await student.has('ホーム画面に追加しないと通知が届きません'), '通知の落とし穴が手順に書いてある');
  ok(await student.has('お母さんの端末'), '呼び名に敬称が二重に付かない');
  await student.shot('02-code');

  // --- 渡す側: コードでつながる ---
  await mother.goto(BASE + '/');
  await mother.click('コードでつながる');
  await mother.type('input[name="pairCode"]', code);
  await mother.click('つながる');
  await sleep(900);
  ok(await mother.has('設定'), 'つながると設定画面へ進む');
  ok(!(await mother.has('はじめる')), 'ペアリング画面は出なくなる');
  await mother.shot('03-mother-settings');

  // --- 受け取る側: メモを作る ---
  await student.click('つながったか確かめる');
  await sleep(500);
  ok(await student.has('メモ'), '受け取る側のホームに出る');
  ok(await student.has('通知が届かない状態です'), '相手に通知が届かないことが常時見えている');
  await student.shot('04-student-home');

  let first = true;
  for (const [amount, title] of [['4500', '食費(今週分)'], ['1980', '日用品'], ['890', 'プリンター用紙']]) {
    await student.click('メモしておく');
    await student.type('input[name="amount"]', amount);
    await student.type('input[name="title"]', title);
    if (first) { await student.shot('04b-add'); first = false; }
    await student.click('メモしておく');
    await sleep(400);
  }
  ok(await student.has('メモ 3件'), 'メモが3件たまる');

  // --- 渡す側にはメモが見えない ---
  await mother.act('[data-action="tab"][data-tab="home"]');
  await sleep(400);
  const mTextBefore = await mother.text();
  ok(!/食費|日用品|プリンター/.test(mTextBefore), '送る前のメモは渡す側に一切見えない');
  ok(await mother.has('新しく届いたものはありません'), '渡す側の空の状態');
  await mother.shot('05-mother-empty');

  // --- まとめ送信 ---
  // 画面の並び順に依らないよう、実際のカードから送る2件と残す1件を取り出す
  const memos = await student.eval(`[...document.querySelectorAll('[data-action="select"]')].map(e => ({ id: e.dataset.id, title: e.querySelector('.item-title').innerText.trim() }))`);
  const sendThese = memos.slice(0, 2);
  const keptTitle = memos[2].title;
  for (const m of sendThese) await student.act('[data-action="select"][data-id="' + m.id + '"]');
  ok(await student.has('2件を送る'), '選んだ件数が出る');
  const beforeSend = await student.text();
  ok(!/合計/.test(beforeSend) && !/6,480/.test(beforeSend), '送信前に合計金額を出さない');
  await student.shot('06-selected');
  await student.click('2件を送る');
  await student.act('[data-action="sheet-confirm"]');
  await sleep(900);
  ok(await student.has('送ったもの'), '送信後に「送ったもの」へ移る');

  // --- 渡す側に束で届く ---
  await mother.goto(BASE + '/');
  ok(await mother.has('ゆうきさんから'), '「◯◯さんから」の形で届く');
  ok(!(await mother.has('さんさん')), '敬称が二重にならない');
  ok(await mother.has('2件'), '件数が出る');
  const mText = await mother.text();
  ok(!/合計/.test(mText), '渡す側の画面に合計がない');
  ok(!mText.includes(keptTitle), '送っていないメモ(' + keptTitle + ')は渡す側に出ない');
  for (const m of sendThese) ok(mText.includes(m.title), '送った品目が渡す側に出る: ' + m.title);
  await mother.shot('07-mother-batch');

  // --- 一括承認 ---
  await mother.click('全部そのまま渡す');
  await sleep(800);
  ok(await mother.has('受け渡し待ち'), '一括承認で受け渡し待ちになる');
  await mother.shot('08-mother-approved');

  // --- 渡す側がチェック → 受け取る側に反映 ---
  await mother.act('[data-action="tick"]');
  await sleep(800);
  await student.goto(BASE + '/');
  ok(await student.has('確認待ち'), '相手のチェックが自分の画面に届く');
  await student.shot('09-student-onechecked');

  // --- 受け取る側がチェック → 完了 ---
  await student.act('[data-action="tick"]');
  await sleep(800);
  ok(await student.has('完了'), '両方のチェックで完了になる');
  await student.shot('10-student-done');
  await mother.goto(BASE + '/');
  ok(await mother.has('完了'), '完了が相手にも見える');

  // --- 自腹記録は相手に出ない ---
  await student.act('[data-action="self-paid"]');
  await sleep(800);
  await student.act('[data-action="tab"][data-tab="history"]');
  await student.click('自分で払った');
  ok(await student.has('自分で払った分'), '受け取る側の履歴に自腹の小計が出る');
  await student.shot('11-student-selfpaid');
  await mother.act('[data-action="tab"][data-tab="history"]');
  await sleep(400);
  const mHist = await mother.text();
  ok(!/自分で払った/.test(mHist), '渡す側の履歴に自腹の絞り込みがない');
  ok(!mHist.includes(keptTitle), '自腹にした項目(' + keptTitle + ')は渡す側の履歴に出ない');
  await mother.shot('12-mother-history');

  // --- 通知が確かめられていないことが両者に見える ---
  await mother.act('[data-action="tab"][data-tab="settings"]');
  await sleep(400);
  ok(await mother.has('通知'), '渡す側の設定に通知の項目がある');
  await mother.shot('13-mother-push-setup');

  // --- 禁止語 ---
  const html = await student.eval('document.documentElement.outerHTML');
  for (const w of ['却下', '未払い', '未処理', '期限', '催促', '拒否', 'お願い', '支給', '依頼', '請求', '申請', '下書き', '未送信']) {
    ok(!html.includes(w), '禁止語なし: ' + w);
  }
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, '');
  const mada = [...visible.matchAll(/.{0,6}まだ.{0,10}/g)].map((m) => m[0]);
  ok(mada.every((s) => s.includes('まだ見ていないもの') || s.includes('まだつながっていません')),
    '「まだ」は自分の状態を述べる用法だけ: ' + JSON.stringify(mada));

  // --- 横幅 ---
  await student.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  ok(await student.eval('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'デスクトップで横スクロールしない');
  await student.shot('14-desktop');
} finally {
  student.close();
  mother.close();
}

console.log('');
if (fails.length) { console.error(fails.length + ' FAILED'); process.exit(1); }
console.log(pass + ' checks passed');
