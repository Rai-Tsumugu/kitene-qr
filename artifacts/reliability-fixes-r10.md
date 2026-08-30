# Reliability fixes r10

- 実施日: 2026-08-29
- 対象version: `a74a9446-a532-4921-ae7c-d3aecbfd5d81`
- public URL: `https://machiawase-qr-staging.frogs-share-api.workers.dev`
- 判定: `PASS_REQUESTED_FIXES`

## 受入条件と結果

| surface | client | action | expected | observed |
|---|---|---|---|---|
| participant API | curl + staging Worker | 成功write後にrate上限へ到達し、同一keyを再送 | 保存済み200を返し、rate判定しない | `participant_replay=200`、新規writeだけ`429` |
| host API | curl + staging Worker | 成功confirm後にrate上限へ到達し、同一keyを再送 | 保存済み200を返し、rate判定しない | `host_replay_bypasses_rate_limit=200`、新規writeだけ`429` |
| host UI state | Vitest | 同じinvite/revisionでconfirmを再試行 | 同一keyを再利用 | 同一object/key。revision変更時だけ新key、PASS |
| polling UI | browser / local mobile viewport | 自動poll上限へ到達 | 停止理由と手動更新を表示 | 停止表示・ボタン表示・クリック後再取得、PASS |

## 変更

- `worker.ts`: request解析・fingerprint・保存済みreplay確認をrate limitより前へ移動。新規writeだけrate bucketを消費する。
- `main.ts` / `client-state.ts`: host confirm attemptをinvite IDとrevisionへ紐づけ、通信失敗後の再試行で同じkeyを維持する。
- `main.ts` / `polling.ts`: 5分後に黙って停止せず、「自動更新を停止しました」と「今すぐ更新して再開」を表示する。
- `test/local-e2e.sh`: participant/hostそれぞれrate上限後のreplay 200と新規write 429を追加。

## 検証

- TypeScript: PASS
- Vitest: 6/6 PASS
- Vite production build: PASS（通常値150回へ復帰済み）
- local API/D1 E2E: PASS
- staging API/D1 E2E: PASS
- browser停止・再開操作: PASS
- Skill validation: `validated 28 hackathon skills`
- screenshot: `artifacts/e2e/polling-paused-r10.png`

## 境界

polling UIの5分待ちは、ローカル検証buildだけ`VITE_POLL_LIMIT=1`として時間短縮した。同じ分岐とUIを操作後、通常の未指定build（`MAX_POLL_COUNT=150`）へ戻して型検査・テスト・buildを再実行した。stagingは通常buildである。
