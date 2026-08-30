# Phase A lane contract r2

## Fixed input

- Topic: 顔を知る、たった一人の悩みを突き刺せ。
- Who: 初めての交流イベントへ一人で参加しようとしている大学の後輩Nさん。開発者は顔を覚えているが名前を聞き忘れている程度の関係。
- Observed scene: 開発者から参加を勧められたが「まぁ、機会があれば」と返し、一人で行くのは難しそう。
- Evidence status: 開発者の観察。Nさん本人への直接確認は未実施。
- Deadline: 2026-08-29 16:15 JST
- Platform assumption: public mobile-first Web, Cloudflare-first, 90-second demo.

## Research questions

1. 興味はあるのに初参加イベントへ一人で行けない学生の、直前の最大障壁は何か。
2. 現在どのような回避・代替行動を取り、どの瞬間に参加を諦めるのか。
3. 参加への一歩を生む既存手段は何で、Nさんの関係性・場面にどんな空白があるか。

## Lanes

| Lane | Output | Completion |
|---|---|---|
| research | `lanes/research/market-evidence-r2.md` | 追跡可能な重要主張、反証、unknown |
| alternatives | `lanes/alternatives/similar-services-r2.md` | 直接・隣接・手作業・何もしない比較 |
| ideation-ux | `lanes/ideation-ux/candidates-r2.md` | 5〜7案、各案のWho/Problem/Solutionとデモ瞬間 |
| platform | `lanes/platform/platform-r2.md` | 2時間で公開可能な構成とコスト・リスク |

各レーンは他レーンのファイルを変更しない。事実、仮説、unknownを分ける。採用決定はfan-in確認後の本人ゲートでのみ行う。
