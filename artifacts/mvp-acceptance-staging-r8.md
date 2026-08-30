# MVP Acceptance Review r8 — staging

- reviewer: independent acceptance reviewer
- reviewedAt: `2026-08-29 15:17 JST`
- source: Canvas package r4+r5、requirements r6、修正後`app/`、staging Worker / D1
- publicUrl: `https://machiawase-qr-staging.frogs-share-api.workers.dev`
- overallVerdict: `CONDITIONAL`
- productionVerdict: `BLOCKED` — Canvasの非目標であり、今回の判定対象外

## 1. 結論

前回r7で公開前阻害とした主要項目の大部分は解消され、P0の価値導線はCloudflare staging上で動作している。公開HTTPS health、remote D1、role session、token交換、D1永続化、409/429/410、reset監査、interaction immutable、参加者browserと独立host cookie clientの同期を確認した。参加者画面はスマホ縦表示で、tokenなしURL上に同一の確定パスと`revision 2`を表示している。

ただし最終`PASS`には一点不足する。stagingで同一`Idempotency-Key`を使ってresetを2回送る追加試験を行ったところ、両方200だが異なる`inviteId`と`expiresAt`を返した。resetはkey必須・監査記録にはなったが、通信再送を同じ結果へ収束させるidempotencyは成立していない。requirements r6の全write共通契約と、二重resetで旧QR/sessionを意図せず失効させない安全性に関わるため、修正と再確認を条件とする。

実在Nさん本人が一人参加を最大障壁と感じていること、このサービスで参加・来場・安心が改善することは未検証の価値仮説である。staging動作PASSと人物への効果検証を混同しない。

## 2. Review matrix

| 観点 | 判定 | 証拠 |
|---|---|---|
| P0 Value | `PASS` | QR招待 → 名前・理由なしの同行範囲選択 → 誘い手の待合せ承認 → 同一確定pass、という一本の導線がstagingで成立。declineも理由・再勧誘なしで終端。 |
| Who / Problem fidelity | `PASS` | UIは「イベント情報はデモデータ」「実在Nさんへの送信・実参加は未実施」を常時表示し、persona r5にない属性や効果を創作していない。 |
| UI | `PASS` | `staging-participant-confirmed-r8.png`で390px級スマホ縦画面、役割表示、event、17:50、場所、合図、範囲、revision 2を一画面で確認。選択UI・待機・decline・error表示は実装とlocal regressionで確認。 |
| Data | `PASS` | remote D1に`confirmed/revision=2`、`expired`、role別sessions、reset/respond/decline/confirm interactionsが永続化。migrationsは`No migrations to apply`。 |
| Shared | `PASS` | browser participantと、browser storageを共有しない独立host cookie clientのstaging同期を確認。報告された反映計測は1549msで3秒以内。remote D1にもconfirmed/revision 2が残る。 |
| Safety / privacy | `CONDITIONAL` | hash-only token/session、303 tokenless URL、Secure/HttpOnly/SameSite cookie、CSP/no-store/no-referrer、state-scope guard、session-role guard、one-live-demo、interaction immutableを確認。ただしresetの同一key再送が収束しない。 |
| Error boundary | `PASS` | staging再実行でinvalid 400、wrong role 401、unknown token 404、idempotency conflict 409、reset後old token 410、rate 429 + dynamic `Retry-After`と共通error bodyを確認。 |
| Mock / real boundary | `PASS` | 実動作はstagingのQR/token/session/D1/polling。イベント値と人物役はdemo。実在Nさんの送信・参加・効果は未検証。 |
| Time / scope | `PASS` | P1を追加せず、Cloudflare Worker + Static Assets + D1のP0だけに固定。build/test/E2E/発表準備が120分枠内へ収まる構成。 |
| Demo / 90秒 | `PASS` | 公開HTTPSのcritical flowと1549ms同期が成立し、QRから確定passまで90秒内に実演可能。 |
| Public staging | `PASS` | 公開URLはHTTP/2 200。healthは`status=ok / db=ok / buildRevision=staging`。`/admin`も200でsecurity headersを返す。 |

## 3. Must対応

| Must | 判定 | staging証拠 |
|---|---|---|
| M1 seed reset / host QR | `CONDITIONAL` | reset、host session、open/revision 1、QR発行は動作。demo_key限定とone-live-demoもremoteに存在。ただしreset同一key replayは未収束。 |
| M2 独立client 4択 | `PASS` | participant join 303、tokenless participant画面、entrance/decline、role分離を確認。browser participantと独立host cookieでstorage非共有。 |
| M3 D1保存 / 3秒同期 | `PASS` | requested/entranceがhost clientへ反映。計測1549ms。remote D1 interactions/stateでも確認。 |
| M4 confirm / 同一pass | `PASS` | host confirm後、participant browserにevent、17:50、正面入口、青い丸、入口だけ一緒、revision 2を表示。remote D1はconfirmed/revision 2。 |
| M5 error / secret保護 | `CONDITIONAL` | 400/401/404/409/410/429、reset失効、immutable、security headersはPASS。reset通信再送だけが契約未達。 |

