# Member auto-compaction 复发诊断(1127012 后仍报 "compaction is unavailable in the Member scope")

- 状态:**修复已实施**(commit 2aa5130),待 operator 在 web-dev 验收
- 最后核对:2026-08-28

## 修复内容(全部在 packages/agent-team)

1. `auto-compaction.ts`:coordinator 新增 `reactivate` 依赖;`compactionForAgent` 返回 undefined 时先做一次原地重新激活并重试,仍失败才落终态诊断(至多一次,无重试风暴)。
2. `index.ts`:
   - `reactivateMember`:dispose 旧 handle(清掉过期的 compaction 错误)→ `activateMember` 同 session resume,重建绑定与工具;全程走 `enqueueLifecycle` 串行化。
   - `memberStatus` 用 `agentPresets.composedPreset()` 探测孤儿成员,呈现 `error` presence 与可行动的诊断文案。
   - `recoverMember` 遇到孤儿成员时执行完整重建(旧逻辑只是 steer 一条消息,对工具已丢失的成员无效)。
3. 测试:coordinator 自愈/失败边界 ×3(单测);member-lifecycle 集成用例(孤儿探测 + recoverMember 重建,真实 preset 挂载与 resume)。已知代价:重新激活会 dispose agent,Web Client 会把同 id Session 标记为不可用直到重新打开——与已上线的 suspend/resume 循环相同。

## 验收方式

- `npm test`、`npm run typecheck`、`npm run lint`、`npm run build` 全绿(commit 2aa5130)。
- web-dev:`npm run build` 后重启 Host;对报错成员点"恢复"应原地重建(工具与 compaction 解析恢复)。之后再发生 bundle 行热重载,成员下次越过 200K 阈值时会自动自愈而不是终态报错。

## 遗留(未纳入本次)

- 非 compaction 路径的孤儿成员(未越过阈值)只能靠状态提示 + 人工恢复;可选后续:宿主在投递/激活等触点做更普遍的孤儿自愈。
- 生产触发器的精确定位(20:10 lib 重建后 HMR 对 bundle 行的 reload 选择)需要 Host stdout 日志才能重构;机制本身已由本目录脚本复现,不再阻塞。

## 根因(已复现验证)

## 根因

**Bundle 插件行(roster 子树)在运行中被 teardown 重建后,已激活成员的 preset standing mount 变成孤儿,`serviceFor(agent,'compaction')` 永久解析失败;coordinator 把它当成终态错误写进成员状态。**

完整因果链(全部经 `repro-reload.mts` 复现验证):

1. `team-member` preset 的 standing mount 挂在 roster 插件(`preset-roster.ts`)自己的 fiber 子树下(`ensureStanding` → `createScope(this.selfCtx, key)` → `mountPreset`)。
2. roster 子树被 dispose 再重建(HMR 对 loader 管理的插件行的 reload、配置热更新等都会产生这个效果)时,standing scope fiber 随之被 dispose。
3. `standingMountFor` 内部的 `pruneDisposedMounts()` 剪掉 disposed mount 记录;老 agent 的 scope-parent 绑定指向已死的 standing key。
4. 于是老 agent:`serviceFor → undefined`(报错)、`composedPreset → undefined`、`ctx.tools.schemas → 0`(工具同样丢失——成员表面还能对话,实际已废)。
5. reload 之后激活的成员一切正常——这解释了为什么只有个别成员报错、其他成员看起来没事。
6. `auto-compaction.ts` 的 coordinator 对 `engine === undefined` 走 `fail()` 终态:pending 删除、错误粘到下次人工 accept。

## 生产时间线(证据)

- 17:59:49 web-dev Host 启动(内存扫描确认加载了 1127012 修复后的代码,`compactionForAgent` 标识存在)。
- 20:10 `npm run build` 重建了全部 `lib/**`(所有文件 mtime 重写)→ web-dev profile 挂载的 `cordis-plugin-hmr`(root `.`)对 bundle 行产生 reload;roster 子树被 teardown(Host 进程内存中无 `?t=` 形态 URL,reload 的具体选择机制无法从外部重构,但机制本身已复现)。
- 20:46–20:47 local 一批 human accept;Builder(pressureTokens 204,705 > 200,000)首次越过阈值 → 走 `engine === undefined` 分支 → 报错截图。
- Builder 会话日志(Aug 28)无任何 `compaction/*` 事件:修复部署后生产从未成功执行过自动 compaction。
- 静态基线(`repro-team-compaction.mts`):真实 team-member preset、create 与 resume 路径,`serviceFor` 均解析成功——机制正确,问题只在 teardown 后的状态。

## 复现/验证

```sh
cd ../deepseek-harness && node --import tsx \
  ../dsh-agent-team/.scratch/active/member-compaction-diagnosis/repro-reload.mts
# 期望输出:
#   before dispose: resolved
#   after reload: OLD agent => UNDEFINED  <-- BUG REPRODUCED(同时 tools=0, composedPreset=undefined)
#   after reload: NEW agent => resolved
```

`repro-team-compaction.mts` 是基线回路(机制正确性验证,含 resume)。脚本会临时使用本仓库 `node_modules/@deepseek-ai/*` 下 2026-08-28 21:42 创建的、指向相邻 Harness 检出的 symlink(gitignored,可整体删除重建)。

## 修复方案(全部落在 packages/agent-team)

1. **自愈**:coordinator 在 `compactionForAgent` 返回 undefined 时不再终态失败——重新走一次成员激活(`handles` dispose + `activateMember`,同 session resume,重建全部绑定与工具),然后重试一次 compaction;仍失败才落终态错误。
2. **主动探测**:`memberStatus` 可用 `agentPresets.composedPreset(handle.agent.ctx)` 识别孤儿成员(现为 public API),呈现"需要重新激活"状态或在使用前主动自愈。
3. **集成测试**:`repro-reload.mts` 场景转正(旧 agent 在 reload 后必须能通过自愈恢复解析),堵住 1127012 只测 mock 的缺口。
4. 运维侧即时缓解:重建 lib 后重启 Host(现有"先 build 再重启"纪律),或对报错成员重启会话。

## 结束条件

- 修复 + 集成测试合入;结论写入 commit message;`docs/` 如涉及工作流(重建与热重载的行为说明)再补充。
