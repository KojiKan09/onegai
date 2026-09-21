// 費用メモ — 画面。規則は logic.js にあり、ここでは持たない。
// サーバーがあれば実データで動き、なければ(GitHub Pages など)お試しモードで動く。
import {
  STATUS, statusOf, handAmount, doneAt, titleOf, monthKeyOf, visibleTo,
  apply, ensureMonthly, emptyDoc, blankItem, daysBetween, withSan, Err,
} from './logic.js';

// ---------- 小道具 ----------
const TOKEN_KEY = 'onegai:token';
const DEMO_KEY = 'onegai:demo';
const PREF_KEY = 'onegai:pref';

const now = () => new Date();
const nowIso = () => now().toISOString();
const uid = () => Math.random().toString(36).slice(2, 10);
const fmtDate = (iso) => { const d = new Date(iso); return (d.getMonth() + 1) + '/' + d.getDate(); };
const fmtYen = (n) => '¥' + Number(n || 0).toLocaleString('ja-JP');
const monthLabel = (d) => d.getFullYear() + '年' + (d.getMonth() + 1) + '月';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel) => document.querySelector(sel);

const ICON = {
  back: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  plus: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  chevL: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  chevR: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
};

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// ---------- 通信 ----------
let token = null;
try { token = localStorage.getItem(TOKEN_KEY); } catch {}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Err(data.error || '通信できませんでした');
  return data;
}

// ---------- お試しモード ----------
// サーバーが無いときだけ動く。規則は logic.js を共有するので本番と同じ動きになる。
const demo = {
  active: false,
  load() {
    try {
      const raw = localStorage.getItem(DEMO_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return demo.seed();
  },
  save(d) { try { localStorage.setItem(DEMO_KEY, JSON.stringify(d)); } catch {} },
  seed() {
    const doc = emptyDoc({ student: 'ゆうき', mother: 'お母さん' });
    doc.settings.monthly = { enabled: true, amount: 50000, day: 1 };
    const ago = (n, h) => { const d = new Date(); d.setHours(h, 0, 0, 0); d.setDate(d.getDate() - n); return d.toISOString(); };
    const add = (o) => { const it = blankItem('d-' + uid(), o.createdAt); Object.assign(it, o); doc.items.push(it); return it; };
    add({ title: '食費(今週分)', amount: 4500, createdAt: ago(0, 18) });
    add({ title: '日用品(洗剤・シャンプー)', amount: 1980, createdAt: ago(1, 19) });
    add({ title: 'プリンター用紙', amount: 890, createdAt: ago(2, 13) });
    add({ title: '参考書', amount: 3200, createdAt: ago(5, 15), selfPaid: true, selfPaidAt: ago(5, 15) });
    add({ title: '教科書(統計学)', amount: 6800, note: '後期の必修で使います', createdAt: ago(2, 11), sentAt: ago(1, 20), batchId: 'b1' });
    add({ title: '定期券(10月分)', amount: 12400, createdAt: ago(2, 12), sentAt: ago(1, 20), batchId: 'b1' });
    add({ title: '実験ノート', amount: 640, createdAt: ago(1, 9), sentAt: ago(1, 20), batchId: 'b1' });
    add({ title: '学費関連(実習費)', amount: 15000, note: '来週までに事務室へ', createdAt: ago(5, 10), sentAt: ago(4, 21), batchId: 'b0',
      decision: 'partial', approvedAmount: 10000, remainder: 'later', decidedAt: ago(4, 22), motherNote: '残りは来月に' });
    add({ title: '教科書(線形代数)', amount: 4200, createdAt: ago(5, 10), sentAt: ago(4, 21), batchId: 'b0',
      decision: 'full', decidedAt: ago(4, 22), motherTickedAt: ago(3, 8) });
    demo.save(doc);
    return doc;
  },
  view(role) {
    const doc = demo.load();
    if (ensureMonthly(doc, { role, now: nowIso(), uid })) demo.save(doc);
    return {
      role, names: doc.names, settings: doc.settings,
      items: visibleTo(doc.items, role),
      push: { subscribed: false, verified: false, publicKey: null },
      partner: { joined: true, pushSubscribed: false, pushVerified: false },
      demo: true,
    };
  },
  act(role, action) {
    const doc = demo.load();
    apply(doc, action, { role, now: nowIso(), uid });
    demo.save(doc);
    return demo.view(role);
  },
};

// ---------- 画面の状態 ----------
const pref = (() => {
  try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; }
})();
const savePref = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(pref)); } catch {} };

let view = null;                 // サーバー(またはお試し)から来た表示用データ
let screen = { name: 'home' };
let selected = {};
let draft = { amount: '', title: '', note: '', showNote: false };
let decision = { choice: null, amount: '', note: '', remainder: 'self' };
let hist = { month: monthKeyOf(nowIso()), filter: 'all' };
let pairing = { mode: null, code: '', expiresAt: '', studentName: '', motherName: '', input: '', error: '', busy: false };
let sheet = null;
let toastTimer = null;

const role = () => (view ? view.role : 'student');
const names = () => (view ? view.names : { student: '', mother: '' });
const nameOf = (who) => (names()[who] || (who === 'mother' ? '渡す側' : '受け取る側'));
const items = () => (view ? view.items : []);
const byId = (id) => items().find((it) => it.id === id);
const newest = (a, b) => (a.createdAt < b.createdAt ? 1 : -1);
const selectedIds = () => Object.keys(selected).filter((k) => selected[k] && byId(k) && statusOf(byId(k)) === 'memo');

async function act(action) {
  try {
    view = demo.active ? demo.act(role(), action) : await api('/act', { method: 'POST', body: action });
    return true;
  } catch (e) {
    toast(e.message || '操作できませんでした');
    return false;
  }
}

// ---------- 部品 ----------
const pill = (it) => { const s = STATUS[statusOf(it)]; return '<span class="pill ' + s.cls + '">' + s.label + '</span>'; };
const tagMonthly = (it) => (it.monthly ? '<span class="tag">毎月</span>' : '');
const section = (title, body) => '<section class="section"><h2 class="section-title">' + title + '</h2>' + body + '</section>';
const empty = (t) => '<div class="empty">' + t + '</div>';

function amountText(it) {
  if (it.decision === 'partial') {
    return '<span class="amount">' + fmtYen(it.approvedAmount) + '</span> <span class="muted sm">/ 申し出 ' + fmtYen(it.amount) + '</span>';
  }
  return '<span class="amount">' + fmtYen(it.amount) + '</span>';
}

