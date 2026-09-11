# 02 — replayCarriedInput 对格式拒绝类的 fail-open 硬化

**What to build:** 一个成员的上一代 session 因确定性格式拒绝（上游封闭白名单/结构审计拒绝）读不出时，成员仍能激活并可用（日志记录跳过原因）；因 IO/未知错误读不出时行为不变（激活失败并报错）。这是 01 迁移完成后的最后防线：两者共同保证「读不出祖先 ≠ 成员不可用」。

**Blocked by:** 01 — lineage 内存量 session 的包内自动迁移（v3 兄弟）（顺序上先有恢复路径再关防线，避免迁移未跑完时的空窗；若 01 交付节奏允许可并行开发、按序合入）

**Status:** complete（2026-09-11）

**发布条件：必须与 01 同批发布（0.1.10）。** 01 会让此前读不出的 parent 变可读，从而打开下面「重复 handoff 投递」这条引信；本 ticket 的幂等守卫是同批的安全阀。

背景：`replayCarriedInput` 是 issue #13（归档 Channel 破坏重启）修复引入的崩溃恢复路径；其 fail-closed 是有意设计——绝不静默丢成员输入。本 ticket 只把「重试无意义的确定性格式拒绝」（`SessionFormatUnsupportedError` 类，含其迁移审计变体）改为警告 + 跳过，保持 #13 的不丢输入意图（这类拒绝不是可重试的 IO，重试只会永远失败）。

- [x] 区分错误类：上游格式拒绝（unsupported migration / closed-whitelist）→ 警告 + 跳过；`corrupt session log` 现有豁免保持；其余（IO/未知）→ 维持 throw
- [x] 日志文案包含成员、被拒 session id、拒绝原因，供诊断（断言 warning 同时含 previous session id 与成员 handle）
- [x] 单测：格式拒绝 → 成员激活成功且日志含跳过记录；IO 错误 → 激活失败（现状保持）。真实激活路径集成测试：`fails open with a warning when the previous Session is refused by the session-format migration` + 既有的 corrupt / ENOENT 两条对照
- [x] 与 01 的组合验证：迁移后 replay 走正常读取（01 的全机 E2E：44 份祖先发布 v3 兄弟后全部可读，replay 不再撞拒绝）；人为留一个不迁 artifact 时成员仍可用（集成测试用被拒的前代直接覆盖该形状）
- [x] 重复 handoff 投递引信（Iris 实测，机制见 `materials/duplicate-handoff-fuse.md`）：`reconstructMissingHandoff` 的幂等判定从「boundary 存在」扩展为「boundary 存在**或**本世代 own events 含 legacy `agent-team-context-handoff` source」（continuation 不算）；单测覆盖「纯 legacy 形状的当前世代不重建」。守卫随 01 的 `feat:` 提交落地（同批安全前提），判定函数 `handoffAlreadyInLog` 有独立单测
