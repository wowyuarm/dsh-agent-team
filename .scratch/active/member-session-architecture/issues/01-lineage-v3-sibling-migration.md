# 01 — lineage 内存量 session 的包内自动迁移（v3 兄弟）

**What to build:** 安装/升级 0.1.10 后，无需任何用户手动动作，每个 enabled 成员的当前会话与全部 lineage 祖先中**因我们写入的自定义 source kind 被拒**的 artifact 恢复可读（真实 persistence API 验收）；一个此前「unavailable」的受影响成员在迁移完成后恢复可用。v0 原件字节不变。

**Blocked by:** None — can start immediately（转换逻辑的验证输入：Vera 的迁移探针 + Aster 的 P2 端到端实验，真实 artifact 上 READ-OK）

**Status:** complete（2026-09-11，真实存量全机验证见文末证据）

**发布条件：必须与 02 同批发布（0.1.10）。** 01 单独上线只把 parent 变可读，而当前世代里「纯 legacy 形状、零 handoff boundary」的会话（本机 Tars/Cole）会被 `reconstructMissingHandoff` 二次注入同一份 handoff——02 的幂等守卫是同批的安全阀（引信机制见 `materials/duplicate-handoff-fuse.md`）。

范围（2026-09-10 实验后修正）：**只修 B 类**（自定义 source kind → 准入形状）。E 类（turn/start 未闭合）经实验证实**无插件侧机械路径**——拒绝发生在 v1→v2 迁移审计，该审计要求 seq 严格递增，合成修复行无法物理插入（`SessionFormatError ... seq gap`）；E 类 artifact 保持原样并记诊断日志，可用性由 02 的 fail-open 兜底，完整修复属上游责任（机制见 materials/upstream-admission-facts.md）。可读但带惰性 envelope 的会话（本机 11 个已救当前会话）：检测并记日志，metadata 重写**本轮不做**（可用性无碍，仅历史浏览降级）。D 类（已归档成员）不在目标内。

- [x] 迁移遍历每个 enabled 成员的完整 lineage（会话 header 的 parentSession 链 + 当前会话），不依赖激活路径触发，且在成员激活前执行（无写租约窗口）
- [x] 对每个被拒 artifact：经 `SessionFormatUnsupportedError.location` 拿物理路径 → 读原始 v0 → B 类改写 source 形状 → catalog 内存全量校验 → 写 v3 兄弟；v0 字节不变（前后 sha256 对照）
- [x] E 类（transform 无命中或校验仍拒）：不动文件，记诊断日志
- [x] 迁移后经真实 persistence API 复验（open+read）才算成功
- [x] 单个 artifact 迁移失败只记日志并继续，不阻塞其它 artifact 与成员激活（单测覆盖「walk 越过被拒 artifact 继续修祖先」）
- [x] 完成标记记在独立 domain（`agent_team_remediation`，不 bump `agent_team` 版本——version-mismatch 会使整个 ledger open 失败，即 0.1.2 事故形状）；标记命中条件：format 版本未变且成员当前绑定会话未变
- [x] 本机验证：全部 enabled 成员 lineage 经真实 persistence API 逐个读取。口径修正：**B 类「单独」拒绝清零**（44 个修复）；3 个 B+E 复合缺陷仍被拒（E 缺陷使其无法通过全量校验，按设计不动），另有 3 个纯 E 类拒绝与本插件写入无关
- [x] 幂等：对已迁移状态重跑，零写入（44→44，无新 sibling、无 `.tmp` 残留）
- [x] 单测覆盖：B 类形状改写（sections 名与 reader 契约逐名对齐）、E 类不动、v0 不变、幂等、失败隔离（fixture 用小型合成日志，不用真实用户数据）——`tests/session-remediation.spec.ts` 9 tests

## 验证证据（2026-09-11，全机真实存量，隔离副本）

方法：把 `~/.dsh/sessions` 整体复制到临时根，ledger 只读挂载（`agent_team.sqlite` read-only 解码 23 个 enabled 成员），在隔离副本上跑真实 `JsonlSessionPersistence` + 真实 `SessionRemediation.remediateEnabledMembers`，然后从每个成员的绑定会话出发沿 parentSession 链逐 artifact 用真实 persistence API 读回。

| 结果 | 数量 | 明细 |
| --- | --- | --- |
| 修复（发布 v3 兄弟） | 44 | Tars 18、Reeve 15、Vera 4、Aster 3、Ferry 2、Tome 1、Cole 1 |
| 未动：B+E 复合缺陷 | 3 | Tars `turn/start 106`、Reeve `18`、Ferry `23`（admit 后仍有未闭合 turn，proof 拒绝） |
| 未动：纯 E 类（非本插件写入） | 3 | Reeve `5`、Momo `61`、Cole `61` |
| 可读但含 legacy 形状（只记 info） | 11 | 2026-09-10 手工抢救留下的当前世代 |
| 既有 artifact 被改写 | **0** | 全量 sha256 前后比对 |
| 幂等重跑 | 44→44 | 无新 sibling、无 `.tmp` 残留 |

迁移后全机剩余拒绝 5 个（每个成员 lineage 取首个拒绝）：全部由 E 类缺陷引起，其中 2 个在 read 路径被 B 类错误遮住（admit 后才暴露 E）。**没有任何 artifact 因本插件的 source kind 而保持不可读。**