function itemCard(it, { inlineCheck = false } = {}) {
  const st = statusOf(it);
  const rest = ['declined', 'cancelled', 'self_paid'].includes(st) ? ' is-rest' : '';
  const noteLine = role() === 'mother' && it.studentNote && st === 'done'
    ? '<div class="note-box"><div class="who">受け取り後のひとこと</div>' + esc(it.studentNote) + '</div>' : '';
  const doneLine = st === 'done' ? '<div class="muted sm">' + fmtDate(doneAt(it)) + ' 受け渡し完了</div>' : '';
  return '<div class="card' + rest + '">'
    + '<button class="card-btn" data-action="open" data-id="' + it.id + '">'
    + '<div class="row"><div class="grow item-title">' + esc(titleOf(it)) + tagMonthly(it) + '</div>' + pill(it) + '</div>'
    + '<div class="item-amount">' + amountText(it) + '</div>' + doneLine
    + '</button>' + noteLine + (inlineCheck ? checkRow(it, role(), { compact: true }) : '') + '</div>';
}

function memoCard(it) {
  const on = !!selected[it.id];
  return '<div class="card' + (on ? ' is-selected' : '') + '">'
    + '<button class="selectrow" role="checkbox" aria-checked="' + on + '" data-action="select" data-id="' + it.id + '">'
    + '<span class="box">' + ICON.check + '</span>'
    + '<span class="grow"><span class="item-title">' + esc(titleOf(it)) + '</span>'
    + '<span class="memo-amount amount" style="display:block">' + fmtYen(it.amount) + '</span></span>'
    + '<span class="muted xs">' + fmtDate(it.createdAt) + '</span>'
    + '</button>'
    + '<div class="memo-actions">'
    + '<button class="btn btn-text" data-action="open" data-id="' + it.id + '">開く</button>'
    + '<button class="btn btn-text" data-action="self-paid" data-id="' + it.id + '">自分で払った</button>'
    + '</div></div>';
}

function checkRow(it, who, { compact = false } = {}) {
  const isMother = who === 'mother';
  const tickedAt = isMother ? it.motherTickedAt : it.studentTickedAt;
  const otherTicked = isMother ? it.studentTickedAt : it.motherTickedAt;
  const mine = who === role();
  const st = statusOf(it);
  const canAct = mine && (st === 'handover' || st === 'one_ticked') && !(tickedAt && otherTicked);
  const label = isMother ? '渡した' : '受け取った';
  return '<button class="checkrow' + (mine ? ' is-mine' : '') + '" role="checkbox" aria-checked="' + (tickedAt ? 'true' : 'false') + '"'
    + (canAct ? '' : ' disabled') + ' data-action="tick" data-id="' + it.id + '" data-who="' + who + '">'
    + '<span class="box">' + ICON.check + '</span>'
    + '<span class="lbl">' + label + (compact ? '' : ' <span class="who">(' + esc(nameOf(who)) + ')</span>') + '</span>'
    + (tickedAt ? '<span class="who">' + fmtDate(tickedAt) + '</span>' : '')
    + '</button>';
}

function amountInput(name, value, { big = false, label = '金額(円)', autofocus = false } = {}) {
  return '<div class="amount-input"><span class="yen" aria-hidden="true">¥</span>'
    + '<input class="input" type="text" inputmode="numeric" autocomplete="off" name="' + name + '"'
    + ' value="' + esc(value) + '" placeholder="0" aria-label="' + label + '"'
    + (autofocus ? ' autofocus' : '')
    + (big ? ' style="font-size:var(--fs-amount);min-height:60px"' : '') + '>'
    + '</div>';
}

function topbar({ title, back = false }) {
  return '<header class="topbar">'
    + (back ? '<button class="btn-icon" data-action="back" aria-label="戻る">' + ICON.back + '</button>' : '<span class="spacer"></span>')
    + '<h1 class="title">' + esc(title) + '</h1>'
    + (demo.active ? demoSwitch() : '<span class="spacer"></span>')
    + '</header>';
}

function demoSwitch() {
  return '<div class="seg" role="group" aria-label="お試しの視点切り替え">'
    + '<button data-action="demo-role" data-role="student" aria-pressed="' + (role() === 'student') + '">' + esc(nameOf('student')) + '</button>'
    + '<button data-action="demo-role" data-role="mother" aria-pressed="' + (role() === 'mother') + '">' + esc(nameOf('mother')) + '</button>'
    + '</div>';
}

function tabs(current) {
  const t = [['home', 'ホーム'], ['history', '履歴'], ['settings', '設定']];
  return '<nav class="tabs" aria-label="主要ナビゲーション">'
    + t.map(([k, l]) => '<button data-action="tab" data-tab="' + k + '"' + (current === k ? ' aria-current="page"' : '') + '>' + l + '</button>').join('')
    + '</nav>';
}

function reminderCard(it) {
  const isMother = role() === 'mother';
  const amt = fmtYen(handAmount(it));
  const text = isMother
    ? esc(titleOf(it)) + ' ' + amt + ':渡し済みなら「渡した」をどうぞ'
    : esc(titleOf(it)) + ' ' + amt + ':受け取っていれば「受け取った」をどうぞ';
  return '<div class="reminder fade-in" role="note"><p>' + text + '</p><div class="actions">'
    + '<button class="btn btn-secondary" data-action="tick" data-id="' + it.id + '" data-who="' + role() + '">' + (isMother ? '渡した' : '受け取った') + '</button>'
    + '<button class="btn btn-text" data-action="dismiss" data-id="' + it.id + '">あとで</button>'
    + '</div></div>';
}

function localReminder() {
  return items().filter((it) => statusOf(it) === 'one_ticked').filter((it) => {
    const mine = role() === 'mother' ? it.motherTickedAt : it.studentTickedAt;
    const other = role() === 'mother' ? it.studentTickedAt : it.motherTickedAt;
    return !mine && other && daysBetween(other, nowIso()) >= 2 && !it.reminderDismissed[role()];
  }).sort(newest)[0] || null;
}

