# まちあわせQR — P0実装要件 r6

- artifactId: `requirements-r6`
- source: `mvp-design-canvas-r4.md` + canonical correction `mvp-design-canvas-r5.md`
- persona source: `persona-vivid-r1.md`
- status: `IMPLEMENTATION_READY`
- platform: Cloudflare Worker + Static Assets + D1

## 1. 対象と検証仮説

対象は、誘いに「まぁ、機会があれば」と答え、一人での初参加が難しそうに見えた大学の後輩Nさん。顔を知る誘い手が対面でQRを渡し、Nさん役が同行範囲を1タップすると、曖昧な誘いを具体的な待合せ合意へ変えられるかを検証する。Nさん本人の最大障壁、実参加、悩みの解決、一般需要は未確認であり、成果として主張しない。

## 2. P0 Must（これ以外は実装しない）

| ID | Must | ブラウザ受入条件 |
|---|---|---|
| M1 | 管理者がseed済みデモ招待だけをresetし、誘い手用sessionと参加者用QRを発行できる | staging HTTPS上でreset後、`/host/demo`にQRと回答待ちが表示される |
| M2 | storageを共有しない参加者が、登録・名前・理由入力なしでQRから入り、`入口だけ一緒 / 受付まで一緒 / 最初の10分まで一緒 / 今回は見送る`を1回選べる | 別端末または別browser profileで10秒以内に選択し、再送しても重複状態を作らない |
| M3 | 選択をD1へ保存し、誘い手へ3秒以内に反映する | hostの2秒pollingで選択または見送りが表示され、reload後も残る |
| M4 | requestedの場合だけ、誘い手がseed済みの`17:50・正面入口で待つ`を承認し、両画面に同じ確定パスを3秒以内に出す | event、時刻、場所ラベル、文字付き合図、revisionが両画面で一致し、reload後も残る |
| M5 | 無効・失効・期限切れ・競合・重複・rate超過・通信失敗を、安全かつ再試行可能な範囲で表示する | 下記error/API契約どおりに404/410/409/429を再現でき、token・secret・sessionを露出しない |

P1はない。到着・合流、新規招待作成、通知、接続状態はすべてLaterである。

## 3. 90秒デモと画面

1. 管理者が`/admin`で短命admin sessionを得てdemo resetする。
2. 誘い手が`/host/demo`のQRを「一緒に参加しませんか？」と見せる。
3. Nさん役が別クライアントで読み、`/join/:inviteToken`から303でtokenなしの`/invite/:inviteId`へ移る。
4. Nさん役が「入口だけ一緒」を1タップする。誘い手側へ3秒以内に「あなたがすること：17:50に正面入口で待つ」が出る。
5. 誘い手が承認する。両画面へ同じ確定パスが出て完了する。

| Route | 認可 | 同一画面内の状態 |
|---|---|---|
| `/admin` | admin secret入力前 / admin session取得後 | login、reset成功/失敗。招待内容の編集機能は置かない |
| `/host/demo` | host session | QR＋回答待ち、選択内容＋承認CTA、見送り終端、確定パス、期限切れ |
| `/join/:inviteToken` | participant sessionを得る初回導線 | UIを描画せず、成功時303、無効404、失効/期限切れ410 |
| `/invite/:inviteId` | participant session | 4択、依頼中、見送り終端、確定パス、期限切れ |

スマホ縦画面を正本とする。選択肢と見送りは同じ視覚的強さにし、理由を求めず、declined後の再勧誘CTAを置かない。

## 4. 状態遷移

初期`revision=1`。participant回答ではrevisionを変えず、host confirmだけが`revision+1`する。

| From | Actor / action | 条件 | To | revision |
|---|---|---|---|---:|
| `open` | participant / scope選択 | current revision、未期限切れ | `requested` | 不変 |
| `open` | participant / decline | current revision、未期限切れ | `declined` | 不変 |
| `requested` | host / confirm | current revision、未期限切れ | `confirmed` | +1 |
| `open`,`requested` | system / readまたはwrite時の期限判定 | `expires_at <= now` | `expired` | 不変 |

