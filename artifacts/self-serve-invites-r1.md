# 自己申告型イベント作成（self-serve）実装 r1

- 作成日: 2026-08-29 15:55頃
- 対応するプラン: `/Users/rakutoyamazaki/.claude/plans/mutable-meandering-canyon.md`
- 変更ファイル: `app/migrations/0005_self_serve_invites.sql`（新規）, `app/src/worker.ts`, `app/src/main.ts`, `app/wrangler.jsonc`
- 既存の`/admin`→secret→`/host/demo`デモ導線は無変更・無破壊（回帰確認済み）

## 実装内容

- `POST /api/invites`: secret不要の公開endpoint。イベント名・日時・待ち合わせ時刻・場所・合図を受け取り、招待を新規作成。匿名creator cookieによるrate limit(10分5回)、Idempotency-Key必須、reset同様のreplay/conflict処理。
- `GET /manage/:manageToken`: 招待作成時にのみ発行される`manageUrl`から、後日/別端末でもhost画面へ戻れる。
- `POST /api/admin/invites/:id/expire`: 乱用時にadminが強制失効できる緊急停止手段。
- `app/src/main.ts`: `/create`フォーム画面、`/host/`前方一致ルーティングへの一般化、トップページに「自分のイベントを作る」導線を追加。
- migration `0005`: `invites.manage_token_hash`, `invites.created_via`列追加、`one_live_demo`制約を`created_via='admin_demo'`限定へ変更（self-serve側は複数イベント同時に許可）、`invite_creation_keys`テーブル新設。

## 発見して修正したバグ

`app/wrangler.jsonc`の`assets.run_worker_first`が`["/api/*", "/join/*"]`のみで`/manage/*`が含まれておらず、`/manage/:manageToken`へのリクエストがWorkerに届かずSPAのfallback(index.html, 200)が返っていた。`run_worker_first`に`/manage/*`を追加して解消。両実装エージェントの担当範囲外（設定ファイル）だったため、統合検証時に発見し修正した。

## 検証結果

- `npm run check`（typecheck / vitest 6件 / build）: 全PASS
- ローカルdevサーバーでの実APIウォークスルー: `POST /api/invites`（secretなし、実データ「読書サークル体験会」等で作成）→`GET /manage/:token`（303、host session再発行）→participant参加→host confirm→両者`confirmed/revision=2`同期、すべて確認
- 既存の`/api/admin/session`→`/api/admin/demo/reset`導線が変更後も従来どおり200で動作することを回帰確認
- 実ブラウザで`/create`フォームへ入力（「近所のボードゲーム会」「2026/09/10 19:00」「中央図書館前」「緑のキャップ」）→送信→`/host/:inviteId`でQRと入力内容がそのまま表示されることを確認

## 既知の残課題（非ブロッキング）

- `renderHost()`が`shell()`を呼ぶ際のバナー文言が常に"DEMO DATA / REAL APP"固定で、self-serveで作られた実イベントでも同じ文言になる（意味は誤りではないが、self-serve側の文脈をもう少し正確に表現する余地がある）。
- `POST /api/invites`のreplay時（同一Idempotency-Keyでの再送）はhost cookieを再設定できない（host tokenがrandomTokenでhash化されているため復元不可）。`manageUrl`から再度host session化すれば実用上問題ないが、reset系のHMAC導出のような即時replay-cookie再設定はできない。
- `POST /api/invites`・`GET /manage/:manageToken`用の自動テスト（vitest/local-e2e.sh）は未追加。今回は手動E2Eで検証した。
