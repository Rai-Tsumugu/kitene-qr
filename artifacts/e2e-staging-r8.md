# Staging E2E evidence r8

- 実施日: 2026-08-29
- 対象: `https://machiawase-qr-staging.frogs-share-api.workers.dev`
- deployment version: `6dd2232e-1c24-4bb7-8750-29ade2373d5a`
- D1: `machiawase-qr-staging`
- 境界: デモイベントとNさん役はmock。Worker、HTTPS、D1、token交換、role session、pollingは実動作。実在Nさんへの送信と行動変容は未検証。

## PASS

1. clean remote D1へ`0001`〜`0003` migrationを適用した。
2. 公開HTTPS healthは200で、DB接続を返した。
3. admin login → reset → host session → participant token交換303 → tokenなしURLを確認した。
4. participantの4択、入口選択、host確定、両者revision 2を確認した。
5. browser participantと別host cookieクライアントを使い、host確定からparticipant DOMのrevision 2表示まで`748ms`だった。
6. idempotent replay 200、異payload競合409、rate limit 429 + Retry-After、reset後の旧token 410、未知token 404、旧host session 401を確認した。
7. 同一reset Idempotency-Keyの再送が同じinviteId、inviteUrl、expiresAtへ収束することを確認した。raw tokenはD1へ保存せずHMACで再導出する。
8. D1でreset interactionを含む監査記録を確認し、interaction UPDATEがtriggerで拒否されることを確認した。
9. token、session、secretはログ・本文・画像へ保存していない。証拠画像はtokenなしURLかつ待合せ詳細を含まない安全なクロップだけを残した。

## 証拠

- `artifacts/e2e/staging-participant-confirmed-safe-r8.png`
- `test/local-e2e.sh`（`MEETQR_BASE_URL`とremote DB flagsで同一試験を再現可能）
- 実行ログ: reset replayを含む全assertion PASS

## 未検証

- 実機カメラによるQR読み取り。QR生成とjoin URLは実装済みだが、今回の自動E2Eはjoin URLを直接開いた。
- 物理的に別の2台のスマホ。今回はbrowser participantと独立cookieのhostクライアント。
- 実在Nさん本人の最大障壁、利用意向、イベント参加、行動変容。

## 判定

`PASS_FOR_DEMO_WITH_DISCLOSURE`。公開MVPのクリティカルフローは動作する。発表ではQR実機読取と実在Nさん効果を未検証として明言する。
