# MVP Design Canvas r5 — canonical correction

- artifactId: `mvp-design-canvas-r5`
- revision: 5
- sourceRevision: 4
- status: `DRAFT_FOR_INDEPENDENT_REVIEW`
- canonicalBase: `mvp-design-canvas-r4.md`
- supersedes: `mvp-design-canvas-r4`

このr5はr4の全節を継承し、以下の節を正本として置換する。競合時はr5が優先される。P0のWho / Problem / Solution、QR → 選択/見送り → 誘い手承認 → 同一確定パス同期、状態遷移、idempotency、token保護、非目標、mock / real境界はr4から変更しない。

## Persona source correction

Nさんの具体像の正本は`artifacts/persona-vivid-r1.md`である。`docs/persona-sapporo-experience-light-r1.md`は別プロジェクトであり、本Canvasへ一切使用しない。

確認済みなのは次だけである。

- Nさんは開発者の大学の後輩で、顔を知るが名前を聞き忘れた程度の関係。
- 誘いへの反応は「まぁ、機会があれば」。
- 一人参加が難しそうだったという開発者の観察。

年齢、大学名、居住地、生活状況、イベント種別、内心は創作しない。最大障壁が入口・孤独・会話不安であることも未確認仮説のままにする。`persona-vivid-r1.md`はr4のWho / Problem / Solutionを具体的に読み上げる補助資料であり、新属性・新機能・新市場根拠を追加しない。

## Unified role session contract — replaces r4 session wording

全roleを次の共通tableへ保存する。

```text
sessions(
  id_hash TEXT PRIMARY KEY,
  invite_id TEXT NULL,
  role TEXT CHECK(role IN ('admin','host','participant')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT NULL,
  created_at TEXT NOT NULL
)
```

1. `POST /api/admin/session`が`DEMO_ADMIN_SECRET`を検証し、`admin` session cookieを発行する。
2. `admin` sessionで`POST /api/admin/demo/reset`を実行すると、旧invite tokenと旧host/participant sessionを失効し、新invite tokenと`host` session cookieを発行する。
3. `/host/demo`、`GET /api/host/demo`、`POST /api/host/confirm`はすべて`host` session必須。`admin` sessionやinvite tokenだけではhost操作できない。
4. `/admin`とdemo resetだけが`admin` session必須。
5. invite token交換は`participant` session cookieを発行し、tokenなしURLへ303 redirectする。

全cookieはstagingで`HttpOnly; Secure; SameSite=Strict`、期限付き。DBにはsessionのSHA-256 hashだけを保存する。

### Pre-auth and post-auth rate control

- session発行前の`POST /api/admin/session`は、D1固定bucket `admin-login:<deployment>`で10分10回。secret、生IP、入力値はbucket keyへ保存しない。超過は429 + `Retry-After`。
- 発行後のdemo resetはadmin session hash単位で10分10回。
- participant respondとhost confirmはr4どおりinvite単位で各10分5回。

## Scope freeze — replaces Should / P1

到着・合流、新規招待作成、通知、接続状態の追加は今回すべて`Later`へ移す。P1は設けない。実装対象は、seed済みQR → 選択/見送り → 誘い手承認 → 同一確定パス同期だけである。

## Evidence handling — replaces QR evidence wording

- 有効なQRをスクリーンショット、録画、成果物、発表スライドへ保存しない。
- E2E中はその場でQR読取成功を確認し、token文字列を含まない操作ログだけを残す。
- E2E後にadmin resetを実行し、旧invite tokenが410になることを確認してから、旧QR画像を証拠として保存できる。
- reset前に撮影が必要な場合はQR全体を復元不能にぼかし、読取不能を確認する。文字列だけを隠す対応は不合格。
- 管理secret、session cookie、token、正確な待合せ情報はログ・画像・録画へ残さない。

## Revised P0 acceptance evidence

r4のAcceptance 1〜9を維持する。Acceptance 10だけを次へ置換する。

10. 独立クライアント2つで90秒導線を完了し、両画面、3秒以内の反映、再読込、D1 state/interactions、409/429/410を保存する。有効QRは保存しない。admin reset後に旧tokenの410を確認し、失効済みQRだけを証拠化する。token、secret、session、正確な場所は伏せる。

## Revised absolute timebox

- 14:55: r5独立再確認と本人承認。未承認なら実装開始しない。
- 15:05: 要件・UI・環境を凍結。
- 15:35: P0 local導線を終了。未達ならUI装飾・補助状態を削る。
- 15:45: 新機能を凍結し、staging・独立2クライアントE2E・fallbackだけにする。
- 16:00: 実装を終了し、16:15まで発表に固定する。
- P1はなく、時間は延長しない。

## Gate request

正しいpersona資料だけを採用し、session契約、pre-auth rate、P1削除、失効後QR証拠化、絶対時刻を統一した。r4と本r5を正本Canvas packageとし、独立再確認と本人承認までは実装を開始しない。
