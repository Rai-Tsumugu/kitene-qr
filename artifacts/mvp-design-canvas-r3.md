# MVP Design Canvas r3 — まちあわせQR（仮）

- artifactId: `mvp-design-canvas-r3`
- revision: 3
- sourceRevision: 3
- status: `DRAFT_FOR_INDEPENDENT_REVIEW`
- selectedCandidate: `C1`

## Who

初めての交流イベントへ一人で参加することを保留している大学の後輩Nさんと、顔は覚えているが名前を聞き忘れた程度の関係にある誘い手。

## Problem

Nさんはイベントへ誘われても、会場の入口を一人で越え、受付や最初の会話へ進むまでを具体化できず、「まぁ、機会があれば」と保留しているように見える。これは本人未確認の仮説であり、日程・費用・関心不足が主因なら反証される。

現在の代替は、イベントURLを渡す、LINEで「一緒に行こう」と自由文を送る、都合の合う友人を待つ、または参加しないことである。自由文で同行を頼むことや、支援範囲を交渉すること自体が追加負担になりうる。

## Solution

誘い手が対面で「一緒に参加しませんか？」と声をかけてQRを見せる。Nさんはアカウント登録や名前入力なしで読み取り、「入口だけ一緒」「受付まで一緒」「最初の10分だけ一緒」「今回は見送る」から自分が望む範囲を選ぶ。誘い手が時刻と場所を確認すると、両端末に同じ待合せパスが残る。

解決を断定せず、**曖昧な誘いを、断る自由を残した具体的な待合せ合意へ変えられるか**を検証する。

## Demo path — 90 seconds

1. 誘い手がデモ用イベント、待合せ候補、提供できる支援を入力し、「この人を誘うQRを作る」を押す（15秒）。
2. 誘い手が「一緒に参加しませんか？」とQRをNさん役へ見せる（5秒）。
3. Nさん役が別スマホでQRを読み、「入口だけ一緒」を選ぶ（15秒）。
4. 誘い手画面が3秒以内に「入口だけ一緒に来てほしい」へ変わり、「17:50・正面入口で会う」を承認する（15秒）。
5. Nさん画面が3秒以内に灰色の依頼中から、同じ時刻・場所・色の確定パスへ変わる（10秒）。
6. Nさん役が「着いた」を押すと誘い手側にも反映され、誘い手が「会えた」を押してパスが完了する（20秒）。
7. 「一人で入口を越える」から「会う約束と迎える責任が双方にある」へ変わったことを示す（10秒）。

## Wow moment

最初の10秒の行動は、QRを読み「入口だけ一緒」を1回タップすること。5秒以内に誘い手側へ「あなたがすること：17:50に正面入口で待つ」が現れ、Nさんの小さな希望が誘い手の具体的な責任へ変わる。

二度目の操作は当日の「着いた」。誘い手側が「迎えに行く」状態へ変わり、会場入口での孤立を避ける。

## Input / State / Output

### Input

- 誘い手: デモ用イベント名、開始日時、待合せ時刻、待合せ場所ラベル、提供可能な支援範囲。
- Nさん: 希望する支援範囲、または理由不要の見送り。
- 当日: Nさんの「着いた」、誘い手の「会えた」。

### State

`open → requested | declined → confirmed → arrived → met`

- `expired` は期限超過時の終端状態。
- 同一revisionへの重複操作はidempotency keyで収束させる。
- Nさんの選択後に待合せ内容を変える場合はrevisionを増やし、再承認状態へ戻す。

### Output

- 誘い手: QR、短縮表示用コード、Nさんの選択、承認CTA、到着状態。
- Nさん: 支援選択、依頼中、確定待合せパス、到着CTA、見送り完了。
- 両者: 同じイベント・時刻・場所・合図色・revision。

## Screens

1. `/create` 誘い手作成画面：入力5項目以内、CTAは「この人を誘うQRを作る」。
2. `/host/:adminToken` 誘い手画面：招待文、QR、回答待ち、承認、到着確認を同一画面の状態変化で扱う。
3. `/i/:inviteToken` Nさん画面：一文説明、4つの選択肢、依頼中、確定パス、到着を同一画面で扱う。
4. `/demo` seed済みデモ開始画面：発表直前に新しいデモ招待を発行する。

画面数は役割ごとに増やさず、状態変化で見せる。スマホ縦画面を正本とする。

## API and data

### API

- `POST /api/invites` — 招待作成。admin/invite tokenをそれぞれ128-bit以上のWeb Crypto乱数で生成し、DBにはhashを保存。
- `GET /api/invites/:token` — tokenの役割に応じた最小状態取得。2秒polling。
- `POST /api/invites/:token/respond` — 支援範囲または見送りを保存。最初の有効回答を採用。
- `POST /api/invites/:adminToken/confirm` — 待合せを承認しrevisionを固定。
- `POST /api/invites/:token/arrive` — 到着を記録。
- `POST /api/invites/:adminToken/meet` — 合流完了を記録。
- `POST /api/demo/reset` — デモ用roomだけを新revisionで再発行。全体削除は禁止。
- `GET /api/health` — app、D1、revisionを返す。秘密値は返さない。

### Minimal D1 model

- `invites`: `id`, token hashes, demo event fields, offered scopes, selected scope, state, revision, expires_at, created_at, updated_at.
- `interactions`: `id`, `invite_id`, `idempotency_key`, `actor_role`, `action`, `revision`, `created_at`。`UNIQUE(invite_id, idempotency_key)`。