// 通知が届かない状態を、送る側に常時見せる。これがないと「送ったつもり」が起きる。
function pushWarning() {
  if (demo.active || !view) return '';
  const p = view.partner;
  if (role() === 'student' && p.joined && !p.pushVerified) {
    return '<div class="notice">' + esc(withSan(nameOf('mother'))) + 'に通知が届かない状態です。'
      + '<button class="btn btn-text" data-action="tab" data-tab="settings" style="padding:0 4px">設定</button>から直せます。</div>';
  }
  if (!view.push.verified && view.push.publicKey) {
    return '<div class="notice">この端末は通知を受け取れません。'
      + '<button class="btn btn-text" data-action="tab" data-tab="settings" style="padding:0 4px">設定</button>で確かめられます。</div>';
  }
  return '';
}

// ---------- 画面 ----------
function screenHome() {
  const list = items().slice().sort(newest);
  const rem = localReminder();
  const monthly = list.filter((it) => it.monthly && ['handover', 'one_ticked'].includes(statusOf(it)));
  const recentDone = list.filter((it) => statusOf(it) === 'done' && daysBetween(doneAt(it), nowIso()) <= 3).slice(0, 3);

  if (role() === 'student') {
    const memos = list.filter((it) => statusOf(it) === 'memo');
    const sent = list.filter((it) => !it.monthly && ['requested', 'handover', 'one_ticked'].includes(statusOf(it)));
    const sel = selectedIds();
    const memoTitle = memos.length ? 'メモ <span class="muted">' + memos.length + '件</span>' : 'メモ';
    const body = [
      monthly.length ? section('毎月', monthly.map((it) => itemCard(it, { inlineCheck: true })).join('')) : '',
      section(memoTitle, memos.length ? memos.map(memoCard).join('') : empty('メモはありません。買ったものを書き留めておけます')),
      sent.length ? section('送ったもの', sent.map((it) => itemCard(it, { inlineCheck: ['handover', 'one_ticked'].includes(statusOf(it)) })).join('')) : '',
      recentDone.length ? section('最近の完了', recentDone.map((it) => itemCard(it)).join('')) : '',
    ].join('');
    const bar = sel.length
      ? '<div class="sendbar"><button class="btn btn-primary btn-block" data-action="send">' + sel.length + '件を送る</button>'
        + '<button class="btn btn-text btn-block" data-action="clear-select">選択を解除</button></div>'
      : '<div class="sendbar"><button class="btn btn-primary btn-block" data-action="go-add">' + ICON.plus + 'メモしておく</button></div>';
    return topbar({ title: '費用メモ' })
      + '<main class="main">' + pushWarning() + (rem ? reminderCard(rem) : '') + body + '</main>'
      + bar + tabs('home');
  }

  // 渡す側: 見出しに名詞を置かず、件数と品目で見せる
  const requested = list.filter((it) => statusOf(it) === 'requested');
  const batches = [];
  for (const it of requested) {
    let b = batches.find((x) => x.id === it.batchId);
    if (!b) { b = { id: it.batchId, items: [], at: it.sentAt }; batches.push(b); }
    b.items.push(it);
    if (it.sentAt > b.at) b.at = it.sentAt;
  }
  const handover = list.filter((it) => !it.monthly && ['handover', 'one_ticked'].includes(statusOf(it)));
  const batchHtml = batches.map((b) => '<div class="batch">'
    + '<div class="batch-head"><span class="from">' + esc(withSan(nameOf('student'))) + 'から</span>'
    + '<span class="count">' + b.items.length + '件 ・ ' + fmtDate(b.at) + '</span></div>'
    + b.items.map((it) => '<button class="batch-line" data-action="open" data-id="' + it.id + '">'
      + '<span class="grow">' + esc(titleOf(it)) + '</span><span class="amount">' + fmtYen(it.amount) + '</span></button>').join('')
    + '<div class="batch-foot">'
    + '<button class="btn btn-primary btn-block" data-action="approve-batch" data-batch="' + b.id + '">全部そのまま渡す</button>'
    + '<p class="muted xs">1件ずつ決めたいときは、品目を選んでください。</p>'
    + '</div></div>').join('');

  const body = [
    monthly.length ? section('毎月', monthly.map((it) => itemCard(it, { inlineCheck: true })).join('')) : '',
    section('まだ見ていないもの', batches.length ? '<div class="stack">' + batchHtml + '</div>' : empty('新しく届いたものはありません')),
    handover.length ? section('受け渡し待ち', handover.map((it) => itemCard(it, { inlineCheck: true })).join('')) : '',
    recentDone.length ? section('最近の完了', recentDone.map((it) => itemCard(it)).join('')) : '',
  ].join('');
  return topbar({ title: 'ホーム' })
    + '<main class="main">' + pushWarning() + (rem ? reminderCard(rem) : '') + body + '</main>'
    + tabs('home');
}

function screenAdd() {
  const chips = ['食費', '日用品', '教科書', '定期券', '学費関連', '交通費'];
  return topbar({ title: 'メモ', back: true })
    + '<main class="main">'
    + '<div class="field"><label for="f-amount">いくら</label>'
    + amountInput('amount', draft.amount, { big: true, autofocus: true })
    + '<div class="hint" id="amount-hint"></div></div>'
    + '<div class="field"><label for="f-title">なに(任意)</label>'
    + '<div class="chips">' + chips.map((c) => '<button class="chip" data-action="chip" data-chip="' + c + '" aria-pressed="' + (draft.title === c) + '">' + c + '</button>').join('') + '</div>'
    + '<input class="input" id="f-title" name="title" type="text" value="' + esc(draft.title) + '" placeholder="例:教科書(統計学)" autocomplete="off"></div>'
    + (draft.showNote
      ? '<div class="field"><label for="f-note">補足(任意)</label><textarea class="input" id="f-note" name="note" placeholder="例:後期の必修で使います">' + esc(draft.note) + '</textarea></div>'
      : '<button class="btn btn-text" data-action="show-note" style="align-self:flex-start">補足を追加</button>')
    + '<div class="stack"><button class="btn btn-primary btn-block" data-action="submit-memo">メモしておく</button>'
    + '<button class="btn btn-text btn-block" data-action="back">やめる</button></div>'
    + '<p class="muted xs">メモの間は相手に通知されません。あとでまとめて送れます。</p>'
    + '</main>';
}

