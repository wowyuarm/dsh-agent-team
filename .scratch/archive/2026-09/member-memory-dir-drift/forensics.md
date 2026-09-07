# member: 目录漂移 — Vera 端取证记录（2026-09-07）

Task: task:907fe730（thread:7c19fe2c）。Reeve 已在 8754/8767 交付根因分析与修复实现；本文是 Vera 的独立取证层：逐条证据链与时间线重建，含对 8748 初报的一次修正。数据源：sqlite ledger（只读）、session 日志（zstd 解压）、目录 inode birth/mtime/ctime、git 历史。

## 1. 目录盘点（字节级）

`ls | od -c` 全量 codepoint：26 项 = 23 个 `member-<uuid>` + 3 个 `member:<uuid>`，无空白/控制字符目录。「空白字符文件夹」观察 = 冒号目录的终端渲染效应（Human 8737 的疑问已关闭）。

三个冒号目录：`member:93ab2850`（Vera）、`member:6e8a5b10`（Tars）、`member:7108f70d`（已归档孤儿，内容=空 scaffold，零信息）。

## 2. Vera 时间线（session ed57181a 解压重建，全文证）

关键修正：8748 初报「写入方是 Member 手工拼路径」方向正确，但漏了迁移交互。完整链条：

1. **8/31 10:43** member-added，ledger 记 colon 路径（pre-fix 代码 `dshHomePath(..., memberId)`），Host mkdir colon v0。
2. **8/31–9/6** b581cf25 会话 6 天内 60+ 次 memory/notes 操作**全部走 colon 路径且全部成功**——colon v0 一直是我的实际工作记忆目录（bash/edit/read 全链）。为什么模型会拼 colon？注入块给的是 hyphen 绝对路径，但模型 60+ 次选择了 colon 形态（从身份 ref `member:93ab…` 推导），无一被拦截。
3. **9/6 19:59** 8a4c4e9 落地（sanitize + 激活迁移）。
4. **9/6 21:46 / 22:05**（ed57181a 内）：windows note 追加 + memory.md 编辑，仍走 colon，成功（迁移尚未发生——Host 未重启过）。
5. **9/7 16:16** Host 重启（当前 PID 78358 启动时刻）→ activateMember → `migrateLegacyMemoryDirectory(colon v0 → hyphen)`（hyphen 当时不存在，rename 原子完成，inode birth 保留 8/31 10:43 = 现在观测到的 hyphen birth）。**全部 6 天记忆（含 21:46 追加）无丢失地进了 hyphen**。
6. **9/7 19:15:31** 会话 ed57181a 末尾（rollover 前 3 分钟）：我写 context-self-management note 又用了 colon 路径 → **write 工具照办，colon v2 新建**（dir birth = 写入秒）。这是当前 colon 目录的全部来源。
7. **19:15:41** 同会话读 colon memory.md → ENOENT（colon v2 里没有）。
8. **19:16 / 19:17:39** 我自己纠正到 hyphen 路径完成 memory.md 索引更新与重写（8382 用 hyphen，hyphen memory.md birth=19:17:39 因为 write 工具重建 inode）。

**机制结论**：修复的迁移只处理「ledger 记录的 legacy 路径」一次性 rename；模型在迁移后**再次**自建 colon 目录时，无任何机制发现/合并/拦截。漂移源=模型行为（从 branded ref 推导路径），放大器=三拼写并存（身份 ref colon / 磁盘 hyphen / skill provider `member-private:`）且注入块未声明映射规则。

## 3. Tars 时间线

- colon 目录 birth 9/7 08:40:24，单文件 accepted-task-context-guidance.md（3403B，早版）。
- hyphen 同名 note 10:44（5567B，后续修订版）。
- 独立 diff 结论：hyphen 版是超集+更新（follow-up fixes 三条全在），但 colon 版有 3 个小事实未进 hyphen：`vitest -t filter 会跑整个 file hooks` 的提示、`cold-replays a legacy plain accept` 证据测试指针、（已过时的）381 计数与 task in_progress 状态。前两条是否值得合并由 Tars 定。

## 4. 7108f70d 孤儿

added 8/28 13:14:18（handle "4"，测试成员），member-archived 9/2 15:55Z。archive 语义保留私有记忆；该成员修复后从未激活 → 迁移从未跑。内容=空 scaffold（195B memory.md 骨架）。零信息，清不清由 Human 定（Reeve 8754 L3 同结论）。

