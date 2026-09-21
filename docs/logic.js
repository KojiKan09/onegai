// 費用メモ — 状態モデルと更新規則。ブラウザと Worker の両方が読み込む唯一の実装。
// ここに UI も保存層も入れないこと。純粋な関数だけに保つ。

export class Err extends Error {}

export const STATUS = {
  memo:       { label: 'メモ',         cls: 'pill-muted',     seenBy: 'student' },
  self_paid:  { label: '自分で払った', cls: 'pill-rest',      seenBy: 'student' },
  cancelled:  { label: 'やめた',       cls: 'pill-rest',      seenBy: 'student' },
  requested:  { label: '返事まち',     cls: 'pill-muted',     seenBy: 'both' },
  handover:   { label: '受け渡し待ち', cls: 'pill-attention', seenBy: 'both' },
  one_ticked: { label: '確認待ち',     cls: 'pill-attention', seenBy: 'both' },
  done:       { label: '完了',         cls: 'pill-positive',  seenBy: 'both' },
  declined:   { label: '見送り',       cls: 'pill-rest',      seenBy: 'both' },
};

export function statusOf(it) {
  if (it.cancelled) return 'cancelled';
  if (it.selfPaid) return 'self_paid';
  if (!it.sentAt) return 'memo';
  if (it.decision === 'declined') return 'declined';
  if (!it.decision) return 'requested';
  if (it.motherTickedAt && it.studentTickedAt) return 'done';
  if (it.motherTickedAt || it.studentTickedAt) return 'one_ticked';
  return 'handover';
}

export const handAmount = (it) => (it.decision === 'partial' ? it.approvedAmount : it.amount);
export const doneAt = (it) => (it.motherTickedAt && it.studentTickedAt
  ? (it.motherTickedAt > it.studentTickedAt ? it.motherTickedAt : it.studentTickedAt) : null);
export const titleOf = (it) => (it.title || '品目なし');

// 呼び名に敬称を足す。すでに敬称や続柄で終わっていれば足さない。
// 「お母さん」に「さん」を重ねない、という当たり前のことをここで一度だけ決める。
export const withSan = (n) => {
  const name = String(n || '').trim();
  if (!name) return '';
  return /(さん|ちゃん|くん|君|様|ママ|パパ|母|父|姉|兄)$/.test(name) ? name : name + 'さん';
};
export const monthKeyOf = (iso) => { const d = new Date(iso); return d.getFullYear() + '-' + (d.getMonth() + 1); };

// 渡す側には「メモ」「自分で払った」「やめた」を一切見せない。
export function visibleTo(items, role) {
  if (role === 'student') return items;
  return items.filter((it) => STATUS[statusOf(it)].seenBy === 'both');
}

export function blankItem(id, at) {
  return {
    id, title: '', amount: 0, note: '', monthly: false,
    createdAt: at, sentAt: null, batchId: null,
    decision: null, approvedAmount: null, remainder: null, decidedAt: null, motherNote: '',
    motherTickedAt: null, studentTickedAt: null, studentNote: '',
    selfPaid: false, selfPaidAt: null, cancelled: false,
    reminderDismissed: {}, remindedAt: null,
  };
}

export const emptyDoc = (names) => ({
  names: { student: (names && names.student) || '', mother: (names && names.mother) || '' },
  items: [],
  settings: { showTotals: false, monthly: { enabled: false, amount: 0, day: 1 } },
});

const DAY = 86400000;
const dayStart = (iso) => { const d = new Date(iso); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / DAY);