イベント情報は固定選択・文字数制限を使い、実名、顔画像、大学名、現在地、連絡先、自由記述を保存しない。

## External dependencies

- Cloudflare Workers Static Assets
- Cloudflare Worker API
- Cloudflare D1
- QR生成用のローカル依存パッケージ
- 外部AI、地図、通知、認証、メール、SNS APIは使わない。

## Cloudflare bindings

- `DB`: D1 binding
- `ASSETS`: Workers Static Assets binding
- `ENVIRONMENT`: `local | staging`
- Durable Objects、R2、KV、Workers AI、Queuesは使わない。

## Must / Should / Later

### Must

1. 誘い手が招待を作り、公開HTTPS URLのQRを表示できる。
2. 別クライアントが登録なしでQRから入り、支援範囲または見送りを選べる。
3. 選択がD1へ保存され、誘い手が承認すると両クライアントへ3秒以内に同じ待合せパスが出る。
4. 再読込後も状態が残り、重複送信でinteractionやrevisionが二重増加しない。
5. 「着いた」から「会えた」までが共有され、期限切れ・通信失敗・見送りを安全に表示する。

### Should

- QR下に手入力できる短い表示コードを出す。
- 合図色に加えて文字・記号を表示し、色だけに依存しない。
- デモroomのreset、接続状態、最終更新時刻を誘い手画面に表示する。

### Later

- 実通知、カレンダー、地図、イベント検索、複数人、複数候補時刻、主催者画面。
- 参加率分析、汎用イベント管理、ネイティブアプリ、AI推薦。

## Non-goals

- 知らない人同士のマッチング、同行者募集、位置追跡、チケット販売。
- Nさんを説得する、断った理由を収集する、既読や行動を追跡する。
- 一般市場の需要や、実来場・悩み解決をこのデモだけで証明する。

## Privacy and safety

- 招待tokenと管理tokenを分離し、URL tokenは128-bit以上、期限付き、推測困難にする。
- 公開URLを知る人だけがアクセスできるが、機密情報は置かない。正確な現在地や本名は扱わない。
- 「今回は見送る」「理由を答えない」を支援選択と同じ強さで表示する。
- 入力はenum中心、文字列はschema・文字数検証し、HTMLとして無加工表示しない。
- 外部公開時は最小レート制限を入れ、必要性が確認された場合のみTurnstileを追加する。

## Mock boundary

- デモのイベント名、日時、待合せ場所、Nさん役の操作はデモデータ。
- QR、別クライアント操作、D1保存、polling反映、再読込、重複送信、staging HTTPSは実動作として検証する。
- 実在Nさんへの送信、実イベント参加、実来場、悩みの改善は未実施・未確認として表示する。

## Fallback

1. QR読取失敗: QR下の短いURLまたは表示コードを手入力する。
2. 参加者端末不調: 独立ブラウザプロファイルで同じ公開URLを開く。
3. polling不調: 「状態を更新」ボタンで再取得する。
4. staging障害: 最後に成功した2端末操作の録画と、状態遷移スクリーンショットを見せる。localhostを公開動作とは呼ばない。
5. Nさん本人が仮説を否定: C2へ自動移行せず、Problemを差し戻して再選定する。

## Acceptance criteria

1. クリーンなlocal D1へmigration/seedを適用し、`/api/health`が200を返す。
2. stagingの`/create`で招待を作ると、別端末で読めるQRとfallback URLが出る。
3. 招待端末とは別のクライアントが登録なしで「入口だけ一緒」を選択できる。
4. 誘い手画面へ3秒以内に選択が反映され、承認後3秒以内にNさん画面へ同じ時刻・場所・revisionが出る。
5. 両画面を再読込しても確定状態が保持される。
6. 同じresponseを2回送っても`interactions`件数とrevisionが二重増加しない。
7. 古いrevisionのconfirm/arriveは409で拒否される。
8. Nさんが見送った場合、理由入力や再勧誘なしで終端し、誘い手側も「今回は見送り」とだけ表示する。
9. 期限切れtoken、無効token、D1失敗、offlineを利用者向け文言で表示する。
10. 別クライアント2つでQR → 選択 → 承認 → 到着 → 合流が90秒以内に完了し、スクリーンショット・ログ・DB確認を保存する。

## Timebox

- Canvas・独立確認・本人承認: 10分以内。
- 要件・UI・環境準備: 15分。
- 実装・local検証: 35分。
- staging公開・別クライアントE2E・修正: 20分。
- 発表・fallback・最終承認: 20分。
- 残り30分で新機能凍結、残り15分で発表だけにする。

## Open questions

- 実際に想定するイベントの種類・日時・会場は何か。MVPではデモデータで代替する。
- Nさんは入口同行、受付同行、最初の10分のどれを望むか。本人未確認。
- QRを対面で見せる場面が再現できない場合、画面投影または別端末表示で代替する。
- `Must 5`の到着・合流が時間を圧迫した場合、確認済み待合せパスまでをP0とし、到着・合流をP1へ落とす。

## Gate request

Who / Problem / Solution、QR中心の単一導線、Input / State / Output、受入条件、非目標、mock境界、fallback、時間上限を定義した。独立確認後、本人承認が得られるまで本実装へ進まない。