function decisionSummary(it) {
  if (it.decision === 'full') return fmtYen(it.amount) + ' を渡す予定です';
  if (it.decision === 'partial') {
    return fmtYen(it.approvedAmount) + ' を渡す予定です(' + (it.remainder === 'later' ? '残りは後日渡す' : '残りは自分で') + ')';
  }
  if (it.decision === 'declined') return '今回は見送りです';
  return '';
}

function screenDetail(id) {
  const it = byId(id);
  if (!it) return screenHome();
  const st = statusOf(it);
  const rest = ['declined', 'cancelled', 'self_paid'].includes(st) ? ' is-rest' : '';

  const steps = ['<div class="step"><span class="d">' + fmtDate(it.createdAt) + '</span><span>' + (it.monthly ? '毎月分として登録' : 'メモしました') + '</span></div>'];
  if (it.sentAt && !it.monthly) steps.push('<div class="step"><span class="d">' + fmtDate(it.sentAt) + '</span><span>送りました</span></div>');
  if (it.selfPaid) steps.push('<div class="step"><span class="d">' + fmtDate(it.selfPaidAt) + '</span><span>自分で払いました</span></div>');
  if (it.cancelled) steps.push('<div class="step"><span class="d"></span><span>やめました</span></div>');
  if (it.decidedAt && !it.monthly) steps.push('<div class="step"><span class="d">' + fmtDate(it.decidedAt) + '</span><span>返事:' + decisionSummary(it) + '</span></div>');
  if (st === 'done') steps.push('<div class="step"><span class="d">' + fmtDate(doneAt(it)) + '</span><span>受け渡し完了</span></div>');

  const notes = [
    it.note ? '<div class="note-box"><div class="who">補足</div>' + esc(it.note) + '</div>' : '',
    it.motherNote ? '<div class="note-box"><div class="who">' + esc(nameOf('mother')) + 'からのひとこと</div>' + esc(it.motherNote) + '</div>' : '',
    it.studentNote ? '<div class="note-box"><div class="who">受け取り後のひとこと</div>' + esc(it.studentNote) + '</div>' : '',
  ].join('');

  const handoverBlock = ['handover', 'one_ticked', 'done'].includes(st)
    ? section('受け渡し', '<div class="card">' + checkRow(it, 'mother') + checkRow(it, 'student')
      + (st === 'done' ? '<div class="muted sm">' + fmtDate(doneAt(it)) + ' 受け渡し完了</div>' : '') + '</div>')
    : '';

  const noteInput = role() === 'student' && it.studentTickedAt && !it.studentNote
    ? section('ひとこと(任意)', '<div class="card stack"><input class="input" name="studentNote" type="text" placeholder="空のままでもかまいません" autocomplete="off">'
      + '<button class="btn btn-secondary" data-action="send-student-note" data-id="' + it.id + '">送る</button></div>')
    : '';

  let panel = '';
  if (role() === 'mother' && st === 'requested') {
    const radio = (key, label) => '<button class="radio" role="radio" aria-checked="' + (decision.choice === key) + '" data-action="choose" data-choice="' + key + '"><span class="dot"></span><span>' + label + '</span></button>';
    const remRadio = (key, label) => '<button class="radio" role="radio" aria-checked="' + (decision.remainder === key) + '" data-action="remainder" data-rem="' + key + '"><span class="dot"></span><span>' + label + '</span></button>';
    panel = section('返事', '<div class="card panel" role="radiogroup" aria-label="返事の内容">'
      + radio('full', 'この金額で渡す')
      + radio('partial', '一部を渡す')
      + (decision.choice === 'partial'
        ? '<div class="field" style="padding-left:34px"><label>渡す金額</label>' + amountInput('decisionAmount', decision.amount || String(it.amount))
          + '<label style="margin-top:8px">残りは</label>' + remRadio('self', '自分で出してもらう') + remRadio('later', '後日渡す') + '</div>'
        : '')
      + radio('declined', '今回は見送る')
      + '<hr class="divider">'
      + '<div class="field"><label for="f-mnote">ひとこと(任意)</label><input class="input" id="f-mnote" name="decisionNote" type="text" value="' + esc(decision.note) + '" placeholder="例:残りは来月に" autocomplete="off"></div>'
      + '<button class="btn btn-primary btn-block" data-action="submit-decision" data-id="' + it.id + '"' + (decision.choice ? '' : ' disabled') + '>返事する</button>'
      + '<button class="btn btn-text btn-block" data-action="back">あとで</button>'
      + '</div>');
  }

  const memoActions = role() === 'student' && st === 'memo'
    ? section('このメモ', '<div class="card stack">'
      + '<button class="btn btn-secondary btn-block" data-action="send-one" data-id="' + it.id + '">これだけ送る</button>'
      + '<button class="btn btn-text btn-block" data-action="self-paid" data-id="' + it.id + '">自分で払った</button>'
      + '<button class="btn btn-text btn-block" data-action="ask-cancel" data-id="' + it.id + '">やめる</button></div>')
    : '';

  const undoSelf = role() === 'student' && st === 'self_paid'
    ? '<button class="btn btn-text btn-block" data-action="undo-self" data-id="' + it.id + '">メモに戻す</button>' : '';

  return topbar({ title: '', back: true })
    + '<main class="main">'
    + '<div class="detail-head' + rest + '">'
    + '<div class="row"><div class="grow item-title">' + esc(titleOf(it)) + tagMonthly(it) + '</div>' + pill(it) + '</div>'
    + '<div class="pair"><span class="amount big">' + fmtYen(it.decision === 'partial' ? it.approvedAmount : it.amount) + '</span>'
    + (it.decision === 'partial' ? '<span class="muted sm">申し出 ' + fmtYen(it.amount) + '</span>' : '') + '</div>'
    + '<div class="muted sm">' + fmtDate(it.createdAt) + '</div></div>'
    + notes + panel
    + ((!panel && it.decision && !it.monthly && st !== 'done') ? section('返事', '<div class="card"><div>' + decisionSummary(it) + '</div></div>') : '')
    + handoverBlock + noteInput + memoActions
    + section('経過', '<div class="timeline">' + steps.join('') + '</div>')
    + undoSelf
    + '</main>';
}

