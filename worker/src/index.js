// 費用メモ — API と静的配信。ビジネス規則は docs/logic.js が唯一の実装。
import {
  apply, ensureMonthly, visibleTo, statusOf, handoverReminders, memoCount,
  reminderText, emptyDoc, titleOf, withSan, Err,
} from '../../docs/logic.js';
import { sendPush } from './push.js';

const JST_OFFSET = 9 * 3600 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい 0/O/1/I を除く
const INVITE_TTL_MIN = 30;
const MAX_ATTEMPTS = 10;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const fail = (message, status = 400) => json({ error: message }, status);
const nowIso = () => new Date().toISOString();
const uid = () => crypto.randomUUID().slice(0, 8);

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomCode() {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return [...b].map((n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join('');
}

// ---------- 保存層 ----------

async function loadDoc(env, householdId) {
  const row = await env.DB.prepare('SELECT doc FROM household WHERE id = ?').bind(householdId).first();
  if (!row) throw new Err('世帯が見つかりません');
  return JSON.parse(row.doc);
}

const saveDoc = (env, householdId, doc) =>
  env.DB.prepare('UPDATE household SET doc = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(doc), nowIso(), householdId).run();

async function auth(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare(
    'SELECT token_hash, household_id, role, push, push_verified_at FROM device WHERE token_hash = ?',
  ).bind(hash).first();
  if (!row) return null;
  await env.DB.prepare('UPDATE device SET last_seen = ? WHERE token_hash = ?').bind(nowIso(), hash).run();
  return row;
}

// ---------- 通知 ----------

function vapidFrom(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT || 'mailto:noreply@example.com',
  };
}

// 宛先の端末すべてに送る。失効した購読はその場で消す。
async function pushTo(env, householdId, role, payload) {
  const vapid = vapidFrom(env);
  if (!vapid) return { sent: 0, skipped: 'VAPID 鍵が設定されていません' };
  const { results } = await env.DB.prepare(
    'SELECT token_hash, push FROM device WHERE household_id = ? AND role = ? AND push IS NOT NULL',
  ).bind(householdId, role).all();

  let sent = 0;
  for (const row of results || []) {
    let sub;
    try { sub = JSON.parse(row.push); } catch { continue; }
    try {
      const res = await sendPush(sub, JSON.stringify(payload), vapid);
      if (res.ok) sent++;
      if (res.gone) {
        await env.DB.prepare('UPDATE device SET push = NULL, push_verified_at = NULL WHERE token_hash = ?')
          .bind(row.token_hash).run();
      }
    } catch (e) {
      console.log('push failed', String(e));
    }
  }
  return { sent };
}

const other = (role) => (role === 'student' ? 'mother' : 'student');

// ---------- 画面に渡す形 ----------

async function viewFor(env, device) {
  const doc = await loadDoc(env, device.household_id);
  const ctx = { role: device.role, now: nowIso(), uid };
  if (ensureMonthly(doc, ctx)) await saveDoc(env, device.household_id, doc);

  const partner = await env.DB.prepare(
    'SELECT COUNT(*) AS n, SUM(CASE WHEN push_verified_at IS NOT NULL THEN 1 ELSE 0 END) AS v'
    + ' FROM device WHERE household_id = ? AND role = ? AND push IS NOT NULL',
  ).bind(device.household_id, other(device.role)).first();

  const partnerJoined = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM device WHERE household_id = ? AND role = ?',
  ).bind(device.household_id, other(device.role)).first();

  return {
    role: device.role,
    names: doc.names,
    settings: doc.settings,
    items: visibleTo(doc.items, device.role),
    push: {
      subscribed: !!device.push,
      verified: !!device.push_verified_at,
      publicKey: env.VAPID_PUBLIC_KEY || null,
    },
    partner: {
      joined: (partnerJoined?.n || 0) > 0,
      pushSubscribed: (partner?.n || 0) > 0,
      pushVerified: (partner?.v || 0) > 0,
    },
  };
}

// ---------- ルート ----------

async function handleApi(request, env, url) {
  const path = url.pathname.replace(/^\/api/, '');
  const method = request.method;
  const body = method === 'POST' ? await request.json().catch(() => ({})) : {};

  // 世帯を作る(受け取る側)
  if (path === '/pair/create' && method === 'POST') {
    const id = crypto.randomUUID();
    const doc = emptyDoc({ student: String(body.studentName || '').slice(0, 20), mother: String(body.motherName || '').slice(0, 20) });
    const at = nowIso();
    await env.DB.prepare('INSERT INTO household (id, doc, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .bind(id, JSON.stringify(doc), at, at).run();
    const token = randomToken();
    await env.DB.prepare('INSERT INTO device (token_hash, household_id, role, created_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256(token), id, 'student', at).run();
    const invite = await makeInvite(env, id, 'mother');
    return json({ token, role: 'student', ...invite });
  }

  // 招待コードを作り直す(端末の再接続にも使う)
  if (path === '/pair/code' && method === 'POST') {
    const device = await auth(request, env);
    if (!device) return fail('つながっていません', 401);
    const role = body.role === 'student' ? 'student' : 'mother';
    return json(await makeInvite(env, device.household_id, role));
  }

  // 招待コードで参加する
  if (path === '/pair/join' && method === 'POST') {
    const ip = request.headers.get('cf-connecting-ip') || 'local';
    if (await tooManyAttempts(env, ip)) return fail('回数が多すぎます。しばらくしてからにしてください', 429);
    const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6) { await countAttempt(env, ip); return fail('コードは6文字です'); }
    const row = await env.DB.prepare(
      'SELECT code_hash, household_id, role, expires_at, used_at FROM invite WHERE code_hash = ?',
    ).bind(await sha256(code)).first();
    if (!row || row.used_at || row.expires_at < nowIso()) {
      await countAttempt(env, ip);
      return fail('コードが使えません。新しいコードを出してもらってください');
    }
    const at = nowIso();
    const token = randomToken();
    await env.DB.batch([
      env.DB.prepare('UPDATE invite SET used_at = ? WHERE code_hash = ?').bind(at, row.code_hash),
      env.DB.prepare('INSERT INTO device (token_hash, household_id, role, created_at) VALUES (?, ?, ?, ?)')
        .bind(await sha256(token), row.household_id, row.role, at),
    ]);
    return json({ token, role: row.role });
  }

  // ここから先は認証が必要
  const device = await auth(request, env);
  if (!device) return fail('つながっていません', 401);

  if (path === '/state' && method === 'GET') return json(await viewFor(env, device));

  if (path === '/act' && method === 'POST') {
    const doc = await loadDoc(env, device.household_id);
    const ctx = { role: device.role, now: nowIso(), uid };
    let before;
    try {
      before = JSON.stringify(doc);
      apply(doc, body, ctx);
    } catch (e) {
      if (e instanceof Err) return fail(e.message);
      throw e;
    }
    if (JSON.stringify(doc) !== before) await saveDoc(env, device.household_id, doc);
    await notifyFor(env, device, body, doc);
    return json(await viewFor(env, { ...device, household_id: device.household_id }));
  }

  if (path === '/push/subscribe' && method === 'POST') {
    const sub = body.subscription;
    if (!sub || !sub.endpoint || !sub.keys) return fail('購読の形式が正しくありません');
    await env.DB.prepare('UPDATE device SET push = ?, push_verified_at = NULL WHERE token_hash = ?')
      .bind(JSON.stringify(sub), device.token_hash).run();
    return json({ ok: true });
  }

  // 自分の端末にテスト通知を送る。届いたことを画面から /push/verify で知らせてもらう。
  if (path === '/push/test' && method === 'POST') {
    if (!device.push) return fail('先に通知を許可してください');
    const res = await pushTo(env, device.household_id, device.role, {
      title: '通知のテスト', body: 'これが見えていれば、通知は届きます。', tag: 'test', verify: true,
    });
    if (res.skipped) return fail(res.skipped, 503);
    if (!res.sent) return fail('通知を送れませんでした');
    return json({ ok: true });
  }

  if (path === '/push/verify' && method === 'POST') {
    await env.DB.prepare('UPDATE device SET push_verified_at = ? WHERE token_hash = ?')
      .bind(nowIso(), device.token_hash).run();
    return json({ ok: true });
  }

  if (path === '/unlink' && method === 'POST') {
    await env.DB.prepare('DELETE FROM device WHERE token_hash = ?').bind(device.token_hash).run();
    return json({ ok: true });
  }

  return fail('見つかりません', 404);
}

async function makeInvite(env, householdId, role) {
  const code = randomCode();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MIN * 60000).toISOString();
  await env.DB.batch([
    // 同じ役割の未使用コードは先に無効にする
    env.DB.prepare('DELETE FROM invite WHERE household_id = ? AND role = ? AND used_at IS NULL').bind(householdId, role),
    env.DB.prepare('INSERT INTO invite (code_hash, household_id, role, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(await sha256(code), householdId, role, expiresAt, nowIso()),
  ]);
  return { code, expiresAt };
}

async function tooManyAttempts(env, ip) {
  const row = await env.DB.prepare('SELECT count, window_at FROM attempt WHERE ip = ?').bind(ip).first();
  if (!row) return false;
  if (Date.now() - new Date(row.window_at).getTime() > 3600_000) {
    await env.DB.prepare('DELETE FROM attempt WHERE ip = ?').bind(ip).run();
    return false;
  }
  return row.count >= MAX_ATTEMPTS;
}

async function countAttempt(env, ip) {
  await env.DB.prepare(
    'INSERT INTO attempt (ip, count, window_at) VALUES (?, 1, ?)'
    + ' ON CONFLICT(ip) DO UPDATE SET count = count + 1',
  ).bind(ip, nowIso()).run();
}

// 操作に応じた通知。渡す側への催促は送らない。
async function notifyFor(env, device, action, doc) {
  if (action.type === 'send') {
    const n = (action.ids || []).length;
    const from = withSan(doc.names.student) || '受け取る側';
    // まとめて1通知。件数は出すが合計金額は出さない。
    await pushTo(env, device.household_id, 'mother', {
      title: from + 'から ' + n + '件', body: '内容を見て、返事ができます。', tag: 'batch',
    });
    return;
  }
  if (action.type === 'decide' || action.type === 'approveBatch') {
    await pushTo(env, device.household_id, 'student', {
      title: (withSan(doc.names.mother) || '渡す側') + 'から返事がありました', body: '内容を確かめられます。', tag: 'decision',
    });
  }
}

// ---------- 定時処理 ----------

async function runCron(env, scheduledTime) {
  const now = new Date(scheduledTime || Date.now());
  const jst = new Date(now.getTime() + JST_OFFSET);
  const isMonday = jst.getUTCDay() === 1;
  const { results } = await env.DB.prepare('SELECT id, doc FROM household').all();

  for (const row of results || []) {
    const doc = JSON.parse(row.doc);
    const iso = now.toISOString();

    // 受け渡しの確認: 未チェック側にだけ、1回だけ
    const due = handoverReminders(doc, iso);
    const reminded = [];
    for (const role of ['student', 'mother']) {
      for (const it of due[role]) {
        const res = await pushTo(env, row.id, role, {
          title: '受け渡しの確認', body: reminderText(it, role), tag: 'handover-' + it.id,
        });
        if (res.sent) reminded.push(it.id);
      }
    }
    if (reminded.length) {
      apply(doc, { type: 'markReminded', ids: reminded }, { role: 'system', now: iso, uid });
    }

    // メモの件数: 週に一度、受け取る側にだけ。催促ではなく状態の報告。
    if (isMonday) {
      const n = memoCount(doc);
      if (n > 0) {
        await pushTo(env, row.id, 'student', {
          title: 'メモ ' + n + '件', body: '送るものがあれば、まとめて送れます。', tag: 'weekly',
        });
      }
    }

    if (reminded.length) await saveDoc(env, row.id, doc);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (e) {
        if (e instanceof Err) return fail(e.message);
        console.log('error', String(e && e.stack || e));
        return fail('サーバー側で問題が起きました', 500);
      }
    }
    if (url.pathname === '/__cron' && env.ALLOW_TEST_CRON === '1') {
      await runCron(env, Date.now());
      return json({ ok: true });
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env, event.scheduledTime));
  },
};