終端は`confirmed | declined | expired`。最初の有効participant回答を固定し、回答修正は不可。stateまたはrevision不一致は409。期限切れを先に判定し410とする。

## 5. D1 schema、制約、trigger

時刻はUTC ISO-8601、IDはUUID、token/session raw値はWeb Cryptoで128-bit以上とし、DBにはSHA-256 hex hashだけを保存する。

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  demo_key TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  event_name TEXT NOT NULL CHECK(length(event_name) BETWEEN 1 AND 80),
  event_starts_at TEXT NOT NULL,
  meetup_at TEXT NOT NULL,
  place_label TEXT NOT NULL CHECK(length(place_label) BETWEEN 1 AND 40),
  signal_text TEXT NOT NULL CHECK(length(signal_text) BETWEEN 1 AND 40),
  state TEXT NOT NULL CHECK(state IN ('open','requested','declined','confirmed','expired')),
  selected_scope TEXT CHECK(selected_scope IN ('entrance','reception','first10','decline')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(
    (state='open' AND selected_scope IS NULL) OR
    (state IN ('requested','confirmed') AND selected_scope IN ('entrance','reception','first10')) OR
    (state='declined' AND selected_scope='decline') OR
    (state='expired')
  )
);
CREATE UNIQUE INDEX one_live_demo
  ON invites(demo_key) WHERE revoked_at IS NULL AND state != 'expired';

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  invite_id TEXT REFERENCES invites(id),
  role TEXT NOT NULL CHECK(role IN ('admin','host','participant')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  CHECK((role='admin' AND invite_id IS NULL) OR (role IN ('host','participant') AND invite_id IS NOT NULL))
);
CREATE INDEX sessions_invite_role ON sessions(invite_id, role);

CREATE TABLE interactions (
  id TEXT PRIMARY KEY,
  invite_id TEXT NOT NULL REFERENCES invites(id),
  actor_role TEXT NOT NULL CHECK(actor_role IN ('admin','host','participant','system')),
  action TEXT NOT NULL CHECK(action IN ('reset','respond','decline','confirm','expire')),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 128),
  request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64),
  response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  created_at TEXT NOT NULL,
  UNIQUE(invite_id, actor_role, idempotency_key)
);
CREATE INDEX interactions_invite_created ON interactions(invite_id, created_at);

CREATE TABLE rate_buckets (
  scope_key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK(count >= 0),
  PRIMARY KEY(scope_key, window_start)
);

CREATE TRIGGER invite_transition_guard
BEFORE UPDATE OF state, revision, selected_scope ON invites
WHEN NOT (
  (OLD.state='open' AND NEW.state='requested' AND NEW.revision=OLD.revision AND NEW.selected_scope IN ('entrance','reception','first10')) OR
  (OLD.state='open' AND NEW.state='declined' AND NEW.revision=OLD.revision AND NEW.selected_scope='decline') OR
  (OLD.state='requested' AND NEW.state='confirmed' AND NEW.revision=OLD.revision+1 AND NEW.selected_scope=OLD.selected_scope) OR
  (OLD.state IN ('open','requested') AND NEW.state='expired' AND NEW.revision=OLD.revision) OR
  (NEW.state=OLD.state AND NEW.revision=OLD.revision AND NEW.selected_scope IS OLD.selected_scope)
)
BEGIN SELECT RAISE(ABORT, 'invalid_invite_transition'); END;

