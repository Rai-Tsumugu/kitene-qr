# MVP Acceptance Review r7 — local implementation

- reviewer: independent acceptance reviewer
- reviewedAt: `2026-08-29 15:09 JST`
- scope: Canvas package r4+r5, requirements r6, `app/` local implementation
- overallVerdict: `CONDITIONAL`
- productionVerdict: `BLOCKED`
- stagingVerdict: `CONDITIONAL` — 下記P0修正後にremote migration/deploy/E2Eへ進める

## 1. 結論

主要価値導線はローカルAPI上で動作している。seed済み招待のreset、token交換、参加者の「入口だけ一緒」、誘い手の承認、両者の`confirmed / revision=2`、見送り、旧QR失効までを再実行してPASSした。Who / Problem / SolutionもCanvas r5の未確認仮説とmock境界をUIに保持しており、P0価値は崩れていない。

ただし、現時点を最終PASSにはしない。公開HTTPS、remote D1、storageを共有しない独立2クライアント、実ブラウザでの3秒同期・reload・offline復帰は未確認である。また、remote migration前に直すべきD1/API契約差分がある。特にresetが全inviteを対象にすること、interaction immutable triggerとsession role/invite制約がないこと、admin sessionが要件の30分でなく120分であることは、staging前の阻害事項である。

## 2. Review matrix

| 観点 | 判定 | 具体的証拠 / 理由 |
|---|---|---|
| P0 Value | `PASS` | 参加者は登録・名前・理由入力なしで4択でき、誘い手には選択範囲と「17:50に正面入口で待つ」が現れる。確定後は両roleへevent、時刻、場所、合図、scope、revisionを同じ表示関数で出す。見送りは理由表示・再勧誘CTAなしで終端する。 |
| Who / Problem fidelity | `PASS` | UIは実在Nさんへ送信・実参加していないことを全画面上部に表示し、Canvas r5が禁じた大学名・年齢・居住地・内心を追加していない。解決効果は主張していない。 |
| Requirements fit | `CONDITIONAL` | M1〜M4のlocal API導線は成立。M5の409/429/410/404/role拒否も再現した。一方、reset idempotency/audit、admin TTL、DB制約、動的`Retry-After`、host offline再送keyなどr6との差分が残る。 |
| UI / 3秒理解 | `CONDITIONAL` | 初画面文言、4択、待機、確定、見送り、通信失敗の実装はコードで確認。スマホ向け幅・48px以上の操作部品もある。ただし、このレビューでは実ブラウザのスマホviewport、初見10秒選択、3秒polling計測、offline復帰を実測していない。 |
| Data / reload | `CONDITIONAL` | D1に終端state、revision、interactionが残ることをread-only queryで確認した。API再取得でもconfirmed/declinedが残る。双方のブラウザreload後表示は未証拠。 |
| Shared | `CONDITIONAL` | curlの別cookie jarでhost / participant role分離と共有D1反映を確認。ただし受入条件の「異なる端末または異なるbrowser profile」は未実施で、単独プロセスAPI証拠を代替PASSにはしない。 |
| Security / privacy | `CONDITIONAL` | raw token columnなし、token/sessionはSHA-256 hash、303 tokenless redirect、role別HttpOnly cookie、staging時Secure、SameSite Strict、same-origin write、no-store/no-referrer/CSP、第三者resourceなしを確認。一方、DBの防御制約とreset範囲、TTLがr6未達。 |
| Mock / real boundary | `PASS` | UIは`DEMO DATA / REAL APP`と実在Nさん未送信を常時表示。イベント値はseed demo。local動作を公開/staging動作として主張していない。 |
| Timebox / scope | `PASS` | 到着・合流、新規作成、通知、AIなどを実装せず、QR → 4択 → 承認 → 同一passに集中。buildは小さく、staging検証と発表へ移れる範囲。 |
| Demo / 90秒 | `CONDITIONAL` | API導線の手数は90秒内に収まる設計。QR読取と2端末browserの実時間証拠は未取得。 |
| Public readiness | `CONDITIONAL` | `wrangler.jsonc`のstaging D1 idはplaceholderで、このレビュー時点ではHTTPS URL、remote migration、remote secret、公開healthの証拠がない。productionはCanvas非目標のため`BLOCKED`。 |

## 3. Must対応

| Must | 判定 | 証拠 |
|---|---|---|
| M1 reset → host QR | `CONDITIONAL` | reset APIは200、host cookie発行、open/revision=1、QRをclient-side生成する。公開HTTPS上の読取は未確認。 |
| M2 別clientで4択 | `CONDITIONAL` | participant join 303、role別cookie、entrance/decline API成功、4択UIを確認。独立browser/profileは未確認。 |
| M3 D1保存 → host 3秒以内 | `CONDITIONAL` | host GETでrequested/entranceを確認し、frontendは2秒polling。実ブラウザ計測なし。 |
| M4 confirm → 同一pass | `CONDITIONAL` | confirm 200後、participantでconfirmed/revision=2。両roleは同じ`confirmedPass()`と同じseed API viewを使用。2画面実測・reload未確認。 |
| M5 安全なerror境界 | `CONDITIONAL` | 400/401/404/409/410/429と`Retry-After`をlocal E2Eで確認。ただし下記rate/retry/DB契約差分を修正し、browser offline/expiryも確認が必要。 |

