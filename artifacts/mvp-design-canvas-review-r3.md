# MVP Design Canvas independent review r3

- artifactId: `mvp-design-canvas-review-r3`
- sourceArtifact: `mvp-design-canvas-r3`
- sourceRevision: 3
- role: 独立確認役（Canvas作成物・stateは変更していない）
- reviewedAt: `2026-08-29 14:40 JST`
- decision: `RETURN`
- implementationGate: `CLOSED`
- nextAction: 作成役が下記必須修正を反映したr4を作り、独立再確認へ戻す

## 結論

C1と本人追加条件は、対面でQRを渡す誘いから、Nさん役の支援範囲選択、誘い手の具体的責任、両端末の同一待合せ表示まで一対一でつながっている。Nさん本人の最大障壁を未確認仮説として扱い、実名・顔画像・現在地を収集せず、見送りを同じ強さで用意し、mock / real / unverifiedを分けた点も適切である。

ただし、現在の正本には、推測可能な短い表示コードの扱い、公開create/resetの権限、bearer tokenの露出対策、状態遷移の競合規則、残り時間に対するMust範囲という実装前に解消すべき不整合がある。これらは本人がリスク受容して省略できる条件ではなく、設計の修正で安全かつ小さくできるため、`CONDITIONAL`ではなく`RETURN`とする。`BLOCKED`ではなく、r4で修正可能である。

## Gate判定

| 観点 | 判定 | 独立確認 |
|---|---|---|
| Who / Problem / Solution | CONDITIONAL | 主対象はNさんでProblemとSolutionは直結する。ただしWho欄がNさんと誘い手の二人を同列に置くため、主対象と協力者の役割を分ける必要がある。最大障壁は本人未確認という境界は維持されている。 |
| QR handoff / single demo path | CONDITIONAL | 対面QR→選択→承認→同期は一本。ただしCanvas内で「最初の10秒」が招待作成後の参加者操作を指すのか不明で、到着・合流までMustにしたことで核心がぼけている。 |
| Public architecture / data flow | RETURN | HTTPS、匿名参加、D1、2秒polling、再読込、役割別画面は成立する。一方、公開create/resetの認可と、`ParticipantSession / Room / Aggregate`相当の対応が未定義。 |
| API / state feasibility | RETURN | endpointは揃うが、状態遷移表、各actorの許可操作、revision前提、競合時応答、idempotency key再利用時のpayload不一致が未定義。 |
| Privacy / token safety | RETURN | 128-bit token hash分離はよいが、短い表示コードがアクセス権を持つなら推測耐性と矛盾する。admin tokenをURL/API pathへ継続露出する設計にも、referrer・cache・log対策がない。 |
| Must scope / remaining time | RETURN | 14:40時点で締切16:15まで約95分。Canvas記載の工程は100分を要求し、Must 5とAcceptance 10に到着・合流を残したままOpen questionsだけでP1化しており、正本内で矛盾する。 |
| Acceptance reproducibility | CONDITIONAL | clean D1、staging、再読込、409、2クライアント、DB確認まで再現可能。ただし「別クライアント」の独立条件、tokenを証拠へ残さない条件、縮小後のP0完了点を固定する必要がある。 |
| Mock / real labeling | PASS | デモデータ、実動作として検証する箇所、実在Nさん・実参加・悩み改善の未確認を明確に分けている。 |
| Phase A conditions | PASS | C1採用とQR追加を正しく反映し、需要や解決済みを断定していない。 |

## r4への必須修正

### R1 — 主対象と協力者を分ける

Whoを「初めての交流イベントへ一人で参加することを保留している大学の後輩Nさん」の一人に固定し、誘い手は`Secondary actor / 協力者`として別記する。Problemの原因は引き続き仮説とし、Solutionは「Nさんが支援範囲を自分で選び、誘い手が待合せ責任を確約する主要体験」一つにする。

### R2 — P0を「確定パスの両端末同期」までに凍結する

P0の90秒導線を次に統一する。

1. seed済み招待を誘い手が開き、対面でQRを見せる。
2. Nさん役がQRを読み、10秒以内に「入口だけ一緒」または「今回は見送る」を選ぶ。
3. 誘い手側へ3秒以内に反映され、誘い手が待合せを承認する。
4. Nさん側へ3秒以内に同じ時刻・場所・revisionが表示され、核心価値を示して終了する。

`arrived / met`、到着・合流CTA、関連API、Must 5、Acceptance 10の到着・合流部分は`Should`へ移す。staging P0が締切30分前までにPASSした場合だけ追加する。Demo path、Wow moment、State、Must / Should、Acceptance criteria、Open questionsを同時に直し、Open questionsだけに縮小条件を置かない。

### R3 — 短い表示コードをアクセス資格情報にしない

`短縮表示用コード`と`表示コードを手入力`を削除する。QRとfallback URLはいずれも同じ128-bit以上のinvite tokenを含む公開HTTPS URLにする。どうしても人手入力コードを残す場合は、短いroom code単独では入れず、別の高エントロピーsecretとの組合せと試行回数制限を設計する必要があるため、120分MVPでは採用しない。QR不調時は、画面表示したfallback URLを別クライアントへ安全にコピーして開く手順と録画を使う。

