# MVP Design Canvas independent re-review r4

- artifactId: `mvp-design-canvas-review-r4`
- sourceArtifact: `mvp-design-canvas-r4`
- sourceRevision: 4
- priorReview: `mvp-design-canvas-review-r3`
- additionalInput: `docs/persona-sapporo-experience-light-r1.md` と、そのPersona AをNさんの具体シナリオへ使うという追加owner input
- role: 独立確認役（Canvas・stateは変更していない）
- reviewedAt: `2026-08-29 14:45 JST`
- decision: `RETURN`
- implementationGate: `CLOSED`
- stale: `true`
- nextAction: 作成役が新しいWho / Problem入力と残存3条件をr5へ反映し、独立再確認へ戻す

## 結論

r4は、前回R1〜R9の大部分を正確に反映した。P0はQR→選択/見送り→誘い手承認→両端末の確定パス同期へ縮小され、短いアクセスコードは削除され、participantとhostの権限、状態遷移、idempotency、rate control、mock / real境界も実装契約まで具体化された。

しかしr4作成後、ownerからPersona AをNさんの具体シナリオへ使う追加入力が届いたため、r4のWho / Problemは正本候補としてstaleになった。参照資料自身はPersona Aを「実在個人のモデルではない仮説人物」と明記しているため、20歳・札幌・道外出身・大学2年・一人暮らし・バイト前という属性や内心をNさん本人の観察事実へ格上げしてはならない。また、Persona Aには「一人で浮く不安」に加えて「終了時間が分からずバイトに間に合うか読めない」という別障壁があり、C1は後者を解決しない。ここを分離しないまま採用するとWho / Problem / Solutionの一対一対応が崩れる。

加えて、前回の正確なreturn条件に対し、管理/host sessionの用語とschema、P1開始締切、保存するQR画像のsecret性に3件の残存不整合がある。いずれも短い修正で解消できるため`BLOCKED`ではないが、Who / Problem更新と安全条件を本人受容だけで省略できないため`RETURN`とする。

## 前回R1〜R9の再監査

| 条件 | 判定 | 再確認 |
|---|---|---|
| R1 主対象と協力者 | PASS後にSTALE | r4はNさんを主対象、先輩をSecondary actorへ分離した。ただし追加persona入力を未反映のためr5が必要。 |
| R2 P0縮小 | PASS | 到着・合流をP1へ移し、90秒の終点を`confirmed`同期へ固定した。Demo、State、Must、Acceptanceも一致する。 |
| R3 短いコード廃止 | PASS | QR/fallbackとも128-bit以上のinvite tokenを使い、短いroom code・手入力コードを廃止した。 |
| R4 管理境界 / rate | CONDITIONAL | participantだけ匿名参加とし、reset/admin/hostを分離した点はよい。ただし`/host/demo`が画面節では「管理session」、API節では「host session」で、発行・保存schemaも一致しない。unauthenticatedな`POST /api/admin/session`を「管理session単位」でrate limitすることもできない。 |
| R5 token保護 | PASS | admin tokenをpathから除き、participant tokenの303交換、cookie属性、no-referrer/no-store、失効、log/analytics禁止を定義した。 |
| R6 状態 / idempotency | PASS | actor、endpoint、revision、200/409/410、終端、fingerprint、一意制約、競合更新を実装可能な契約にした。 |
| R7 論理モデル / 初回文言 | PASS | Room / ParticipantSession / Interaction / Aggregate相当と、私的合意ゆえ公開集計しない理由、初回一文を明記した。 |
| R8 絶対timebox | RETURN | 15:45を新機能凍結としながら、P1も「15:45までにP0 staging PASSなら着手」としている。15:45 PASSではP1作業時間がなく、前回指定の15:35条件を満たさない。 |
| R9 証拠秘匿 | RETURN | 独立client条件と409/429/410の証拠はよい。一方、保存対象の「QR画像」自体に有効invite tokenが符号化されるため、「tokenを必ず伏せる」と両立しない。 |