function screenHistory() {
  const [y, m] = hist.month.split('-').map(Number);
  const cur = new Date(y, m - 1, 1);
  const prev = new Date(y, m - 2, 1), next = new Date(y, m, 1);
  const isStudent = role() === 'student';
  const key = hist.month;

  let list = items().filter((it) => monthKeyOf(it.createdAt) === key && statusOf(it) !== 'memo');
  if (hist.filter === 'done') list = list.filter((it) => statusOf(it) === 'done');
  if (hist.filter === 'self') list = list.filter((it) => statusOf(it) === 'self_paid');
  list.sort(newest);

  const total = items().filter((it) => monthKeyOf(it.createdAt) === key && statusOf(it) === 'done')
    .reduce((s, it) => s + handAmount(it), 0);
  const selfTotal = items().filter((it) => monthKeyOf(it.createdAt) === key && statusOf(it) === 'self_paid')
    .reduce((s, it) => s + it.amount, 0);

  const groups = new Map();
  for (const it of list) { const k = fmtDate(it.createdAt); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
  const chips = isStudent ? [['all', 'すべて'], ['done', '完了'], ['self', '自分で払った']] : [['all', 'すべて'], ['done', '完了']];

  let summary = '';
  if (hist.filter === 'self' && isStudent) summary = '<div class="muted sm">自分で払った分 <span class="amount">' + fmtYen(selfTotal) + '</span></div>';
  else if (view && view.settings.showTotals) summary = '<div class="muted sm">この月の受け渡し合計 <span class="amount">' + fmtYen(total) + '</span></div>';

  const mk = (d) => d.getFullYear() + '-' + (d.getMonth() + 1);
  return topbar({ title: '履歴' })
    + '<main class="main">'
    + '<div class="monthnav">'
    + '<button class="btn-icon" data-action="hist-month" data-month="' + mk(prev) + '" aria-label="前の月">' + ICON.chevL + '</button>'
    + '<span class="lbl">' + monthLabel(cur) + '</span>'
    + '<button class="btn-icon" data-action="hist-month" data-month="' + mk(next) + '" aria-label="次の月">' + ICON.chevR + '</button>'
    + '</div>'
    + '<div class="chips">' + chips.map(([k, l]) => '<button class="chip" data-action="hist-filter" data-filter="' + k + '" aria-pressed="' + (hist.filter === k) + '">' + l + '</button>').join('') + '</div>'
    + summary
    + (groups.size ? [...groups].map(([d, l]) => '<div class="daygroup"><div class="daylabel">' + d + '</div>' + l.map((it) => itemCard(it)).join('') + '</div>').join('') : empty('この月の記録はありません'))
    + '</main>' + tabs('history');
}

function screenSettings() {
  const s = view.settings;
  const themes = [['system', 'システム'], ['light', 'ライト'], ['dark', 'ダーク']];
  const pushBlock = demo.active
    ? '<div class="card"><p class="sm muted">お試しモードでは通知は動きません。</p></div>'
    : pushCard();
  const connect = demo.active ? '' : section('つながり', '<div class="card stack">'
    + '<p class="sm">' + esc(withSan(nameOf('mother'))) + 'は' + (view.partner.joined ? 'つながっています。' : 'まだつながっていません。') + '</p>'
    + (role() === 'student' ? '<button class="btn btn-secondary btn-block" data-action="new-code">相手の端末をつなぐコードを出す</button>' : '')
    + '<button class="btn btn-text btn-block" data-action="unlink">この端末のつながりを解除する</button>'
    + '</div>');

  return topbar({ title: '設定' })
    + '<main class="main">'
    + section('呼び名', '<div class="card">'
      + '<div class="setting-row"><span>受け取る側</span><input class="input" name="nameStudent" type="text" value="' + esc(nameOf('student')) + '" aria-label="受け取る側の呼び名"></div>'
      + '<div class="setting-row"><span>渡す側</span><input class="input" name="nameMother" type="text" value="' + esc(nameOf('mother')) + '" aria-label="渡す側の呼び名"></div>'
      + '</div>')
    + section('通知', pushBlock)
    + connect
    + section('表示', '<div class="card">'
      + '<div class="setting-row"><span>テーマ</span><div class="seg" role="group" aria-label="テーマ">'
      + themes.map(([k, l]) => '<button data-action="theme" data-theme="' + k + '" aria-pressed="' + ((pref.theme || 'system') === k) + '">' + l + '</button>').join('')
      + '</div></div>'
      + '<button class="toggle" role="switch" aria-checked="' + s.showTotals + '" data-action="toggle-totals"><span>履歴に月の合計を表示</span><span class="sw"></span></button>'
      + '</div>')
    + section('毎月の生活費', '<div class="card">'
      + '<button class="toggle" role="switch" aria-checked="' + s.monthly.enabled + '" data-action="toggle-monthly"><span>毎月分を自動で登録する</span><span class="sw"></span></button>'
      + '<div class="setting-row"><span>金額</span><div class="amount-input" style="width:160px"><span class="yen" aria-hidden="true">¥</span>'
      + '<input class="input" type="text" inputmode="numeric" name="monthlyAmount" value="' + Number(s.monthly.amount).toLocaleString('ja-JP') + '" aria-label="毎月の金額" style="width:160px;padding-left:28px;text-align:right;min-height:40px"></div></div>'
      + '<div class="setting-row"><span>登録日</span><input class="input" type="number" min="1" max="28" name="monthlyDay" value="' + s.monthly.day + '" aria-label="登録日"></div>'
      + '<p class="muted sm">返事のやりとりはなく、「渡した」「受け取った」の確認だけです。</p></div>')
    + section('お知らせについて', '<div class="card stack">'
      + '<p class="sm">受け渡しの確認が片方だけの場合、2日後に一度だけお知らせします。</p>'
      + '<p class="sm">メモの件数は週に一度だけ、受け取る側にお知らせします。渡す側には送りません。</p></div>')
    + (demo.active ? '<button class="btn btn-text btn-block" data-action="reset-demo">お試しデータを初期化</button>' : '')
    + '</main>' + tabs('settings');
}

function pushCard() {
  const p = view.push;
  if (!p.publicKey) return '<div class="card"><p class="sm muted">通知はこのサーバーでは設定されていません。</p></div>';
  if (p.verified) {
    return '<div class="card stack"><p class="sm">この端末は通知を受け取れます。</p>'
      + '<button class="btn btn-text btn-block" data-action="push-test">もう一度テストする</button></div>';
  }
  if (isIOS() && !isStandalone()) {
    return '<div class="card stack">'
      + '<p class="sm">iPhone と iPad は、ホーム画面に追加してから開かないと通知を受け取れません。</p>'
      + '<div class="steps">'
      + '<div class="step-row"><span class="n">1</span><span class="body">画面の下(または上)にある共有ボタンを押す</span></div>'
      + '<div class="step-row"><span class="n">2</span><span class="body">「ホーム画面に追加」を選ぶ</span></div>'
      + '<div class="step-row"><span class="n">3</span><span class="body">ホーム画面にできたアイコンから開き直す</span></div>'
      + '</div></div>';
  }
  return '<div class="card stack">'
    + '<p class="sm">' + (p.subscribed ? '通知が実際に届くかを確かめます。' : 'この端末で通知を受け取れるようにします。') + '</p>'
    + '<button class="btn btn-primary btn-block" data-action="push-enable">' + (p.subscribed ? 'テスト通知を送る' : '通知を受け取る') + '</button>'
    + '</div>';
}

// ---------- ペアリング ----------
function screenPair() {
  if (pairing.mode === 'create') return pairCreate();
  if (pairing.mode === 'code') return pairShowCode();
  if (pairing.mode === 'join') return pairJoin();
  return pairStart();
}

function pairStart() {
  return '<header class="topbar"><span class="spacer"></span><h1 class="title">費用メモ</h1><span class="spacer"></span></header>'
    + '<main class="main bigpad">'
    + '<p class="onboard">言いそびれたものが埋もれないための、ふたりのメモです。</p>'
    + '<div class="stack">'
    + '<button class="btn btn-primary btn-block" data-action="pair-mode" data-mode="create">はじめる(受け取る側)</button>'
    + '<button class="btn btn-secondary btn-block" data-action="pair-mode" data-mode="join">コードでつながる</button>'
    + '</div>'
    + '<p class="muted sm">受け取る側の人が「はじめる」を押してコードを出し、渡す側の人がそのコードでつながります。</p>'
    + '<hr class="divider">'
    + '<button class="btn btn-text btn-block" data-action="try-demo">中身をお試しで見る</button>'
    + '</main>';
}

function pairCreate() {
  return '<header class="topbar"><button class="btn-icon" data-action="pair-mode" data-mode="" aria-label="戻る">' + ICON.back + '</button><h1 class="title">はじめる</h1><span class="spacer"></span></header>'
    + '<main class="main bigpad">'
    + '<div class="field"><label for="p-student">あなた(受け取る側)の呼び名</label>'
    + '<input class="input" id="p-student" name="pairStudent" type="text" value="' + esc(pairing.studentName) + '" placeholder="例:ゆうき" autocomplete="off"></div>'
    + '<div class="field"><label for="p-mother">相手(渡す側)の呼び名</label>'
    + '<input class="input" id="p-mother" name="pairMother" type="text" value="' + esc(pairing.motherName) + '" placeholder="例:お母さん" autocomplete="off"></div>'
    + '<div class="err">' + esc(pairing.error) + '</div>'
    + '<button class="btn btn-primary btn-block" data-action="pair-create"' + (pairing.busy ? ' disabled' : '') + '>コードを出す</button>'
    + '</main>';
}

function pairShowCode() {
  const mins = Math.max(0, Math.round((new Date(pairing.expiresAt) - Date.now()) / 60000));
  return topbar({ title: 'つなぐ', back: !!view })
    + '<main class="main bigpad">'
    + '<div class="pair">'
    + '<div class="code">' + esc(pairing.code) + '</div>'
    + '<p class="muted sm center">このコードは' + mins + '分で使えなくなります。1回だけ使えます。</p>'
    + '<div class="steps">'
    + '<div class="step-row"><span class="n">1</span><span class="body"><strong>' + esc(withSan(nameOf('mother'))) + 'の端末でこのページを開く</strong>同じ画面が出ます。</span></div>'
    + '<div class="step-row"><span class="n">2</span><span class="body"><strong>「コードでつながる」からこの6文字を入れる</strong>大文字と数字だけです。</span></div>'
    + '<div class="step-row"><span class="n">3</span><span class="body"><strong>その端末で通知の準備までやってしまう</strong>iPhone はホーム画面に追加しないと通知が届きません。あなたが代わりに操作してあげてください。</span></div>'
    + '<div class="step-row"><span class="n">4</span><span class="body"><strong>テスト通知が鳴るのを本人に見てもらう</strong>鳴るまでは、通知は届いていません。</span></div>'
    + '</div>'
    + '<button class="btn btn-secondary btn-block" data-action="pair-done">つながったか確かめる</button>'
    + '</div></main>';
}

function pairJoin() {
  return '<header class="topbar"><button class="btn-icon" data-action="pair-mode" data-mode="" aria-label="戻る">' + ICON.back + '</button><h1 class="title">コードでつながる</h1><span class="spacer"></span></header>'
    + '<main class="main bigpad">'
    + '<div class="field"><label for="p-code">6文字のコード</label>'
    + '<input class="input" id="p-code" name="pairCode" type="text" inputmode="latin" autocapitalize="characters" autocomplete="off"'
    + ' maxlength="6" value="' + esc(pairing.input) + '" style="font-size:2rem;text-align:center;letter-spacing:0.2em;min-height:64px"></div>'
    + '<div class="err">' + esc(pairing.error) + '</div>'
    + '<button class="btn btn-primary btn-block" data-action="pair-join"' + (pairing.busy ? ' disabled' : '') + '>つながる</button>'
    + '</main>';
}

// ---------- 描画 ----------
function applyTheme() {
  const t = pref.theme || 'system';
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

function render() {
  applyTheme();
  let html;
  if (!view) html = screenPair();
  else if (pairing.mode === 'code' || screen.name === 'code') html = pairShowCode();
  else if (screen.name === 'add') html = screenAdd();
  else if (screen.name === 'detail') html = screenDetail(screen.id);
  else if (screen.name === 'history') html = screenHistory();
  else if (screen.name === 'settings') html = screenSettings();
  else html = screenHome();
  $('#app').innerHTML = html;
  renderOverlay();
}

function renderOverlay() {
  const o = $('#overlay');
  if (!sheet) { o.innerHTML = ''; return; }
  o.innerHTML = '<div class="scrim" data-action="sheet-cancel">'
    + '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" data-stop>'
    + '<h2 id="sheet-title">' + esc(sheet.title) + '</h2>'
    + '<p class="sm muted">' + esc(sheet.body) + '</p>'
    + '<div class="actions">'
    + '<button class="btn btn-secondary btn-block" data-action="sheet-confirm">' + esc(sheet.confirmLabel) + '</button>'
    + '<button class="btn btn-text btn-block" data-action="sheet-cancel">戻る</button>'
    + '</div></div></div>';
  o.querySelector('[data-action="sheet-confirm"]').focus();
}

function toast(msg) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3000);
}

