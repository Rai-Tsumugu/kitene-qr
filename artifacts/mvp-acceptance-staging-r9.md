# MVP Acceptance Review r9 — final staging

- reviewer: independent acceptance reviewer
- reviewedAt: `2026-08-29 15:22 JST`
- source: Canvas package r4+r5、requirements r6、修正後`app/`、staging Worker / D1
- publicUrl: `https://machiawase-qr-staging.frogs-share-api.workers.dev`
- workerVersion: `6dd2232e-1c24-4bb7-8750-29ade2373d5a`
- overallVerdict: `PASS`
- productionVerdict: `NOT_AUTHORIZED / OUT_OF_SCOPE`
- supersedesVerdict: `mvp-acceptance-staging-r8.md`のreset idempotency条件を解消

## 1. 最終結論

「まちあわせQR」のP0 staging MVPを`PASS`と判定する。

QR招待 → 名前・理由なしの同行範囲選択または見送り → 誘い手の待合せ承認 → 両clientの同一確定pass、という主要導線が公開HTTPSとremote D1上で動作する。独立client同期、永続化、role分離、token交換、再読込可能な状態、409/429/410、reset失効、interaction監査・immutable、mock / real表示を確認した。

r8で唯一残したreset idempotencyは解消された。`reset_keys.idempotency_key`主キー、初回前replay確認、D1 batch競合後のreplay再取得、HMACによるinvite/host token再導出により、同一key再送は同じ`inviteId / inviteUrl / expiresAt`へ200で収束する。raw tokenはD1へ保存しない。run固有keyへ直したE2Eをlocalとstagingで各2回連続実行し、すべてPASSした。

このPASSは技術的MVP受入である。実在Nさんの最大障壁、実参加、来場、安心、行動変容、一般需要は未検証の価値仮説であり、解決済みとは判定しない。

## 2. Review matrix

| 観点 | 判定 | 最終証拠 |
|---|---|---|
| P0 Value | `PASS` | 曖昧な誘いを、参加者が選んだ同行範囲と誘い手の具体的な待合せ責任へ変える一本の導線が動作。declineも同じ強さで選べ、理由・再勧誘なしで終端。 |
| Who / Problem fidelity | `PASS` | 正本persona r5の観察事実だけを使用。UIはデモデータ、実在Nさん未送信・未参加を明示し、内心や効果を創作していない。 |
| UI | `PASS` | mobile participant画面でevent、確定状態、role、mock / real境界を確認。選択、待機、confirm、decline、errorの状態を実装。操作部品はスマホ向け。 |
| Data | `PASS` | remote D1にinvite state/revision、role sessions、reset/respond/decline/confirm interactions、reset_keysを永続化。全migration適用済み。 |
| Shared | `PASS` | browser participantと独立host cookie clientが同じinviteを共有。反映計測1549msで3秒以内。confirmed/revision 2がremote D1に残る。 |
| Safety / privacy | `PASS` | token/session hash-only、reset_keysにもraw token列なし。303 tokenless URL、Secure/HttpOnly/SameSite、CSP/no-store/no-referrer、role guard、state-scope guard、one-live-demo、interaction immutableを確認。 |
| Idempotency / concurrency | `PASS` | reset同一keyは同一inviteId/URL/expiryへ収束し、replay host cookieでhost open 200。participant replay 200、異payload 409。run固有keyにより連続E2Eも再現可能。 |
| Error boundary | `PASS` | 400、401、404、409、410、429 + dynamic Retry-After、共通error bodyをlocal/stagingで再現。reset後の旧QRと旧host sessionも拒否。 |
| Mock / real boundary | `PASS` | QR/token/session/D1/pollingはreal staging behavior。イベント値とNさん役はdemo。実在Nさんへの効果は未検証と明示。 |
| Time / scope | `PASS` | P1を追加せず、QR → 選択/見送り → confirm → 同一passに固定。Cloudflare Worker + Static Assets + D1だけで120分枠の発表へ移行可能。 |
| Demo / 90秒 | `PASS` | 公開HTTPSのcritical flowが成立し、同期は1549ms。90秒デモの操作数と応答条件を満たす。 |
| Public staging | `PASS` | Workers公開URL、health 200、remote D1、security headers、deployed versionを確認。 |

## 3. Must最終対応

| Must | 判定 | 証拠 |
|---|---|---|
| M1 seed reset / host QR | `PASS` | admin session、run固有idempotency key、demo限定reset、host session、participant URL/QR、open/revision 1。replayも同じ招待へ収束。 |
| M2 独立client 4択 | `PASS` | participant join 303、storage非共有client、登録・名前・理由なしの3 scope + decline、最初の有効回答だけを保存。 |
| M3 D1保存 / 3秒同期 | `PASS` | participant respondをremote D1へ保存し、host側へ1549msで反映。polling周期2秒。 |
| M4 confirm / 同一pass | `PASS` | host confirm後、participantへevent、17:50、場所ラベル、合図、scope、revision 2を表示。remote stateもconfirmed。 |
| M5 safe error / retry | `PASS` | idempotent reset/respond、409/429/410、role拒否、token/session失効、共通error、immutable監査をlocal/stagingで再現。 |