// 更新規則。doc を書き換えて返す。role は操作した人で、権限の判定もここで行う。
export function apply(doc, action, ctx) {
  const { role, now, uid } = ctx;
  const find = (id) => doc.items.find((x) => x.id === id);
  const a = action;

  switch (a.type) {
    case 'addMemo': {
      if (role !== 'student') throw new Err('メモを作れるのは受け取る側だけです');
      const amount = Math.max(0, Math.round(Number(a.amount) || 0));
      if (!amount) throw new Err('金額を入力してください');
      const it = blankItem(uid(), now);
      it.title = String(a.title || '').slice(0, 80);
      it.amount = amount;
      it.note = String(a.note || '').slice(0, 500);
      doc.items.push(it);
      return doc;
    }
    case 'send': {
      if (role !== 'student') throw new Err('送れるのは受け取る側だけです');
      const ids = (a.ids || []).filter((id) => { const it = find(id); return it && statusOf(it) === 'memo'; });
      if (!ids.length) throw new Err('送れるメモがありません');
      const batchId = 'b-' + uid();
      ids.forEach((id) => { const it = find(id); it.sentAt = now; it.batchId = batchId; });
      return doc;
    }
    case 'selfPaid': {
      if (role !== 'student') throw new Err('操作できるのは受け取る側だけです');
      const it = find(a.id);
      if (!it || statusOf(it) !== 'memo') throw new Err('メモが見つかりません');
      it.selfPaid = true; it.selfPaidAt = now;
      return doc;
    }
    case 'undoSelfPaid': {
      if (role !== 'student') throw new Err('操作できるのは受け取る側だけです');
      const it = find(a.id);
      if (!it || statusOf(it) !== 'self_paid') throw new Err('見つかりません');
      it.selfPaid = false; it.selfPaidAt = null;
      return doc;
    }
    case 'cancel': {
      if (role !== 'student') throw new Err('操作できるのは受け取る側だけです');
      const it = find(a.id);
      if (!it || statusOf(it) !== 'memo') throw new Err('メモが見つかりません');
      it.cancelled = true;
      return doc;
    }
    case 'decide': {
      if (role !== 'mother') throw new Err('返事できるのは渡す側だけです');
      const it = find(a.id);
      if (!it || statusOf(it) !== 'requested') throw new Err('返事できる項目がありません');
      decide(doc, it, a, ctx);
      return doc;
    }
    case 'approveBatch': {
      if (role !== 'mother') throw new Err('返事できるのは渡す側だけです');
      const list = doc.items.filter((it) => it.batchId === a.batchId && statusOf(it) === 'requested');
      if (!list.length) throw new Err('返事できる項目がありません');
      list.forEach((it) => { it.decision = 'full'; it.decidedAt = now; });
      return doc;
    }
    case 'tick': {
      const who = a.who;
      if (who !== role) throw new Err('自分の欄だけ操作できます');
      const it = find(a.id);
      if (!it) throw new Err('見つかりません');
      const st = statusOf(it);
      if (st !== 'handover' && st !== 'one_ticked') throw new Err('受け渡しの段階ではありません');
      const key = who === 'mother' ? 'motherTickedAt' : 'studentTickedAt';
      const other = who === 'mother' ? 'studentTickedAt' : 'motherTickedAt';
      if (it[key]) {
        if (it[other]) throw new Err('完了後は変更できません');
        it[key] = null;
      } else {
        it[key] = now;
        it.reminderDismissed[who] = false;
        it.remindedAt = null;
      }
      return doc;
    }
    case 'dismissReminder': {
      const it = find(a.id);
      if (!it) throw new Err('見つかりません');
      it.reminderDismissed[role] = true;
      return doc;
    }
    case 'studentNote': {
      if (role !== 'student') throw new Err('操作できるのは受け取る側だけです');
      const it = find(a.id);
      if (!it || !it.studentTickedAt) throw new Err('受け取り前です');
      it.studentNote = String(a.note || '').slice(0, 200) || ' ';
      return doc;
    }
    case 'settings': {
      const s = doc.settings;
      if (typeof a.showTotals === 'boolean') s.showTotals = a.showTotals;
      if (a.monthly) {
        if (typeof a.monthly.enabled === 'boolean') s.monthly.enabled = a.monthly.enabled;
        if (a.monthly.amount != null) s.monthly.amount = Math.max(0, Math.round(Number(a.monthly.amount) || 0));
        if (a.monthly.day != null) s.monthly.day = Math.min(28, Math.max(1, Math.round(Number(a.monthly.day) || 1)));
      }
      return doc;
    }
    case 'names': {
      if (a.student != null) doc.names.student = String(a.student).slice(0, 20);
      if (a.mother != null) doc.names.mother = String(a.mother).slice(0, 20);
      return doc;
    }
    case 'markReminded': {
      (a.ids || []).forEach((id) => { const it = find(id); if (it) it.remindedAt = now; });
      return doc;
    }
    default:
      throw new Err('不明な操作です');
  }
}

