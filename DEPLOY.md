# 公開の手順

初回だけ必要な作業。2回目以降は `npm run deploy` だけでよい。
作業場所は `C:\Users\kanta\dev\onegai`。

---

## 0. Cloudflare のアカウントを作る

まだなら https://dash.cloudflare.com/sign-up でアカウントを作る。
クレジットカードの登録は要らない。無料枠のままで足りる。

確認:

```sh
npx wrangler whoami
```

`You are not authenticated` と出ればこれから先の手順が必要。

---

## 1. 端末を Cloudflare につなぐ

```sh
npx wrangler login
```

ブラウザが開くので、Cloudflare にログインして「Allow」を押す。
ターミナルに `Successfully logged in` と出れば完了。

うまくブラウザが開かないときは、表示された URL を手で開く。

確認:

```sh
npx wrangler whoami
```

メールアドレスと Account ID が出れば成功。

---

## 2. データベースを作る

```sh
npx wrangler d1 create onegai
```

こんな出力が返る。

```
✅ Successfully created DB 'onegai'

[[d1_databases]]
binding = "DB"
database_name = "onegai"
database_id = "1a2b3c4d-...."
```

**この `database_id` の値をコピーする。**
`wrangler.toml` を開き、`database_id = "local-development-placeholder"` の行を
コピーした値に置き換える。

```toml
database_id = "1a2b3c4d-...."
```

---

## 3. 通知の鍵を作り直す

開発中に作った鍵は画面に出してしまったので、本番用に新しく作る。
**まだ誰も通知を購読していない今がやり直せる最後のタイミング。**
購読が始まったあとに鍵を変えると、既存の購読がすべて無効になる。

```sh
npm run vapid
```

2行出力される。

```
VAPID_PUBLIC_KEY  = BB....
VAPID_PRIVATE_KEY = xy....
```

やることは3つ。

1. `wrangler.toml` の `VAPID_PUBLIC_KEY = "..."` を、**新しい公開鍵**に置き換える。
2. `wrangler.toml` の `VAPID_SUBJECT` を自分のメールアドレスにする。
   通知の配信元が問い合わせ先として使う。`mailto:` を頭に付ける。
3. `.dev.vars` の `VAPID_PRIVATE_KEY` を、**新しい秘密鍵**に置き換える(手元で動かすときに使う)。

```
# .dev.vars ... git には入らない
VAPID_PRIVATE_KEY = "xy...."
ALLOW_TEST_CRON = "1"
```

秘密鍵は `wrangler.toml` にも README にも**書かない**。リポジトリは公開なので、書くと外から読める。

---

## 4. 本番のデータベースに表を作る

```sh
npm run db:init:remote
```

`--remote` が付いているので、手元ではなく Cloudflare 側に作られる。
確認を求められたら `y`。

---

## 5. 公開する

```sh
npm run deploy
```

最後に URL が出る。

```
https://onegai.<自分のサブドメイン>.workers.dev
```

**この URL を控える。** 友人に渡すのはこれ。

この時点ではまだ通知だけが動かない。秘密鍵をまだ渡していないため。

---

## 6. 秘密鍵を登録する

```sh
npx wrangler secret put VAPID_PRIVATE_KEY
```

入力を求められたら、手順3で作った**秘密鍵**を貼って Enter。
画面には表示されない。登録すると自動で反映される。

---

## 7. 動いているか確かめる

```sh
curl -s -i https://onegai.<サブドメイン>.workers.dev/api/state | head -3
```

`HTTP/2 401` と `content-type: application/json` が返れば正しい。
HTML が返ってきたら、`wrangler.toml` の `run_worker_first` が消えていないか見る。

次にブラウザで URL を開き、「はじめる(受け取る側)」の画面が出ることを見る。

定時処理が登録されたかは、Cloudflare の管理画面で
Workers & Pages → onegai → Settings → Trigger Events に
`0 0 * * *` があることで分かる。

---

## 8. 自分で一度通してみる

友人に渡す前に、手元の2つのブラウザで最後まで通す。
普通のウィンドウとプライベートウィンドウを使えば、2人分になる。

1. 普通のウィンドウで URL を開き、「はじめる」→ 呼び名を入れて6文字のコードを出す。
2. プライベートウィンドウで同じ URL を開き、「コードでつながる」→ コードを入れる。
3. そちらの設定画面で「通知を受け取る」を押し、許可する。
4. **テスト通知が実際に出ることを目で見る。** 出れば準備完了の扱いになる。
5. 受け取る側でメモを作り、まとめて送る。渡す側に通知が届く。

ここまで通れば本物として使える。

---

## 9. 友人に渡す

渡すもの: **URL ひとつだけ。**

そのうえで、本人と一緒にやったほうが確実な作業が2つある。

- **渡す側(お母さん)の端末の通知設定。**
  iPhone と iPad は、Safari で開いて共有ボタン →「ホーム画面に追加」をしてから、
  できたアイコンで開き直さないと通知が一切届かない。
  しかも届いていないことに本人は気づかない。友人が代わりに操作するのが確実。
- **テスト通知が鳴るのを本人に見てもらう。** 鳴るまでは届いていない。

伝えておくべきこと: **データは私の Cloudflare アカウントに保存される。**
品目と金額が私から見える状態になる。友人には先に言っておく。

---

## よくあるつまずき

| 症状 | 原因と対処 |
|---|---|
| `npm run deploy` で database_id のエラー | 手順2の貼り替えを忘れている |
| 通知ボタンを押しても何も起きない | `http://` で開いている。通知は HTTPS でしか動かない(`workers.dev` は HTTPS) |
| iPhone で通知が来ない | ホーム画面に追加していない。追加後、そのアイコンから開き直す |
| テスト通知が「送れませんでした」 | 手順6の秘密鍵が未登録か、手順3で公開鍵と対になっていない |
| 相手の画面に何も届かない | 送る側の画面に「通知が届かない状態です」が出ていないか見る |
| コードが使えないと言われる | 30分で失効する。設定から新しいコードを出す |

動きを見たいときはログを流す。

```sh
npx wrangler tail
```

---

## 2回目以降

コードを直したあとは、これだけ。

```sh
npm run deploy
```

手元で確かめてから出すなら:

```sh
npm run dev        # 別のターミナルで動かしたまま
npm run test:api
npm run test:live
```