### R4 — create/resetとhost操作の認可境界を固定する

- Nさん側の参加だけをログイン不要にする。
- `/create`、`POST /api/invites`、`POST /api/demo/reset`はデモ管理者secretまたは管理session必須とし、bindingに例として`DEMO_ADMIN_SECRET`を追加する。
- resetは対象デモ招待だけを失効・再発行し、旧invite/admin tokenを即時無効化する。全体削除は禁止のまま維持する。
- hostのconfirmはinvite tokenでは実行できず、admin credentialだけに許可する。
- 公開匿名writeにはendpoint別の回数上限を定義する。Turnstileを入れない場合は、token単位・IP相当単位・時間窓のうち実装する最小方式と、429の受入条件を書く。

### R5 — bearer tokenの露出対策と期限を明記する

- invite tokenとadmin tokenをURL/API routeで役割判定する曖昧な形にせず、invite取得用とhost操作用endpointを分ける。
- admin操作は`Authorization`または`HttpOnly; Secure; SameSite=Strict` cookieを使い、`/api/invites/:adminToken/...`のようにAPI pathへadmin tokenを載せない。
- tokenをログ、例外文、analytics、スクリーンショットへ出さない。tokenを含む画面/APIへ`Referrer-Policy: no-referrer`と`Cache-Control: no-store`を設定し、第三者resourceを読み込まない。
- `expires_at`を全read/writeで検査し、失効時は詳細を返さない。demo resetでも失効させる。

### R6 — 状態遷移とidempotencyを実装契約にする

許可遷移を最低限、`open -> requested | declined | expired`、`requested -> confirmed | expired`として表にし、各遷移のactor、endpoint、要求revision、成功status、不正・古いrevision時の`409`を記載する。r4のP0では`confirmed / declined / expired`を終端とする。

`interactions`の一意制約はactorを含め、同じidempotency key・同じpayloadなら以前の成功応答を返し、同じkey・異なるpayloadなら409にする。例として`UNIQUE(invite_id, actor_role, idempotency_key)`とrequest fingerprintを定義する。Nさんの最初の有効回答を固定するなら、誤タップ修正をMVP非目標として明記する。

### R7 — 公開MVPの論理モデルと最初の一文を補う

既存の小さいD1 schemaを増やしすぎず、次の対応を明記する。

- `Room`相当: 1件の`invite`
- `ParticipantSession`相当: role別の期限付きcapability/session（実名・匿名名は保存しない）
- `Interaction`: 既存の`interactions`
- `Aggregate`相当: inviteの現在state/revisionから導出するため別tableは作らない

参加人数や公開集計を置かない理由を「たった一人と既知の誘い手の私的合意であり、他人へ共有しないため」とする。参加者初回画面には、例えば「一緒に行ってほしい範囲を選ぶと、誘い手が待ち合わせを確定します（名前や理由の入力は不要です）」という一文を正本として置く。

### R8 — 残時間を絶対時刻で再配分する

締切`2026-08-29 16:15 JST`に対し、少なくとも次の停止点をr4へ記載する。

- 14:50: r4・独立再確認・本人承認を終了。未承認なら実装開始しない。
- 15:05: 要件・UI・環境を凍結。
- 15:35: P0 local導線を終了。未達ならShouldを全削除。
- 15:45: 新機能を凍結し、staging・独立2クライアントE2E・fallbackだけにする。
- 16:00: 実装を終了し、残り15分を発表へ固定。

到着・合流は15:35までにP0 staging E2EがPASSした場合だけ着手可能とする。時間は延長しない。

### R9 — P0受入証拠を安全に再現可能にする

受入条件の「別クライアント」は、異なる端末、または少なくとも異なるbrowser profile / private contextで、sessionとstorageを共有しないものと定義する。同一profileの2タブだけではPASSにしない。証拠はQR画像、両画面、3秒以内のpolling、再読込、D1 state/interactions、409/429、期限切れ、見送りを含めるが、token・管理secret・正確な待合せ情報は伏せる。staging未確認、録画fallback、localhostはそれぞれ明確にラベルする。

## 修正不要として維持する事項

- Nさん本人の関心・最大障壁・希望支援は未確認仮説であり、需要や解決済みを主張しない。
- 「今回は見送る」「理由を答えない」を支援選択と同じ強さで提示する。
- 実名、顔画像、大学名、現在地、連絡先、自由記述を保存しない。
- 外部AI、地図、通知、認証、メール、SNS、位置追跡、知らない人同士のマッチングを非目標にする。
- QR、D1保存、polling、再読込、独立クライアント、staging HTTPSだけを実動作として検証し、実在Nさんへの送信・実参加・悩み改善を未実施と表示する。

## 再レビュー合格条件

R1〜R9がr4の各対応節へ矛盾なく反映され、P0が「QR→選択/見送り→誘い手承認→同一確定パス同期」の一本に縮小され、token・管理操作・期限・競合・rate control・証拠秘匿が受入条件へ落ちていること。その後に独立再確認を行い、`PASS`または本人が明示受容できる非安全系の`CONDITIONAL`になった場合だけ、Canvas本人承認へ進める。
