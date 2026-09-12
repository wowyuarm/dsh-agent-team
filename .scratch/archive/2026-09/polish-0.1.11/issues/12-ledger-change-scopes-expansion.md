# 12 — ledger change-scopes 的 Thread/Channel 展开收成一处

**What to build:** 「一条离场 operation 要失效哪些 scope」里的 Thread/Channel 展开只有一份实现；
member-archived 与 channel-member-removed 不会一个去重、一个忘去重。
**Blocked by:** 11（先定格式，再动实现；若 11 被否决则本条可独立进行）
**Status:** complete（2026-09-12 本轮实施）

**删/并什么：** `packages/agent-team/src/ledger.ts` 的 `changeScopes` 里，
`team/member-archived` 分支（约 1586–1599）与 `team/channel-member-removed` 分支（约 1602–1616）各有一份同构展开：
用 `channelByTask` 把 activity 的 taskRef 映射到 channelRef，逐 activity push thread scope，再按需 push 去重后的 channel scope。
抽成一个私有 helper（输入 activities、task→channel 映射、初始 scopes，输出补全后的 scopes）。

**证据（2026-09-12）：** jscpd 在 `ledger.ts` 报了这对 clone（11 行/85 tokens）。
两处今日逐行相同（含 `!scopes.some(scope => scope.kind === 'channel' && ...)` 这段去重），
差异只在初始 scopes：member-archived 从 `[workspace]` 起，channel-member-removed 从 `[workspace, channel]` 起。

**删除标准：** 私有方法，不改 operation 形状。这正是 `packages/agent-team/tests/change-scopes.spec.ts`（216 行）
存在的目的——它按 operation 种类断言失效 scope 集合，是现成的等价性判据。

**预期净减：** ≈ −9 行

**风险 / 需要契约判断的点：** 低—中。真正要小心的只有初始 scopes 的差异：
把初始 scopes 作为参数传入、并保持去重检查作用于完整列表（含初始项），语义即等价。
不要顺手把 `team/channel-member-added` 等不含 activity 展开的分支也塞进同一 helper——那会让签名变形。

**验证：** `npm test`（`change-scopes.spec.ts` 为主）+ `npm run typecheck`

- [x] 两个分支共用同一展开 helper（`withReleasedActivityScopes`），初始 scopes 仍各自传入
- [x] `change-scopes.spec.ts` 全绿（按 operation 种类的 scope 集合不变）

**实施记录（2026-09-12）：** 签名为 3 参数（scopes / tasks / activities），去重检查仍作用于含初始项在内的完整列表；
`channel-member-added` 等分支未塞入。jscpd 该处 clone 消失。
