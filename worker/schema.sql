-- 費用メモ。2人1組の世帯をひとつの JSON 文書として持つ。
-- 項目数が少なく更新頻度も低いため、項目ごとのテーブルには分けない。

CREATE TABLE IF NOT EXISTS household (
  id          TEXT PRIMARY KEY,
  doc         TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- 端末ごとに1行。トークンは平文を保存せず SHA-256 だけを持つ。
CREATE TABLE IF NOT EXISTS device (
  token_hash        TEXT PRIMARY KEY,
  household_id      TEXT NOT NULL,
  role              TEXT NOT NULL CHECK (role IN ('student', 'mother')),
  push              TEXT,
  push_verified_at  TEXT,
  created_at        TEXT NOT NULL,
  last_seen         TEXT,
  FOREIGN KEY (household_id) REFERENCES household(id)
);
CREATE INDEX IF NOT EXISTS device_household ON device(household_id);

-- 招待コード。単回・短時間で失効し、総当たりを防ぐため試行回数を数える。
CREATE TABLE IF NOT EXISTS invite (
  code_hash     TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('student', 'mother')),
  expires_at    TEXT NOT NULL,
  used_at       TEXT,
  created_at    TEXT NOT NULL,
  FOREIGN KEY (household_id) REFERENCES household(id)
);
CREATE INDEX IF NOT EXISTS invite_household ON invite(household_id);

-- コード入力の失敗回数。IP ごとに数え、一定を超えたら受け付けない。
CREATE TABLE IF NOT EXISTS attempt (
  ip        TEXT PRIMARY KEY,
  count     INTEGER NOT NULL DEFAULT 0,
  window_at TEXT NOT NULL
);