CREATE TRIGGER interactions_immutable_update
BEFORE UPDATE ON interactions
BEGIN SELECT RAISE(ABORT, 'interactions_are_immutable'); END;
CREATE TRIGGER interactions_immutable_delete
BEFORE DELETE ON interactions
BEGIN SELECT RAISE(ABORT, 'interactions_are_immutable'); END;
```

writeは、rate bucket更新、`UPDATE invites ... WHERE id=? AND state=? AND revision=? AND revoked_at IS NULL AND expires_at>?`、interaction INSERTをD1 batchで実行する。更新件数0は再読後に410（期限/失効）または409（state/revision競合）へ分類する。Aggregateは`invites.state/revision`から導出し、別tableを作らない。

## 6. seed / reset

seedはコード管理の固定値のみ：デモイベント名、開始日時、`17:50`、`正面入口`、文字付き合図、3支援scope、expiry。実在人物名・大学名・住所・GPS・連絡先は含めない。

reset時刻を基準にinvite expiryは2時間。画面上のデモイベント日時は固定表示値とし、認可期限の判定には使わない。

`POST /api/admin/demo/reset`は1 transaction/batchで次を行う。

1. `demo_key='default'`の旧live inviteを`revoked_at=now`にし、旧host/participant sessionsを失効する。
2. 新invite ID、新invite token hash、`open/revision=1`をinsertする。
3. 新host session hashをinsertし、host cookieを発行する。
4. reset interactionを記録する。旧invite row/token hashは、旧QRアクセスへ410を返すため保持する。

全体削除、手動DB投入、招待内容編集は禁止。E2E後にもresetし、旧tokenが410になった後だけ旧QRを証拠化できる。

## 7. session / auth / token / rate

- cookie名は`mq_admin`、`mq_host`、`mq_participant`。stagingは`HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=...`。localだけSecureを外し、その差を記録する。
- admin session TTLは30分。host/participant session TTLは60分、またはinvite expiryまでの短い方。raw invite tokenはresetまたはinvite expiryまで有効である。
- admin sessionは`POST /api/admin/session`で`DEMO_ADMIN_SECRET`を定数時間比較して発行する。adminはreset専用で、host操作はできない。
- resetは新host cookieを発行する。host APIはhost session、participant APIは同じinviteに紐づくparticipant sessionだけを許可する。
- QR/fallback URLだけがraw invite tokenを含む。交換後は303でtokenなしURLへ移す。token再交換は同一inviteの新participant session発行を許すが、最初の有効回答だけが状態を変更できる。
- session/tokenのhash、role、expiry、revocationを全read/writeで検査する。reset済みtokenと期限切れtokenは410、未知tokenは404とし、画面文言から区別できないようにする。
- token/session画面とAPIは`Cache-Control: no-store`、`Referrer-Policy: no-referrer`、same-origin限定、第三者resourceなし。POSTはJSON、許可Origin一致を必須とする。
- rate: pre-auth admin loginは`admin-login:<deployment>`で10分10回（secret、生IP、入力値をkeyにしない）。resetはadmin session hashで10分10回。respond/confirmはinvite単位・各10分5回。超過は429 + `Retry-After`。
- rate windowは`floor(unix_seconds/600)*600`。同一bucketをatomic UPSERTし、`count < limit`の時だけ加算する。超過時の`Retry-After`は次windowまでの秒数（1以上600以下）とする。
- GET pollingは2秒間隔、hidden時停止、連続5分で停止して手動更新を出す。

## 8. API契約

共通成功bodyは`{ "ok": true, "data": ... }`、失敗bodyは`{ "ok": false, "error": { "code": "...", "message": "...", "retryable": boolean } }`。秘密値、hash、cookie、内部SQLをbodyへ含めない。writeは`Idempotency-Key` header必須、bodyのcanonical JSON SHA-256をfingerprintにする。

| Method / path | 認可・input | 200/303 data | errors |
|---|---|---|---|
| `POST /api/admin/session` | `{secret}` | admin cookie、204 | 400, 401, 429 |
| `POST /api/admin/demo/reset` | admin + idempotency | `{inviteId, hostPath:"/host/demo", participantJoinUrl, expiresAt}` + host cookie | 401, 409, 429 |
| `GET /api/host/demo` | host | `{inviteId,event,state,selectedScope,meetup,revision,expiresAt,participantJoinUrl}` | 401, 410 |
| `GET /api/join/:inviteToken` | raw token | participant cookie + `Location:/invite/:inviteId` | 303, 404, 410 |
| `GET /api/participant/invite` | participant | `{inviteId,event,state,selectedScope,meetup,revision,expiresAt}`（join URLなし） | 401, 410 |
| `POST /api/participant/respond` | participant + `{choice,revision}`、choice enum | canonical participant view | 400, 401, 409, 410, 429 |
| `POST /api/host/confirm` | host + `{revision}` | canonical confirmed view | 400, 401, 409, 410, 429 |
| `GET /api/health` | public | `{status:"ok",db:"ok",buildRevision}` | 503 |

同じidempotency key + fingerprintは保存済み`response_status/response_json`を返す。同key + 異なるfingerprintは`409 IDEMPOTENCY_CONFLICT`。古いstate/revisionは`409 STALE_STATE`。期限切れ/失効は`410 INVITE_UNAVAILABLE`、rate超過は`429 RATE_LIMITED`。通信失敗は画面を終端扱いせず「通信できません。もう一度確認」を出し、同じkeyで再送する。

host responseは選択scopeだけを返し、理由や参加者識別子を返さない。participant/hostのconfirmed viewは同一seedからevent、meetup、signal、revisionを返す。

## 9. Mock / real境界

- Mock: イベント、日時、場所ラベル、合図、Nさん役、誘い手役。実在Nさんへ送信しない。
- stagingで実動作として検証: 公開HTTPS、QR読取、token交換、role session、D1永続化、2秒polling、reload、idempotency、競合409、rate 429、期限/失効410、reset。
- 未検証: Nさん本人の悩み、実イベント参加、来場、行動変容、解決効果。

## 10. 非目標

新規招待作成、到着/合流、通知、カレンダー、地図、イベント検索、複数人・複数時刻、公開集計、AI、DO/R2/KV、実名・顔・大学・位置・連絡先・自由記述、知らない人同士のマッチング、説得、断る理由、既読、回答修正、production変更。

## 11. 受入テスト

### Browser / staging

1. clean D1へmigration/seedを適用し、HTTPSのhealthが200。admin login → reset → host QR表示が成功する。
2. storageを共有しない2クライアントで、有効QRをその場だけ読み、participantが10秒以内に「入口だけ一緒」を選ぶ。hostへ3秒以内に反映する。
3. hostがconfirmし、participantへ3秒以内に同じevent、17:50、正面入口、文字付き合図、revision=2が出る。双方reload後もconfirmedが残る。
4. 別resetでdeclineを選び、hostには「今回は見送り」だけが出る。理由入力・再勧誘・confirm CTAがない。
5. networkを一時offlineにしてretry表示を確認し、復帰後に同じidempotency keyで1回だけ収束する。
6. reset後、旧host/participant sessionと旧tokenが410になる。新招待はopenで旧状態を引き継がない。
7. 有効QRは撮影・録画・保存しない。reset後に旧tokenの410を確認し、失効済みQRだけを証拠化する。token、secret、session、正確な場所は伏せる。

### API / D1

1. respondの4 enum、invalid enum 400、host cookieでparticipant API 401、admin cookieでconfirm 401を確認する。
2. 同一key+同一payloadが同じ成功response、同一key+異なるpayloadが409、別keyの二重回答と古いrevisionが409になる。
3. requested以外のconfirmが409、正しいconfirmだけrevisionを1増やす。DB triggerへ不正遷移を直接与えて失敗する。
4. write上限超過で429 + `Retry-After`。pre-auth bucketにsecret、生IP、入力値が保存されない。
5. expiry境界でread/writeとも410になり、stateがexpiredへ収束する。未知tokenは404、reset済みtokenは410。
6. interactionsが1成功writeにつき1件でimmutable、session/tokenはhashのみ、個人情報・自由記述が全tableにないことをqueryで確認する。

## 12. Gate

`PASS` — Mustは5件、各要件はbrowser/APIで再現可能。公開HTTPS、匿名role session、D1永続化、別クライアント同期、reset/seed、競合・期限・rate・token保護、mock/real境界が固定されている。実装はこのr6から機能を追加せず、`web-app-builder`とCloudflare環境準備へ渡せる。