const go = (s) => { screen = s; window.scrollTo(0, 0); render(); };
const openSheet = (cfg) => { sheet = cfg; renderOverlay(); };
const closeSheet = () => { sheet = null; renderOverlay(); };
const parseAmount = (s) => Number(String(s || '').replace(/[^\d]/g, '')) || 0;
const formatAmountField = (i) => { const n = parseAmount(i.value); i.value = n ? n.toLocaleString('ja-JP') : ''; };

// ---------- 通知の設定 ----------
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    toast('この端末では通知を使えません');
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('通知が許可されませんでした'); return; }
    const key = view.push.publicKey;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
    await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
    view = await api('/state');
    render();
    await testPush();
  } catch (e) {
    toast(e.message || '通知の準備ができませんでした');
  }
}

async function testPush() {
  try {
    await api('/push/test', { method: 'POST' });
    toast('テスト通知を送りました。鳴るか見てください');
  } catch (e) {
    toast(e.message || 'テスト通知を送れませんでした');
  }
}

function urlBase64ToUint8Array(b64) {
  const p = b64.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(p + '==='.slice((p.length + 3) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// ---------- 操作 ----------
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if (e.target.closest('[data-stop]') && el.dataset.action === 'sheet-cancel' && !e.target.closest('button')) return;
  const a = el.dataset.action;
  const id = el.dataset.id;

  switch (a) {
    // --- ペアリング ---
    case 'pair-mode': pairing.mode = el.dataset.mode || null; pairing.error = ''; render(); break;
    case 'try-demo': demo.active = true; view = demo.view('student'); go({ name: 'home' }); break;
    case 'demo-role': view = demo.view(el.dataset.role); selected = {}; decision = { choice: null, amount: '', note: '', remainder: 'self' }; go({ name: 'home' }); break;
    case 'pair-create': {
      if (pairing.busy) return;
      pairing.busy = true; pairing.error = ''; render();
      try {
        const r = await api('/pair/create', { method: 'POST', body: { studentName: pairing.studentName, motherName: pairing.motherName } });
        token = r.token;
        try { localStorage.setItem(TOKEN_KEY, token); } catch {}
        pairing.code = r.code; pairing.expiresAt = r.expiresAt; pairing.mode = 'code';
        view = await api('/state');
      } catch (err) {
        pairing.error = err.message || 'うまくいきませんでした';
      }
      pairing.busy = false; render();
      break;
    }
    case 'pair-join': {
      if (pairing.busy) return;
      pairing.busy = true; pairing.error = ''; render();
      try {
        const r = await api('/pair/join', { method: 'POST', body: { code: pairing.input } });
        token = r.token;
        try { localStorage.setItem(TOKEN_KEY, token); } catch {}
        view = await api('/state');
        pairing.mode = null;
        go({ name: 'settings' });
        toast('つながりました。次に通知の準備をしましょう');
      } catch (err) {
        pairing.error = err.message || 'うまくいきませんでした';
      }
      pairing.busy = false;
      if (pairing.error) render();
      break;
    }
    case 'pair-done': {
      try { view = await api('/state'); } catch {}
      pairing.mode = null;
      if (view && view.partner.joined && !view.partner.pushVerified) toast('つながりました。通知はまだ届きません');
      go({ name: 'home' });
      break;
    }
    case 'new-code': {
      try {
        const r = await api('/pair/code', { method: 'POST', body: { role: 'mother' } });
        pairing.code = r.code; pairing.expiresAt = r.expiresAt; pairing.mode = 'code';
        go({ name: 'code' });
      } catch (err) { toast(err.message); }
      break;
    }
    case 'unlink': {
      openSheet({
        title: 'この端末のつながりを解除しますか?',
        body: '記録は残ります。つなぎ直すには新しいコードが必要です。',
        confirmLabel: '解除する',
        onConfirm: async () => {
          try { await api('/unlink', { method: 'POST' }); } catch {}
          token = null;
          try { localStorage.removeItem(TOKEN_KEY); } catch {}
          view = null; closeSheet(); render();
        },
      });
      break;
    }

    // --- 通知 ---
    case 'push-enable': view.push.subscribed ? await testPush() : await enablePush(); break;
    case 'push-test': await testPush(); break;

    // --- 画面 ---
    case 'tab': go({ name: el.dataset.tab }); break;
    case 'back': decision = { choice: null, amount: '', note: '', remainder: 'self' }; pairing.mode = null; go({ name: screen.from || 'home' }); break;
    case 'open': decision = { choice: null, amount: '', note: '', remainder: 'self' }; go({ name: 'detail', id, from: screen.name === 'history' ? 'history' : 'home' }); break;
    case 'go-add': {
      draft = { amount: '', title: '', note: '', showNote: false };
      go({ name: 'add', from: 'home' });
      const amt = $('input[name="amount"]');
      if (amt) amt.focus();
      break;
    }
    case 'chip': draft.title = draft.title === el.dataset.chip ? '' : el.dataset.chip; render(); break;
    case 'show-note': draft.showNote = true; render(); { const t = $('#f-note'); if (t) t.focus(); } break;

    // --- メモ ---
    case 'submit-memo': {
      const amt = parseAmount(draft.amount);
      if (!amt) { const h = $('#amount-hint'); if (h) h.textContent = '金額を入力してください'; const i = $('input[name="amount"]'); if (i) i.focus(); return; }
      if (await act({ type: 'addMemo', amount: amt, title: draft.title.trim(), note: draft.note.trim() })) {
        draft = { amount: '', title: '', note: '', showNote: false };
        toast('メモしました');
        go({ name: 'home' });
      }
      break;
    }
    case 'select': selected[id] = !selected[id]; render(); break;
    case 'clear-select': selected = {}; render(); break;
    case 'send': {
      const ids = selectedIds();
      openSheet({
        title: ids.length + '件を送りますか?',
        body: withSan(nameOf('mother')) + 'に1回だけお知らせが届きます。',
        confirmLabel: '送る',
        onConfirm: async () => { closeSheet(); if (await act({ type: 'send', ids })) { selected = {}; toast(ids.length + '件を送りました'); go({ name: 'home' }); } },
      });
      break;
    }
    case 'send-one': {
      openSheet({
        title: 'これだけ送りますか?',
        body: withSan(nameOf('mother')) + 'に1回だけお知らせが届きます。',
        confirmLabel: '送る',
        onConfirm: async () => { closeSheet(); if (await act({ type: 'send', ids: [id] })) { toast('送りました'); go({ name: 'home' }); } },
      });
      break;
    }
    case 'self-paid': if (await act({ type: 'selfPaid', id })) { delete selected[id]; toast('自分で払った分に移しました'); go({ name: 'home' }); } break;
    case 'undo-self': if (await act({ type: 'undoSelfPaid', id })) { toast('メモに戻しました'); go({ name: 'home' }); } break;
    case 'ask-cancel': {
      openSheet({
        title: 'このメモをやめますか?',
        body: '記録から外れます。相手には何も伝わりません。',
        confirmLabel: 'やめる',
        onConfirm: async () => { closeSheet(); if (await act({ type: 'cancel', id })) { toast('やめました'); go({ name: 'home' }); } },
      });
      break;
    }

    // --- 返事 ---
    case 'choose': decision.choice = el.dataset.choice; render();
      if (el.dataset.choice === 'partial') { const i = $('input[name="decisionAmount"]'); if (i) { i.focus(); i.select(); } }
      break;
    case 'remainder': decision.remainder = el.dataset.rem; render(); break;
    case 'submit-decision': {
      const it = byId(id);
      const payload = { type: 'decide', id, choice: decision.choice, note: decision.note.trim() };
      if (decision.choice === 'partial') {
        payload.amount = parseAmount(decision.amount) || (it ? it.amount : 0);
        payload.remainder = decision.remainder;
      }
      const finish = async () => {
        if (await act(payload)) {
          decision = { choice: null, amount: '', note: '', remainder: 'self' };
          toast(withSan(nameOf('student')) + 'に伝えました');
          go({ name: 'home' });
        }
      };
      if (decision.choice === 'declined') {
        openSheet({
          title: '今回は見送りますか?',
          body: withSan(nameOf('student')) + 'には「見送り」と表示されます。',
          confirmLabel: '見送る',
          onConfirm: async () => { closeSheet(); await finish(); },
        });
      } else await finish();
      break;
    }
    case 'approve-batch': if (await act({ type: 'approveBatch', batchId: el.dataset.batch })) { toast(withSan(nameOf('student')) + 'に伝えました'); render(); } break;

    // --- 受け渡し ---
    case 'tick': {
      const it = byId(id);
      const willComplete = it && (el.dataset.who === 'mother' ? it.studentTickedAt : it.motherTickedAt);
      if (await act({ type: 'tick', id, who: el.dataset.who })) { if (willComplete) toast('受け渡しが完了しました'); render(); }
      break;
    }
    case 'dismiss': if (await act({ type: 'dismissReminder', id })) render(); break;
    case 'send-student-note': {
      const i = $('input[name="studentNote"]');
      if (await act({ type: 'studentNote', id, note: i ? i.value : '' })) { toast('送りました'); render(); }
      break;
    }

    // --- 履歴・設定 ---
    case 'hist-month': hist.month = el.dataset.month; render(); break;
    case 'hist-filter': hist.filter = el.dataset.filter; render(); break;
    case 'theme': pref.theme = el.dataset.theme; savePref(); render(); break;
    case 'toggle-totals': if (await act({ type: 'settings', showTotals: !view.settings.showTotals })) render(); break;
    case 'toggle-monthly': if (await act({ type: 'settings', monthly: { enabled: !view.settings.monthly.enabled } })) render(); break;
    case 'reset-demo': try { localStorage.removeItem(DEMO_KEY); } catch {} view = demo.view(role()); toast('お試しデータを初期化しました'); go({ name: 'home' }); break;

    // --- シート ---
    case 'sheet-confirm': if (sheet && sheet.onConfirm) await sheet.onConfirm(); break;
    case 'sheet-cancel': closeSheet(); break;
  }
});

let saveTimer = null;
const debounceAct = (action) => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => act(action), 500);
};

