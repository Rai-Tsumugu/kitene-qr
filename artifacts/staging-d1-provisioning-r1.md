# Staging D1 provisioning r1

- 作成日: 2026-08-29 15:05頃
- 実行者: 補助セッション（Codexとは別）
- 位置づけ: `app/wrangler.jsonc`のstaging D1プレースホルダを埋めるための情報のみ。ファイル自体は編集していない（Codexの同時編集との衝突を避けるため）

## 実行コマンド

```
cd app && npx wrangler d1 create machiawase-qr-staging
```

## 結果

```json
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "machiawase-qr-staging",
      "database_id": "b0b91fe2-0b40-4249-b7d5-a69a1640ebea",
      "migrations_dir": "migrations"
    }
  ]
}
```

- region: APAC
- `wrangler.jsonc`は自動編集していない（`Would you like Wrangler to add it on your behalf?` に対して非対話環境のためfallback: no）

## 次にやること（Codex側 or 本人）

`app/wrangler.jsonc`の`env.staging.d1_databases[0].database_id`にある`"REPLACE_WITH_STAGING_D1_ID"`を、上記`b0b91fe2-0b40-4249-b7d5-a69a1640ebea`へ置き換える。既存の`binding: "DB"`、`database_name: "machiawase-qr-staging"`、`migrations_dir: "migrations"`はすでに正しい値なので変更不要。

置き換え後、`requirements-r6.md`のmigration適用手順（remote migration）を実行できる状態になる。

## 確認事項

- 新規作成のみ（既存DBの変更・削除は行っていない）。他のD1（`hackathon-mvp-production`、`hackathon-mvp-staging`）とは無関係。
- productionリソースの作成・変更・secret設定は行っていない（制作契約のChange boundariesにより未承認のまま）。