## r5への必須修正

### A — 追加personaを仮説シナリオとして分離する

Who / Problemへ次を矛盾なく反映する。

- 実在Nさんについて確認済みなのは、顔を知る大学の後輩で、誘いに「まぁ、機会があれば」と反応し、一人参加が難しそうだとownerが観察した範囲だけである。
- Persona Aの「20歳、札幌の大学2年、道外出身、一人暮らし、バイト前」は、UI文言と受入テストを具体化する仮説シナリオであり、Nさん本人の属性・発言・内心ではない。
- Persona Aの一人参加不安に関する集団数値は外部文脈であり、Nさん個人の証拠ではない。
- C1が刺すProblemは「一人で入口を越え、浮くかもしれない不安により参加を保留する」に限定する。
- 「終了時間が不明でバイトに間に合うか読めない」はC1が解かない競合障壁としてOpen questions / falsificationへ置く。これが決定要因ならC1を解決済みとせずProblemへ差し戻す。イベント所要時間機能をP0へ追加しない。
- `docs/persona-sapporo-experience-light-r1.md`にある「経験灯」「見知らぬ先客の一言」など別SolutionはC1へ混ぜない。

これにより、追加personaの具体性をデモシナリオへ利用しつつ、実在Nさんへの架空属性付与とSolution拡張を防ぐ。

### B — admin / host / participant sessionを一つの契約へ統一する

`sessions(id_hash, invite_id nullable, role: admin | host | participant, expires_at, revoked_at)`のようなrole共通tableへ統一するか、各role tableを明示する。最小案では次を正本にする。

1. `POST /api/admin/session`がadmin cookieを発行する。
2. admin sessionでdemo resetすると新invite tokenとhost sessionを発行する。
3. `/host/demo`、`GET /api/host/demo`、`POST /api/host/confirm`はいずれもhost session必須とする。
4. `/admin`とresetだけをadmin session必須とする。
5. reset時は旧host/participant sessionとinvite tokenを失効する。

また、session発行前の`POST /api/admin/session`はsession単位で数えられないため、deployment全体の固定bucketなど、secretや生IPを保存しないpre-auth bucketを定義する。発行後のresetはadmin session hash単位でよい。

### C — P1着手期限を15:35へ直すかP1を削除する

Should節とAbsolute timeboxの両方で、「到着・合流は15:35までにP0 staging E2EがPASSした場合だけ着手」に統一する。15:45は新機能凍結なので、15:45 PASS後にP1へ着手してはならない。残時間を優先するならP1を完全削除しても合格とする。

### D — QR証拠は失効後保存または視覚的に無効化する

Acceptance 10を次のいずれかへ固定する。

- E2E後にresetして旧invite tokenが410になることを確認してから、旧QR画像を証拠として保存する。
- 保存画像・録画ではQR全体を復元不能にぼかし、別に「その場で読取成功した」操作ログをtokenなしで残す。

文字列だけを伏せてもQRからtokenを復号できるため不十分である。有効QRを成果物、スクリーンショット、録画、発表スライドへ残さない。

## 維持してよい事項

- P0の4段階導線、`confirmed | declined | expired`終端、到着・合流のP0除外。
- 短いアクセスコードを使わない方針と、token交換後の303 redirect。
- 見送りを同じ強さで表示し、実名・顔画像・大学名・現在地・連絡先・自由記述を保存しない方針。
- D1永続化、2秒polling、再読込、独立client、409/429/410をstagingで検証する受入条件。
- mock / real / unverifiedの区別と、実在Nさんへの送信・実参加・production変更を行わない境界。

## 再レビュー合格条件

A〜Dがr5へ反映され、実在Nさんの観察、仮想Persona A、外部集団根拠が混同されず、C1が解かない時間不確実性が明示されること。session発行・保存・認可の語彙が一致し、P1条件が15:35以前となり、保存証拠から有効QR tokenを復元できないこと。これらを満たせば、技術設計は本人承認へ出せる水準になる。
