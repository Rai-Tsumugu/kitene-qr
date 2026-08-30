# MVP Design Canvas r4 — まちあわせQR（仮）

- artifactId: `mvp-design-canvas-r4`
- revision: 4
- sourceRevision: 3
- status: `DRAFT_FOR_INDEPENDENT_REVIEW`
- selectedCandidate: `C1`
- supersedes: `mvp-design-canvas-r3`

## Who

初めての交流イベントへ一人で参加することを保留している大学の後輩Nさん。

### Secondary actor / 協力者

Nさんをイベントへ誘い、顔は覚えているが名前を聞き忘れた程度の関係にある先輩。Nさんが選んだ範囲だけ同行し、待合せを確約する。

## Problem

Nさんはイベントへ誘われても、会場の入口を一人で越え、受付や最初の会話へ進むまでを具体化できず、「まぁ、機会があれば」と保留しているように見える。これは本人未確認の仮説であり、日程・費用・関心不足が主因なら反証される。

## Solution

誘い手が対面で「一緒に参加しませんか？」とQRを見せる。Nさんは登録や名前入力なしで、同行してほしい範囲または見送りを自分で選ぶ。誘い手が待合せ責任を確約し、両端末へ同じ確定パスを表示する。この一つの体験で、曖昧な誘いを、断る自由を残した具体的な待合せ合意へ変えられるかを検証する。

## P0 demo path — 90 seconds

1. 誘い手がseed済みデモ招待を開き、「一緒に参加しませんか？」とQRを見せる。
2. Nさん役が別スマホでQRを読み、10秒以内に「入口だけ一緒」または「今回は見送る」を選ぶ。
3. 選択が誘い手側へ3秒以内に反映され、誘い手が「17:50・正面入口で待つ」を承認する。
4. Nさん側へ3秒以内に同じイベント、時刻、場所、合図、revisionの確定パスを表示し、ここでP0を完了する。

到着・合流はP0 staging E2Eが締切30分前までにPASSした場合だけ着手するP1であり、P0デモには含めない。

## Wow moment

QR読取後の最初の画面に「一緒に行ってほしい範囲を選ぶと、誘い手が待ち合わせを確定します（名前や理由の入力は不要です）」と表示する。

最初の10秒の操作はNさん役による「入口だけ一緒」の1タップ。5秒以内に誘い手側へ「あなたがすること：17:50に正面入口で待つ」が現れ、Nさんの小さな希望が誘い手の具体的な責任へ変わる。

## Input / State / Output

### Input

- seed: デモ用イベント名、開始日時、待合せ時刻、場所ラベル、提供可能な支援範囲。
- Nさん役: `entrance | reception | first10 | decline` のいずれか。
- 誘い手: 待合せ内容の承認。

### P0 state machine

| From | Action / Actor | Endpoint | Required revision | To | Success | Invalid or stale |
|---|---|---|---:|---|---:|---:|
| `open` | 支援選択 / participant | `POST /api/participant/respond` | current | `requested` | 200 | 409 |
| `open` | 見送り / participant | `POST /api/participant/respond` | current | `declined` | 200 | 409 |
| `open` | 期限超過 / system | read/write時に判定 | current | `expired` | 410 | 410 |
| `requested` | 待合せ承認 / host | `POST /api/host/confirm` | current | `confirmed` | 200 | 409 |
| `requested` | 期限超過 / system | read/write時に判定 | current | `expired` | 410 | 410 |

P0の終端は`confirmed | declined | expired`。participantの最初の有効回答を固定し、誤タップ修正はMVP非目標とする。

### Idempotency / concurrency

- `UNIQUE(invite_id, actor_role, idempotency_key)`。
- request bodyの正規化hashを`request_fingerprint`として保存する。
- 同じkey・同じfingerprintは以前の成功応答を返す。同じkey・異なるfingerprintは409。
- 状態更新は`state`と`revision`をWHERE条件に含め、interaction記録とD1 batchで収束させる。
- confirm時にrevisionを1増加。古いrevisionの操作は409。

### Output

- 誘い手: QR、回答待ち、Nさんの選択、承認CTA、確定パス。
- Nさん: 支援選択、依頼中、確定パス、または見送り完了。
- 両者: 同じイベント、時刻、場所ラベル、文字付き合図、revision。

## Screens

