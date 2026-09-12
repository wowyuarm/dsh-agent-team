# 11 — spec.ts 四个「离场快照」数据形状收成一个字段对象

**What to build:** 四种离场操作（member-removed / member-archived / channel-member-removed / channel-archived）的 data 里，
「released claims + activities + tasks + threads + inbox」这五个字段只定义一次；持久化格式的这条共同点变成显式事实而不是四处巧合。
**Blocked by:** None — can start immediately（建议最先做，因为 12–15 项都读同一份格式定义）
**Status:** complete（2026-09-12 本轮实施）

**删/并什么：** `packages/agent-team/src/spec.ts` 中四个 operation schema 的 `data: z.object({...})` 各自列出
`claims: z.array(claimSchema)`、`activities: z.array(claimsReleasedActivitySchema)`、`tasks: z.array(taskSchema)`、
`threads: z.array(threadSchema)`、`inbox: inboxDeltaSchema` 五个字段（约 300–330、370–400、484–505 等）。
抽成一个共享的字段对象常量，四处用展开复用，各自只保留自己的独有字段（`member` / `workspaceId` / `channelRef` / `memberId` / `channel`）。

**证据（2026-09-12）：** jscpd 在 `spec.ts` 报了 4 处 clone（12–14 行、71–89 tokens），正是这四段 data 形状的互相重复；
`grep -c "...operationBase,"` = 24，说明这个文件整体就是「同一外壳 × 24」的声明式结构。

**删除标准：** 这是**持久化格式定义**，所以归 B 桶，但它本身是纯字段复述、无逻辑：
四处 data 的这五个字段今天逐字相同，抽出来不改变任何校验行为。
覆盖在 `packages/agent-team/tests/update-operations.spec.ts`（234 行，逐操作 schema 断言）
与 `agent-team.spec.ts` 的冷重放（`replayLedger(...).validate()`，会真正走一遍旧记录解码）。

**预期净减：** ≈ −15 行

**风险 / 需要契约判断的点：**
- 必须保留每处的 `.strict()`，共享字段对象只是被展开进各自的 `z.object`，不能引入一个「更宽松的外壳」。
- 四个 schema 的 `kind` 必须仍是各自字面量（`z.literal('team/member-removed')` 等），否则 discriminated union 的
  类型收窄会退化——这是本项唯一真正危险的地方，改完 `npm run typecheck` 必须干净。
- **不要顺手做整个文件的外壳去重**（`...operationBase, previousOperationId, kind` 那 24 处）：一个通用的 `operation(kind, data)`
  helper 会让 `z.literal` 的类型变宽、丢失 union 收窄，属于「看起来能删但不该做」，见 `KEEP-decisions.md` §5。

**验证：** `npm run typecheck` + `npm test`（`update-operations.spec.ts`、`agent-team.spec.ts` 冷重放）

- [x] 四个离场 schema 的五个共同字段只有一处定义（`releaseSnapshotFields`），各自 `.strict()` 与 `kind` 字面量不变
- [x] 冷重放旧记录解码行为不变（`agent-team.spec.ts` 冷重放、`update-operations.spec.ts` 全绿）

**实施记录（2026-09-12）：** 只合并了五个共同字段；两个 `member` 形状的 `data` 对象**故意不合并**——它们属于不同 operation kind，
耦合它们会把两种离场格式绑在一起，违背本项「共同点变显式事实」的初衷。jscpd：`spec.ts` 4 处 clone → 1 处。
