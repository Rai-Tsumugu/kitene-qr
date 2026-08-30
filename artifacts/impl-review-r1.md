# 実装独立レビュー r1（machiawase-qr / app）

- 作成日: 2026-08-29
- role: 独立確認役（Codexとは別セッション、読み取り専用）
- 対象: `app/src/worker.ts`, `app/src/core.ts`, `app/src/main.ts`, `app/migrations/0001_initial.sql`, `app/test/core.test.ts`, `app/test/local-e2e.sh`, `app/wrangler.jsonc`, `app/package.json`
- 突き合わせ元: `artifacts/requirements-r6.md`（§2 Must, §3 screens/routes, §4 状態遷移, §5 D1 schema, §6〜§8 API契約/rate/token, §11 受入テスト）、`artifacts/mvp-design-canvas-r4.md`/`r5.md`
- 総合判定: `要修正`

## 指摘（重大度順）

1. **[must] session TTLが仕様値を超過** — `worker.ts:95-96`（admin）、`worker.ts:112,150`（host、reset時発行）、`worker.ts:182-187`（participant、join時発行）。要件はadmin session TTL 30分、host/participant TTLは60分またはinvite expiryの短い方だが、実装はinvite expiry（reset直後は約120分）をそのままTTLに使っており、admin/host/participantいずれも仕様上限を超えて有効になる。M5（token/session保護）への直接違反。
   - 修正案: `Math.min(60, minutesRemaining)`等で上限をキャップする。

2. **[must] reset操作のinteraction記録が欠落** — `POST /api/admin/demo/reset`（`worker.ts:106-161`）がinteractionsテーブルへ書き込んでいない。加えて`0001_initial.sql`の`interactions.actor_role` CHECKは`'host','participant'`のみ、`action` CHECKは`'respond','confirm'`のみで、正本スキーマが要求する`'admin','system'`ロールや`'reset','decline','expire'`アクションを許容しておらず、reset/expireの記録自体がスキーマ上不可能。

3. **[must] API応答形式が契約と不一致** — 仕様は成功時`{ok:true,data:...}`、失敗時`{ok:false,error:{code,message,retryable}}`。実装は失敗時`{error:"invite_expired"}`のようなフラット形式（`worker.ts`各所、例: 178,219,222,348,356,364,366,369,372,447）で`message`/`retryable`が無い。成功時も`/api/host/demo`・`/api/participant/invite`（196,204）は`ok`キーなしで`{invite:...}`のみ、`/api/health`（75-82）は`{status:"ok",db:"ok",buildRevision}`ではなく`{ok,environment,revision}`という別形式。

4. **[should] D1スキーマの多重防御が弱い** — 複合CHECK制約（state × selected_scopeの組合せ検証）、`demo_key`カラムと`one_live_demo` UNIQUE INDEX（demo_key単位で1件のみのlive invite保証）が欠落。resetが`demo_key`でスコープされず全invitesを一括expire扱いにしている。`interactions_immutable_update`/`_delete`トリガーも無く、interactionsへのUPDATE/DELETEを防げない（§11 #6検証不能）。

5. **[should] Retry-Afterが固定値** — `worker.ts:302-304`の`onError`が常に`"600"`を返し、実際の残りwindow秒数を計算していない（値域は満たすが仕様の意図とは異なる）。

6. **[should] テストカバレッジ不足** — `core.test.ts`はヘルパー関数のみ検証。`local-e2e.sh`（`npm run check`未組込、手動実行前提）は多くをカバーするが、以下が未カバー: host cookieでparticipant API 401、DB triggerへの不正遷移直接投入での失敗、expiry境界でread/writeとも410、interactions immutabilityの直接検証（トリガー未実装のため検証不能）。

## 受入条件チェック

| Must | 判定 | 根拠 |
|---|---|---|
| M1 reset+QR+回答待ち表示 | PASS | `worker.ts:106-161`、`main.ts:124-138` |
| M2 匿名4択・重複防止 | PASS | `worker.ts:207-252`、idempotency UNIQUE制約 |
| M3 D1保存・3秒以内反映 | 部分未達 | 保存/2秒pollingは実装済みだが、session TTL・interaction記録の不備あり |
| M4 host承認・両画面同期・revision+1 | PASS | `worker.ts:254-296`、`interactions_apply_transition`トリガー |
| M5 エラー分類・token/session非露出 | 未達 | エラーbody形式が契約と不一致、session TTLが仕様値を超過 |

## 良好な点（維持してよい）

- 状態遷移・idempotency・declineの対等扱い・非目標項目（実名/顔画像/大学名等の非保存）は仕様通り。

## 未確認事項

- `npm test`・`local-e2e.sh`は時間制約のためレビュー側では実行していない（静的な読解による突き合わせのみ）。
- リポジトリのgit差分は確認していない（対象パスの直接読解のみ）。

## 総合所見

コアの状態遷移・idempotency・非目標順守は健全。session TTL超過（セキュリティ直結）、reset監査ログ欠落、API応答契約不一致の3件が[must]であり、実装続行前の優先修正を推奨する。