1. `/host/demo`：管理session必須。seed済み招待のQR、回答待ち、承認、確定を同一画面で表示。
2. `/join/:inviteToken`：QRの初回交換だけに使用。token検証後participant session cookieを発行し、303で`/invite/:inviteId`へ移す。
3. `/invite/:inviteId`：participant session必須。支援選択、依頼中、確定、見送り、期限切れを同一画面で表示。
4. `/admin`：管理secretから短命の管理sessionを発行し、デモ招待だけをresetする。

スマホ縦画面を正本とし、状態ごとにページを増やさない。

## Public architecture and logical model

```text
Host browser -- admin/host session --> Worker API -- D1
       |                                  ^
       +-- QR with invite token ----------+
Participant browser -- exchange token for participant session --> Worker API
```

- `Room`相当: 1件の`invite`。
- `ParticipantSession`相当: role別の期限付きcapability/session。実名・匿名名は保存しない。
- `Interaction`: 状態変更を記録する`interactions`。
- `Aggregate`相当: `invite.state`と`revision`から導出し、別tableを作らない。
- 私的な一人と既知の誘い手の合意なので、参加人数や公開集計は表示しない。

## API and authorization

- `POST /api/admin/session`: `DEMO_ADMIN_SECRET`を検証し、短命の`HttpOnly; Secure; SameSite=Strict`管理cookieを発行。秘密値を保存・返却しない。
- `POST /api/admin/demo/reset`: 管理session必須。対象デモ招待・既存sessionを失効し、新tokenで再発行。全体削除は禁止。
- `GET /api/host/demo`: host session必須。host状態のみ返す。
- `GET /api/join/:inviteToken`: 128-bit以上のtokenを検証し、participant session cookieを発行してtokenなしURLへ303 redirect。
- `GET /api/participant/invite`: participant session必須。participant向け最小状態だけ返す。
- `POST /api/participant/respond`: participant session必須。enum、revision、idempotency keyを検証。
- `POST /api/host/confirm`: host session必須。invite tokenでは実行不可。
- `GET /api/health`: app、D1、build revisionのみ返す。

管理tokenをURL/API pathへ載せない。管理sessionは管理secretから、host/participant sessionは128-bit以上のWeb Crypto乱数から発行し、DBにはSHA-256 hashとrole・期限だけを保存する。

## Token, browser and response protections

- QRとfallback URLは同じ128-bit以上のinvite tokenを含むHTTPS URL。短いroom codeや手入力アクセスコードは使わない。
- token交換後は303 redirectでaddress barからtokenを除く。
- token/sessionをアプリログ、例外、analytics、スクリーンショット、録画へ出さない。
- token/sessionを扱う全画面/APIへ`Referrer-Policy: no-referrer`、`Cache-Control: no-store`を設定し、第三者resourceを読み込まない。
- `expires_at`を全read/writeで検査し、期限切れは詳細を返さず410。resetで旧invite tokenと全role sessionを即時失効する。
- staging cookieは`HttpOnly; Secure; SameSite=Strict`。local検証はSecure属性以外を同条件にし、差分を記録する。

## Rate control

- participant writeはinvite単位で10分5回、host confirmはinvite単位で10分5回、admin session/resetは管理session単位で10分10回。
- D1 `rate_buckets(scope_key, window_start, count)`を条件付きUPDATE/INSERTし、超過は429と`Retry-After`を返す。
- state machine上受理可能なのは最初のparticipant回答と1回のconfirmのみ。制限は誤再送を許しつつ濫用を抑える補助線とする。
- GET pollingは2秒間隔、ページ非表示時停止、連続5分で停止し手動更新へ切り替える。

## Minimal D1 model

- `invites`: demo event fields、token hash、state、selected scope、revision、expires_at、timestamps。
- `participant_sessions`: `id_hash`, `invite_id`, `role`, `expires_at`, `revoked_at`。
- `interactions`: `invite_id`, `actor_role`, `action`, `idempotency_key`, `request_fingerprint`, `revision`, `created_at`。
- `rate_buckets`: `scope_key`, `window_start`, `count`。

文字入力はseedだけに限定し、利用者操作はenumにする。実名、顔画像、大学名、現在地、連絡先、自由記述を保存しない。

## External dependencies / bindings

- Cloudflare Worker + Static Assets
- `DB`: D1
- `DEMO_ADMIN_SECRET`: staging secret。値をファイルやログへ残さない。
- `ENVIRONMENT`: `local | staging`
- QR生成用ローカルパッケージ
- 外部AI、地図、通知、認証サービス、メール、SNS、DO、R2、KVは使わない。

## Must / Should / Later

### Must — P0