## 5. 验证口径（对 claim:02779dc4 的验收面）

- **孪生迁移判别**：不带 ledger legacy 记录、仅磁盘 colon 孪生的 fixture 必须走合并迁移（现有测试 3690-3694 只断言 sanitize 名与 ledger-legacy 迁移，覆盖不到此面）。
- **内容保全**：迁移后 sanitized 目录须含 colon 孪生的全部文件（我的场景：context-self-management.md 必须出现在 hyphen notes/）。
- **冲突语义**：同路径文件双版本时的胜出规则需显式（colon 新 vs hyphen 旧，按 mtime？按 sanitized 胜？测试断言写死）。
- **幂等**：二次激活不重复迁移、不丢已合并内容。
- **注入块**：映射规则声明出现在 renderMemberMemory 文本里（member-context.ts 的测试面）。
- **本机收尾验证**（迁移代码合入并重启后）：`member:93ab2850` 目录消失、note 出现在 hyphen、memory 索引指向有效路径；Tars 侧同查。

## 6. 待办

- [ ] 等 claim:02779dc4 实现 → 按 §5 验收
- [ ] 本机数据收尾：我的 note 迁移（若代码修复先到则由迁移接管；否则手工 mv + 删空壳）
- [ ] Tars 确认 colon 版 3 个小事实的处置
- [ ] Human 定 7108f70d 孤儿清理

## 7. 预审记录（2026-09-07 20:00–20:05，对 WIP 工作树）

- **Blocker（已实测红）**：`mergeDirectoryContents` 的 rename+EEXIST/ENOTEMPTY catch 在 POSIX 是死代码——rename(2) 静默替换已存在目标。判别测试冲突断言红：`memory.md` 收到 'twin fact' 而非 'live root fact'（twin 覆盖 live）。全套件 78/79，唯一红=该断言。修复=rename 前显式 stat 探测目标。
- 其余预审通过：twinMemoryDirectoryPath regex 守卫（非 identity 段不映射、大写不匹配）；注入块文本（member:<uuid> → member-<uuid> + never derive + not writable on every platform）；判别 fixture（仅磁盘孪生、无 legacyPath）；幂等二跑；嵌套 skills 保全；twin 目录删除。
- member-context.spec 新断言：映射规则两句文本存在性。
- 修复后验收面：vitest 全套件 + typecheck + oxlint；本机重启后收尾检查（member:93ab2850 消失、note 在 hyphen、索引有效）。

## 8. 终审记录（2026-09-07 20:10，20:12 amend 后更新）

- commit **5f64fbf** `fix: merge hand-created colon twin memory directories on activation`（4 files +148/−2）。
- 判别测试实战抓到真 bug：POSIX rename 静默替换目标 → 原 EEXIST/ENOTEMPTY catch 死代码 → twin 覆盖 live（我预审发现并实测红：expected 'live root fact' / received 'twin fact'）。修复：stat 探测 + `.colon-twin` trace 名。红转绿。
- 独立复跑：全套件 419 passed / 1 skipped；typecheck 0；oxlint 0。
- 终审通过项：判别 fixture（仅磁盘孪生）、冲突语义（live 胜 + trace 副本）、内容保全、幂等、twin 目录删除、helper regex 守卫。
- 开放项（Human 8789）：注入块两句 prompt 文本建议砍到只留 never-derive 短句（或全删）——行为面不影响验收，文本定稿后跑 member-context.spec 断言更新即可。
- 本机收尾验证：等 Host 重启后查 `member:93ab2850` 消失、note 原名迁入 hyphen、索引有效。同时是修复真实数据首战。


## 9. Amend 后终审更新（20:12，commit 6308832）

- Human 8789 拍板 prompt 全删 → Reeve amend：单 commit 6308832，只剩 member-runtime.ts + member-lifecycle.spec.ts（2 files +136/−1）；member-context.ts 恢复原样。
- 独立复跑：418 passed / 1 skipped、typecheck 0、lint 0。终审维持通过。
- prompt 文本项移入 Human 决策记录（取舍：机制兜底 vs 常驻 token；复发代价=一次多余重启周期）。
- 待办剩一：Host 重启后本机收尾验证（member:93ab2850 消失 / note 原名迁入 / 索引有效）。