## 4. r8条件の解消

### 実装

`migrations/0004_reset_idempotency.sql`で次を追加した。

- `reset_keys.idempotency_key`をPRIMARY KEY
- `invite_id`、request fingerprint、tokenを含まないresponse、host expiry、created timeだけを保存
- raw invite token、raw host token、admin secretは保存しない

Worker resetは次の順で収束する。

1. 同一keyの既存resetを新invite作成前に検索する。
2. 既存ならfingerprintを検証し、HMAC-SHA-256でinvite/host tokenを再導出する。
3. 初回は旧demo失効、新invite、host session、reset interaction、reset_keysを一つのD1 batchで書く。
4. 並行競合でbatchが失敗した場合はreset_keysを再取得し、勝者の結果を返す。
5. 同key + 異fingerprintは409。今回のreset bodyは固定空入力で、fingerprintは安定している。

### 独立追加試験

公開stagingでrun固有keyを使用し、初回と即時replayを比較した。

- first reset: 200
- same-key replay: 200
- same `inviteId`: true
- same `inviteUrl`: true
- same `expiresAt`: true
- replay cookieでhost API: 200
- host state: open
- host revision: 1

remote queryでは`reset_keys`のrow数、distinct key数、distinct invite数が一致し、raw token列は0だった。

## 5. 再実行した証拠

秘密値、cookie、invite token、有効QRはレビュー出力へ保存していない。

### Reproducible E2E

E2Eハーネスは各runで暗号学的random `run_id`を作り、同一run内だけprimary reset keyを2回使う。二つ目のdemo resetは別のrun固有keyを使う。これにより、replay収束と新規resetの両方を連続実行できる。

- local E2E 1回目: 全項目PASS
- local E2E 2回目: 全項目PASS
- staging E2E 1回目: 全項目PASS
- staging E2E 2回目: 全項目PASS

各runで確認した項目:

- health 200
- admin login
- reset初回 / same-key replay / same inviteId・URL・expiry
- replay後host open/revision 1
- participant join 303 / open
- respond / same payload replay / different payload 409
- host requested / confirm / participant confirmed revision 2
- second reset / old QR 410 / old host 401 / unknown token 404
- decline / wrong role / invalid enum
- rate 429 / Retry-After / common error contract
- reset interaction audit
- interaction UPDATE拒否

### Build / suite

- TypeScript typecheck: PASS
- Vitest: 4/4 PASS
- Vite production build: PASS
- `node tests/validate-hackathon-skills.mjs`: `validated 28 hackathon skills`

### Cloudflare

- Worker deployment: `6dd2232e-1c24-4bb7-8750-29ade2373d5a`
- remote migrations: `No migrations to apply`
- `reset_keys` table: 存在
- raw token columns in `reset_keys`: 0
- raw token columns in `invites`: 0
- reset/respond/decline/confirm interactions: 存在
- health: `ok=true / status=ok / db=ok / buildRevision=staging`

### Browser evidence

- `artifacts/e2e/staging-participant-confirmed-safe-r8.png`
- mobile participant role、DEMO DATA / REAL APP、実在Nさん未送信・未参加を表示
- 有効QRとtokenは画像に含めない
- 確定passの詳細証拠はtokenを含まないAPI/D1検証と1549ms計測で補完

## 6. 未検証の価値仮説

以下は技術PASSの対象外であり、発表でも事実として主張しない。

- Nさん本人の最大障壁が会場入口・受付・最初の会話であること
- Nさんが提示した3 scopeを望むこと
- QR招待が対面の一言だけより心理的負担を下げること
- 実際のイベント参加、来場、安心、継続参加が増えること
- 他の大学生やイベントへ一般化できること

発表上の正確な主張は、「一人参加の入口障壁という観察仮説に対し、既知の誘い手との待合せ合意を90秒で作る公開staging MVPが動作した」である。

## 7. 非阻害事項と運用注意

- 本番production公開、実在Nさんへの送信、実イベント利用は行わない。
- 有効QRをスクリーンショットや録画へ保存しない。証拠化する場合はreset後に旧token 410を確認する。
- demo開始時は新しいrandom idempotency keyでresetする。同じ操作の通信再送時だけ同じkeyを再利用する。
- 物理カメラ読取は発表直前に端末でリハーサルするとよいが、公開URL、token交換、独立client導線の受入は完了している。

## 8. Gate判定

`PASS`

設計・要件・実装・公開staging・remote D1・独立client・error境界・証拠秘匿がP0受入条件を満たした。次は`demo-presentation`で3分発表と90秒デモへ固定し、追加機能は実装しない。