function decide(doc, it, a, ctx) {
  const { now, uid } = ctx;
  it.decidedAt = now;
  it.motherNote = String(a.note || '').slice(0, 200);
  if (a.choice === 'full') { it.decision = 'full'; it.approvedAmount = null; it.remainder = null; return; }
  if (a.choice === 'declined') { it.decision = 'declined'; it.approvedAmount = null; it.remainder = null; return; }
  if (a.choice !== 'partial') throw new Err('返事の内容を選んでください');

  const amt = Math.max(0, Math.round(Number(a.amount) || 0));
  if (!amt || amt > it.amount) throw new Err('渡す金額を確かめてください');
  it.decision = 'partial';
  it.approvedAmount = amt;
  it.remainder = a.remainder === 'later' ? 'later' : 'self';
  if (it.remainder !== 'later') return;

  // 後日渡す分は、渡す側の約束として受け渡し待ちに入れる。受け取る側が送り直す必要はない。
  const rest = it.amount - amt;
  if (rest <= 0) return;
  const extra = blankItem(uid(), now);
  extra.title = titleOf(it) + '(残り)';
  extra.amount = rest;
  extra.note = '後日渡す分';
  extra.sentAt = now;
  extra.batchId = it.batchId;
  extra.decision = 'full';
  extra.decidedAt = now;
  doc.items.push(extra);
}

// 毎月分の自動登録。返事のやりとりはなく、受け渡しの確認だけ。
export function ensureMonthly(doc, ctx) {
  const m = doc.settings.monthly;
  if (!m.enabled || !m.amount) return false;
  const today = new Date(ctx.now);
  if (today.getDate() < m.day) return false;
  const key = today.getFullYear() + '-' + (today.getMonth() + 1);
  if (doc.items.some((it) => it.monthly && monthKeyOf(it.createdAt) === key)) return false;
  const at = new Date(today); at.setDate(m.day); at.setHours(9, 0, 0, 0);
  const it = blankItem(ctx.uid(), at.toISOString());
  it.title = (today.getMonth() + 1) + '月の生活費';
  it.amount = m.amount;
  it.monthly = true;
  it.sentAt = it.createdAt;
  it.batchId = 'monthly';
  it.decision = 'full';
  it.decidedAt = it.createdAt;
  doc.items.push(it);
  return true;
}

// 受け渡しの確認が片方だけのまま2日たった項目。未チェック側にだけ、1回だけ。
// 「あとで」を押した項目は対象外。
export function handoverReminders(doc, nowIso) {
  const out = { student: [], mother: [] };
  for (const it of doc.items) {
    if (statusOf(it) !== 'one_ticked') continue;
    if (it.remindedAt) continue;
    const target = it.motherTickedAt ? 'student' : 'mother';
    if (it.reminderDismissed[target]) continue;
    const otherAt = it.motherTickedAt || it.studentTickedAt;
    if (daysBetween(otherAt, nowIso) < 2) continue;
    out[target].push(it);
  }
  return out;
}

export const memoCount = (doc) => doc.items.filter((it) => statusOf(it) === 'memo').length;

export function reminderText(it, role) {
  const amt = '¥' + Number(handAmount(it) || 0).toLocaleString('ja-JP');
  return role === 'mother'
    ? titleOf(it) + ' ' + amt + ':渡し済みなら「渡した」をどうぞ'
    : titleOf(it) + ' ' + amt + ':受け取っていれば「受け取った」をどうぞ';
}
