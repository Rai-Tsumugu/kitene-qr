# P1残課題の確認 r2（machiawase-qr / app）

- 作成日: 2026-08-29 15:20頃
- role: 独立確認役（Codexとは別セッション、読み取り専用）
- 前提: `artifacts/mvp-acceptance-local-r7.md` §5「P1 — 最終受入までに是正」で挙げられた4項目のうち3項目の実装状況を、`worker.ts`/`main.ts`を直接読んで再確認した
- 位置づけ: 補足記録。実装コードは変更していない。P0（`impl-review-r1.md`の[must]3件、r7のP0 4件）はいずれも修正済みであることを別途確認済み

## 未対応（コード確認時点、いずれもP1・非ブロッキング）

### 1. rate limitの順序がidempotency replayより先

- `worker.ts:240`（participant respond）、`worker.ts:289`（host confirm）とも、`enforceRateLimit`をidempotency replayチェック（`worker.ts:255-256`, `303-304`）より先に呼んでいる。
- 影響: 通信不良で同一`Idempotency-Key`を使って再送した場合、本来は以前の成功応答をそのまま返すべきところ、rate limit上限を超えていると429になり得る（r7 §5 P1-1）。
- 修正方針: replayチェックを`enforceRateLimit`より前に移動する。

### 2. host confirmのidempotency keyが再送のたびに変わる

- `main.ts:213`で`createIdempotencyKey()`をconfirmクリックのたびに呼んでいる。participant側（`main.ts:276`）は`participantIdempotencyKey`という保持済み変数を使っており、host側だけ揃っていない。
- 影響: host側で通信失敗後にリトライすると、毎回新しいkeyになるため、サーバー側で「同じ操作の再送」として扱われず、意図しない多重confirmや409の原因になり得る（r7 §5 P1-2）。
- 修正方針: host confirm用のidempotency keyもコンポーネント状態などに保持し、同一操作の再送では使い回す。

### 3. 5分polling停止後の手動更新CTAが未実装

- `main.ts`内に該当する実装が見つからない（grep該当なし）。
- 影響: `mvp-design-canvas-r4.md`のRate control節「連続5分で停止し手動更新へ切り替える」のうち、停止後にユーザーが手動更新できるUIが無い（現状は停止するだけ）。
- 修正方針: polling停止時に「更新する」ボタン等を表示し、押下で同じAPIを再取得する。

## 対応済み（参考、再掲不要レベルの確認）

- reset対象のdemo_key限定、D1防御制約（`0002_interaction_audit.sql`, `0003_demo_scope_guards.sql`）、admin session TTL 30分、reset時のinteraction監査ログ、動的Retry-Afterはすべてコード上で確認済み（`impl-review-r1.md`のフォローアップとして別途確認）。

## 優先度についての所見

r7自身がこの3件をP0ではなくP1（最終受入までに是正）と位置づけている。締切までの残時間を踏まえ、staging公開・2クライアントE2E・発表準備を優先し、この3件は余裕があれば対応する、という判断で問題ない。