document.addEventListener('input', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
  switch (t.name) {
    case 'title': draft.title = t.value; break;
    case 'note': draft.note = t.value; break;
    case 'amount': formatAmountField(t); draft.amount = t.value; { const h = $('#amount-hint'); if (h) h.textContent = ''; } break;
    case 'decisionAmount': formatAmountField(t); decision.amount = t.value; break;
    case 'decisionNote': decision.note = t.value; break;
    case 'pairStudent': pairing.studentName = t.value; break;
    case 'pairMother': pairing.motherName = t.value; break;
    case 'pairCode': pairing.input = t.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); t.value = pairing.input; break;
    case 'nameStudent': debounceAct({ type: 'names', student: t.value }); break;
    case 'nameMother': debounceAct({ type: 'names', mother: t.value }); break;
    case 'monthlyAmount': formatAmountField(t); debounceAct({ type: 'settings', monthly: { amount: parseAmount(t.value) } }); break;
    case 'monthlyDay': debounceAct({ type: 'settings', monthly: { day: Number(t.value) || 1 } }); break;
  }
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet) closeSheet(); });

// テスト通知が実際に届いたら、その事実をサーバーに残す。これがペアリングの完了条件。
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', async (e) => {
    if (!e.data || e.data.type !== 'push-verified') return;
    try {
      await api('/push/verify', { method: 'POST' });
      view = await api('/state');
      toast('通知が届きました。これで準備できました');
      render();
    } catch {}
  });
}

// 画面に戻ってきたら最新にする。低頻度のアプリなので取得はこれで足りる。
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !view || demo.active) return;
  try { view = await api('/state'); render(); } catch {}
});

async function start() {
  applyTheme();
  if (token) {
    try {
      view = await api('/state');
    } catch {
      token = null;
      try { localStorage.removeItem(TOKEN_KEY); } catch {}
    }
  }
  if (!view) {
    // サーバーが無い場所(GitHub Pages など)では、はじめからお試しモードにする。
    try {
      await fetch('/api/state', { method: 'GET' });
    } catch {
      demo.active = true;
      view = demo.view('student');
    }
  }
  render();
  if (view && !demo.active && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

start();