## 4. 再実行した証拠

秘密値、cookie、invite tokenは出力・保存していない。

### Build / unit

`app/`で`npm run check`を実行しexit 0。

- TypeScript `tsc --noEmit`: PASS
- Vitest: 1 file / 4 tests PASS
- Vite production build: PASS
- bundle: HTML 0.52 kB、CSS 5.06 kB、JS 35.98 kB（圧縮前表示）

### Local API E2E

`sh test/local-e2e.sh`を再実行しexit 0。

- health 200
- admin login 200 / reset 200
- host open 200、participant join 303、participant open 200
- entrance respond 200
- same key + same payload replay 200
- same key + different payload 409
- host requested/entrance 200
- host confirm 200
- participant confirmed/revision=2 200
- reset後の旧QR 410、旧host session 401、未知token 404
- decline 200、host側declined、理由なし
- wrong role 401、invalid enum 400
- 5回超過後429 + `Retry-After`

### Local D1 read-only query

- `invites`に`declined/revision=1`と`expired/revision=1,2`を確認
- sessionsはadmin/host/participantをrole別に保持
- interactionsはparticipant respondとhost confirmを保持
- `invites`のraw token列は0件。token列はhashのみ

### Suite validation

repository rootで`node tests/validate-hackathon-skills.mjs`を実行し、`validated 28 hackathon skills`、exit 0。

## 5. 公開前阻害事項

### P0 — remote migration前に修正

1. **reset対象をdemo 1件へ限定する。** `worker.ts:121`は`state != 'expired'`の全inviteを失効し、`worker.ts:125`は全invite sessionを失効する。r6の`demo_key='default'`限定、`revoked_at`保持、one-live-demo制約に合わせる。現在はデモしかないためlocal導線は通るが、契約上の「全体削除・全体失効禁止」を満たさない。
2. **D1の防御制約をr6へ揃える。** migrationにはstateとselected_scopeの整合CHECK、sessionのrole/invite対応CHECK、one-live-demo index、invite transition guard、interactions update/delete拒否triggerがない。アプリ経由の正常系は動くが、DB自身が不正stateとinteraction改変を拒否できない。remote適用後の変更より、初回migration前の是正が安全。
3. **admin session TTLを30分へ戻す。** `worker.ts:95-96`は120分で、r6の30分と不一致。host/participantはinvite expiry以下にする契約も明示的に確認する。
4. **resetをidempotent writeとして記録する。** 現在のresetは`Idempotency-Key`を要求せず、reset interactionも保存しない。通信切断時の二重resetは複数inviteを発行し得る。r6のreset interaction / replay契約へ合わせる。

### P0 — staging E2Eで確認

1. staging D1を作成・remote migrationし、公開HTTPS healthとbuild revisionを確認する。
2. storageを共有しない2つのbrowser/profileでQRをその場だけ読み、選択→host反映、confirm→participant反映を各3秒以内で計測する。
3. host / participant双方でreload後もconfirmedと同一event、17:50、場所ラベル、合図、revision=2が残ることを確認する。
4. decline、offline→復帰、expiry read/write、reset後の旧participant sessionも実ブラウザで確認する。
5. 有効QRは保存しない。最終reset後に旧token 410を確認してから、失効QRだけを証拠化する。

### P1 — 最終受入までに是正

1. **rate limitの順序と返却値。** respond/confirmはidempotency replay確認より前にrateを消費するため、成功済み同一key再送も上限後は429になり得る。`Retry-After`も常に600で、次windowまでの1〜600秒というr6契約ではない。UPSERTは上限後もcountを増やす。
2. **host offline retryのkey保持。** participantは失敗中同じkeyを保持するが、host confirmはクリックごとに新keyを生成する。通信失敗後の同一key再送へ揃える。
3. 5分polling停止時の手動更新CTAを表示する。現在は停止するだけである。
4. APIの共通envelope、health body、cookie名などr6の名称差分を、要件を正本として揃えるか、実装に合わせたcanonical要件revisionとして明示する。

## 6. 判定条件

次の条件を満たしたとき、本レビューの`CONDITIONAL`を最終`PASS`へ更新できる。

1. P0のDB/reset/TTL/idempotency差分を修正し、clean local migration、`npm run check`、local E2Eを再PASSする。
2. staging HTTPSで独立2クライアントの90秒導線、3秒同期、reload、decline、offline、409/429/410を証拠化する。
3. D1 queryでhash-only、state/revision、interaction immutable、role session、pre-auth bucket非PIIを確認する。
4. 有効QR、secret、session、token、正確な場所を成果物に残していないことを確認する。

現状は価値導線を失敗として差し戻す状態ではない。`e2e-verifier`へ進む前にP0実装差分を直し、その後staging公開と独立2クライアント検証へ進めるのが最短である。