1. 管理者がseed済み招待をresetし、誘い手画面へ公開HTTPS URLのQRを出せる。
2. storageを共有しない別クライアントが登録なしでQRから入り、支援範囲または見送りを選べる。
3. 選択がD1へ保存され、誘い手が承認すると両クライアントへ3秒以内に同じ確定パスが出る。
4. 再読込後も状態が残り、重複送信・競合・期限切れ・rate limitが契約どおりに収束する。
5. 見送り、通信失敗、無効/失効tokenを、再勧誘や秘密情報なしで安全に表示する。

### Should — P1

- Nさん役の「着いた」と誘い手の「会えた」を共有する。
- 誘い手が新規招待内容を入力する`/create`。
- 接続状態、最終更新時刻、文字と記号を併用した合図。

P1は2026-08-29 15:45 JSTまでにP0 staging E2EがPASSした場合だけ着手する。

### Later

- 実通知、カレンダー、地図、イベント検索、複数人、複数候補時刻、主催者画面、分析、AI、ネイティブアプリ。

## Non-goals

- 知らない人同士のマッチング、位置追跡、チケット販売、Nさんの説得、断った理由の収集、既読追跡。
- participant回答の修正、参加者数の集計、公開ランキング。
- このデモだけで一般需要、実来場、悩み解決を証明すること。

## Privacy and safety

- 「今回は見送る」「理由を答えない」を支援選択と同じ強さで表示する。
- 待合せ場所は正確な住所やGPSではなく、デモ用の場所ラベルだけにする。
- enum/schema/文字数を検証し、利用者入力をHTMLとして無加工表示しない。
- 実在Nさんへの送信、実イベント利用、production変更は行わない。

## Mock / real boundary

- Mock/demo data: イベント名、日時、場所、Nさん役、誘い手役。
- Real staging behavior to verify: QR、token交換、role session、D1保存、2秒polling、再読込、idempotency/409、429、期限切れ、reset、HTTPS。
- Unverified: 実在Nさんの悩み、実送信、実参加、実来場、改善効果。

## Fallback

1. QR不調: tokenを伏せた説明の後、同じ高エントロピーfallback URLを対象端末へ安全にコピーして開く。
2. 端末不調: storage/sessionを共有しない別browser profileまたはprivate contextを使う。
3. polling不調: 手動更新で同じAPIを再取得する。
4. staging障害: 最後に成功した独立2クライアント録画と、token・場所を伏せた状態遷移スクリーンショットを見せる。
5. localhostや録画fallbackはstaging公開動作と明確に区別する。

## P0 acceptance criteria and evidence

1. clean local D1へmigration/seedを適用し、`/api/health`が200。
2. staging `/host/demo`へ管理sessionで入り、reset後に別クライアントで読めるQRを表示。
3. 異なる端末、または異なるbrowser profile/private contextで、session/storageを共有せず参加。単一profileの2タブはPASS不可。
4. participantが10秒以内に選択または見送りでき、hostへ3秒以内に反映。
5. host承認後、participantへ3秒以内に同じ時刻・場所ラベル・revisionを表示。
6. 両画面再読込後も終端状態が保持される。
7. 同じidempotency key + payloadは同じ成功応答、同key + 異なるpayloadと古いrevisionは409。
8. write上限超過は429 + `Retry-After`、期限切れは410、無効tokenは404相当の非詳細表示。
9. 見送りは理由入力・再勧誘なしで終端し、hostには「今回は見送り」とだけ表示。
10. QR画像、両画面、3秒以内の反映、再読込、D1 state/interactions、409/429/410を保存するが、token、secret、正確な待合せ情報は必ず伏せる。

## Absolute timebox

- 14:50: r4独立再確認と本人承認を終了。未承認なら実装開始しない。
- 15:05: 要件・UI・環境を凍結。
- 15:35: P0 local導線を終了。未達ならShouldを全削除。
- 15:45: 新機能を凍結。staging、独立2クライアントE2E、fallbackだけにする。
- 16:00: 実装を終了し、16:15まで発表に固定。
- 時間は延長しない。到着・合流は15:45までにP0 staging E2EがPASSした場合だけ着手する。

## Open questions

- Nさんの最大障壁と希望支援は未確認。否定されたらProblemへ差し戻す。
- 実イベント情報は未提示。P0ではseed済みデモデータだけを使う。
- production公開、実在Nさんへの送信、実イベント利用は未承認かつ非目標。

## Gate request

R1〜R9を反映し、P0をQR → 選択/見送り → 誘い手承認 → 同一確定パス同期へ凍結した。独立再確認と本人承認までは本実装を開始しない。