## 4. 独立再実行した証拠

秘密値、session cookie、invite tokenはレビュー出力へ記録していない。有効QRも保存していない。

### Public HTTPS / headers

- `GET /api/health`: HTTP/2 200
- response: `ok=true, status=ok, db=ok, buildRevision=staging`
- `Cache-Control: no-store`
- `Referrer-Policy: no-referrer`
- `X-Frame-Options: DENY`
- `/admin`: HTTP/2 200、CSP、no-store、no-referrer、nosniff、Permissions-Policyを確認

### Staging API / remote D1 E2E

`MEETQR_BASE_URL=<staging URL> MEETQR_ENV_FILE=./.env.local MEETQR_DB_FLAGS='--remote --env staging' sh test/local-e2e.sh`を独立再実行しexit 0。

- admin login / reset / host open
- participant join 303 / tokenless participant API
- entrance respond / same-key replay / different-payload 409
- host requested / confirm / participant confirmed revision 2
- reset後old QR 410 / old host 401 / unknown token 404
- decline / host declined / wrong role 401
- invalid enum 400 / rate 429 / `Retry-After` / common error contract
- reset interaction audit
- remote interaction UPDATE拒否

### Remote migration / schema evidence

- `wrangler d1 migrations list DB --remote --env staging`: `No migrations to apply`
- remote triggers: respond/confirm validation、transition apply、interaction update/delete拒否、invite state-scope insert/update、session role-invite insert/update
- remote index: `one_live_demo`
- raw token column count: 0
- remote interactions: admin reset、participant respond/decline、host confirm

### Browser evidence

- `artifacts/e2e/staging-participant-confirmed-r8.png`
- mobile participant view
- URL tokenは画像に含まれない
- event、meeting time、place label、signal、scope、revision 2を確認
- browser participantと独立host cookie clientの同期計測: 1549ms（実施ログの報告値）

### Regression

- `npm run check`: typecheck PASS、Vitest 4/4 PASS、production build PASS
- local E2E: 全項目PASS
- `node tests/validate-hackathon-skills.mjs`: `validated 28 hackathon skills`

## 5. 残る条件

### P0 — 最終PASS前

resetのidempotencyをinvite単位ではなくadmin reset操作単位で収束させる。

現状の`interactions`一意制約は`(invite_id, actor_role, idempotency_key)`であり、resetは毎回新しいinviteを作ってからinteractionを挿入する。そのため同じkeyでも別inviteとして成立する。staging追加試験結果は次のとおり。

- 1回目: 200 / `ok=true`
- 2回目、同一key: 200 / `ok=true`
- `sameInviteId=false`
- `sameExpiresAt=false`

推奨する最小修正は、admin reset用のdeploymentまたはadmin sessionスコープのidempotency recordを新invite作成前に検索・予約し、同じkey + fingerprintなら最初の成功結果と有効host sessionを再利用可能な形で返すことである。同key + 異fingerprintは409とする。修正後にlocalとstagingで、同じkey 2回が同じinviteへ収束し、interaction/resetが1件だけ増えることを確認する。

### 非阻害だが未証拠

- 物理カメラでのQR読取時間は画像証拠からは独立確認できない。token交換とparticipant browser導線は確認済み。
- offline中にhost confirmを再送するbrowser実測、5分polling停止後の手動更新CTAは今回のstaging証拠にない。通常の90秒critical flowは成立しているが、最終デモ前の運用リハーサルで確認するのが望ましい。

## 6. 価値仮説の扱い

技術受入が最終PASSになっても、次は未検証のままである。

- Nさん本人の主因が「入口を一人で越える不安」であること
- 「入口だけ一緒」などの選択肢がNさんの希望に合うこと
- QR招待が心理的負担を下げること
- 実際のイベント参加、来場、安心、継続参加が増えること

したがって発表では「Nさんの悩みを解決した」ではなく、「観察から立てた一人参加障壁の仮説に対して、既知の誘い手との待合せ合意を90秒で作るstaging MVPが動いた」と述べる。

## 7. Gate判定

`CONDITIONAL`

P0価値導線、公開HTTPS、remote D1、独立client同期、UI、安全境界の大部分は受入可能であり、設計へ差し戻す必要はない。reset同一key再送の収束だけを修正・再確認すれば`PASS`へ更新できる。production公開と実在Nさんへの送信は引き続き行わない。
