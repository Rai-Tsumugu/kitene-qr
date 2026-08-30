# MVP Design Canvas independent re-review r5

- artifactId: `mvp-design-canvas-review-r5`
- sourceArtifact: `mvp-design-canvas-r5`（`mvp-design-canvas-r4`を継承した正本package）
- sourceRevision: 5
- priorReview: `mvp-design-canvas-review-r4`
- role: 独立確認役（別セッション。r4/r5・stateは変更していない）
- reviewedAt: `2026-08-29 14:55 JST`
- decision: `CONDITIONAL`
- implementationGate: `OPEN`
- nextAction: 本人が下記残存1件を受容すれば即実装着手可。受容しない場合だけ1行修正してから着手する

## 結論

review-r4が要求したA〜Dは、r5で以下のとおりすべて反映されている。

| 項目 | review-r4の要求 | r5での対応 | 判定 |
|---|---|---|---|
| A 追加persona分離 | Persona Aの仮説属性をNさん本人の事実へ格上げしない。正本を明示する | 「Persona source correction」節で`persona-vivid-r1.md`を正本と明示し、確認済み事実3点のみを列挙。年齢・大学・生活状況・内心の創作を明示的に禁止 | PASS |
| B session契約統一 | admin/host/participantを一つの契約へ統一し、`/host/demo`系はhost session必須で統一する | 「Unified role session contract」節で`sessions`共通table、role別発行経路、`/host/demo`系はhost session必須と明記。r4 Screens節の「管理session必須」表記はこの節が正本として上書きする | PASS |
| C P1期限 | 15:35以前へ統一するか、P1を削除する | 「Scope freeze」節で到着・合流を含む全P1候補を`Later`へ移し、P1自体を廃止 | PASS |
| D QR証拠 | 有効invite tokenを含むQR画像を証拠として残さない | 「Evidence handling」節で、有効QR非保存、reset後の失効QRのみ証拠化、撮影が要る場合は復元不能にぼかす、をAcceptance 10として明記 | PASS |

## 残存1件（軽微、非ブロッキング）

review-r4のA項目には「『終了時間が不明でバイトに間に合うか読めない』はC1が解かない競合障壁としてOpen questions / falsificationへ置く」という指示が含まれていたが、r5の`Open questions`節（r4から無変更）にはこの1行が追加されていない。

- 影響: 実装・API・データモデル・受入条件のいずれにも影響しない。純粋にOpen questionsへの追記漏れ。
- 対応: 次のいずれかで解消できる。
  1. r5へOpen questionsの1行追記（例：「Nさんの競合障壁として、終了時間が読めずアルバイト等の予定と衝突する可能性がある。これはC1が解かない障壁であり、最大障壁と判明した場合はProblemへ差し戻す」）。
  2. 本人がこの欠落を明示的に受容し、口頭または承認記録で「Open questions未追記のまま実装着手してよい」と記録する。

いずれのAI役も、この1文の欠落を理由に安全性・スコープ・データモデルへ影響する差し戻しを行う必要はないと判断する。

## 前回review-r4での他の懸念の再確認

- Persona混入によるWho/Problemの汚染: r4のWho/Problem本文自体は最初から汚染されておらず、r5のPersona source correction節が新規persona入力を安全に隔離している。実質的な汚染は発生しなかった。
- session/schema不一致: r5のUnified role session contractが`/host/demo`・`GET /api/host/demo`・`POST /api/host/confirm`をhost session必須へ統一し、r4 Screens節との食い違いを解消済み。
- pre-auth rate limit: r5が`admin-login:<deployment>`という秘密・生IPを含まないdeployment単位bucketを追加し、review-r4の指摘（session単位で数えられない）を解消済み。

## 維持してよい事項（review-r4から継続）

- P0の4段階導線、`confirmed | declined | expired`終端、到着・合流のP0除外。
- 短いアクセスコードを使わない方針、token交換後の303 redirect。
- 見送りを同じ強さで表示し、実名・顔画像・大学名・現在地・連絡先・自由記述を保存しない方針。
- D1永続化、2秒polling、再読込、独立client、409/429/410をstagingで検証する受入条件。
- mock / real / unverifiedの区別と、実在Nさんへの送信・実参加・production変更を行わない境界。

## 時間についての注記

`14:55`はr5独立再確認と本人承認の締切としてr5自身が設定した時刻。本レビューはその時刻ちょうどに完了した。次の締切（15:05 要件・UI・環境凍結）まで猶予が少ないため、上記CONDITIONALの1件は実装をブロックせず、本人が受容し次第ただちに実装へ進めることを推奨する。

## 再レビュー合格条件（次に何か直す場合のみ）

Open questionsへ1行追記するだけであれば、独立再確認を再度回さず、r6として1行差分を記録するだけで足りる。それ以外の新しい変更（Must/API/データモデル/認可/timebox）が入る場合だけ、独立再確認をもう一度行う。
