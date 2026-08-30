# Production環境デプロイ r1

- 実施日時: 2026-08-29 16:11頃
- 実施者: 本人の明示的指示（「本番環境にデプロイしてください」）による

## 作成したCloudflareリソース

- D1: `machiawase-qr-production`（`database_id: 585e5e8e-5d22-4421-a467-e41f0f20339d`）
- Worker: `machiawase-qr-production`
- Secret: `DEMO_ADMIN_SECRET`（production環境専用の新規ランダム値。local/staging とは別値。生成時のみローカルの一時ファイルに置き、確認後削除済み）
- 公開URL: `https://machiawase-qr-production.frogs-share-api.workers.dev`

## 変更したファイル

- `app/wrangler.jsonc`: `env.production`ブロックを追加（`env.staging`と同構成）
- `app/src/worker.ts`: `ENVIRONMENT`型に`"production"`を追加。cookieの`secure`判定を`=== "staging"`から`!== "local"`へ変更（productionでもSecure cookieになるよう修正。この修正がなければproduction cookieがSecure属性なしで発行されるセキュリティ上の不備だった）

## 検証

- `npm run check`（typecheck/vitest/build）: 全PASS
- `wrangler d1 migrations apply DB --remote --env production`: 0001〜0005すべて適用成功
- `GET /api/health`: `{"ok":true,"data":{"status":"ok","db":"ok","environment":"production","buildRevision":"production"}}`
- `GET /`, `GET /create`: 200
- 実際にproduction上で`POST /api/invites`（secretなし）→participant参加→host confirmまで実行し、`confirmed/revision=2`まで到達することを確認
- 確認後、テスト用に作った招待は`POST /api/admin/invites/:id/expire`で失効させ、production DBに残さないよう片付け済み

## 注意事項・未対応

- 独自ドメインは未設定（`*.workers.dev`のデフォルトURLのまま）
- 監視・アラートは未設定（`/api/health`のみ）
- production用の`DEMO_ADMIN_SECRET`は他のどこにも記録していない（紛失した場合は`wrangler secret put DEMO_ADMIN_SECRET --env production`で再設定可能。既存の`/api/admin/session`ログイン済みsessionには影響しない）
- rate limitの各種上限値はハッカソンMVPの想定規模のまま（本格運用前に見直しが必要）
