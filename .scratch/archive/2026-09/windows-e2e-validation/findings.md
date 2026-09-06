# Windows 排查发现记录（持续更新）

环境：Windows 11（10.0.26100）原生侧，PowerShell 5.1，Node v24.11.1（机器级 `C:\Program Files\nodejs`），git 2.45.2.windows.1（system autocrlf=true），LongPathsEnabled=1，非管理员、开发者模式关。被测：dsh-agent-team @ 6ca9b3b（fix/member-memory-dir-windows）+ deepseek-harness @ a66e470（dsh-v0.1.2-rc.1）。测试脚本与日志：`C:\Users\wowyuarm\src\dsh-win-test\`。

## F1（环境，已闭环验证）— 祖先 node_modules 污染导致 Harness 认证 tag 构建失败

**现象：** Harness `corepack pnpm build:lib` 的 client 段（`tsc -b tsconfig.client.json`）6 个 `*.client.spec.tsx` 共 26 个 TS2344/TS2339 错误，`build:lib` exit=2。WSL 同 tag 同命令（同 lockfile、同 TS 6.0.3、同 react 18.3.1/@types/react 18.3.31，md5 一致）通过。

**根因：** `C:\Users\wowyuarm\node_modules\`（2026-02-17 创建，含 @types/react **19.0.7**、@types/react-dom 19.0.3、playwright、@mui 等——某次在 home 下误跑 npm install 的遗留）。tsc 默认 typeRoots 沿目录树向上收集，把 React 19 类型**全局注入**每个编译单元。错误签名与 @types/react@19 完全吻合（`Promise<ReactNode>`、`ReactElement<any, string | JSXElementConstructor<any>>`、ReactPortal children 必填），而 18.3.31 中不存在这些签名（全目录 grep 为空）。

**错误原文（节选）：**
```
packages/client/ui-chat/tests/chat-view.client.spec.tsx(275,64): error TS2344: Type 'MemoExoticComponent<({ node, renderSlot, t }: CommandNodeViewProps) => Element>' does not satisfy the constraint 'JSXElementConstructor<any> | keyof IntrinsicElements'.
  ... Property 'children' is missing in type 'ReactElement<any, string | JSXElementConstructor<any>>' but required in type 'ReactPortal'.
packages/client/ui-chat/tests/chat-view.client.spec.tsx(275,88): error TS2339: Property 'renderSlot' does not exist on type '{}'.
```
波及文件：ui-chat / ui-conversation / ui-renderer(×2) / ui-trajectory / test-support/client-runtime 的 6 个 `.client.spec.tsx`。

**闭环实验：** `Rename-Item C:\Users\wowyuarm\node_modules node_modules.stray-2026-02-17.bak`（可逆）后，同机重跑 `build:lib` + `build:web` 全部 exit=0、0 个 TS 错误。

**WSL 对照：** `/home/yu/node_modules` 不存在，无此问题。

**定性：** 机器环境污染 + Windows 特有目录解析面（tsc typeRoots / node 模块解析都向上爬祖先目录）。建议：开发文档可加一条"home 目录不得有遗留 node_modules"的环境卫生项；测试工程师遇同症状先查祖先 `node_modules\@types`。

## F2（文档/环境契约）— 插件仓未钉 packageManager，文档声明的 `corepack pnpm install` 在 Node 24.11 硬失败

**现象 1：** `docs/development.md:112` 称 "both repositories pin `pnpm@11.7.0` through `packageManager`"。实际 `dsh-agent-team/package.json` **没有 `packageManager` 字段**（仅 harness 有）。

**现象 2：** 无钉时 corepack（0.34.2，Node 24.11.1 自带）取默认 pnpm **12.3.4**，加载固定失败：
```
Error: Cannot find module 'C:\Users\wowyuarm\AppData\Local\node\corepack\v1\pnpm\12.3.4\bin\pnpm.cjs'
```
原因：pnpm 12.x 包布局是 `bin/pnpm.mjs`（bin 映射 `pnpm→pnpm` 无扩展名文件），corepack 0.34.2 硬编码加载 `bin/pnpm.cjs`。显式 `corepack pnpm@11.7.0 …` 一切正常。

**影响：** 照文档在插件仓跑 `corepack pnpm install` 的 Windows/Node 24 用户必然失败；harness 仓不受影响（有钉）。附带风险：仓内 pnpm-lock.yaml 由 pnpm 11 生成，12.x 行为未验证。

**测试绕行：** `corepack pnpm@11.7.0 install`（与文档意图一致）。

## F3（环境，非管理员）— 两处构建期 `symlinkSync(..., 'dir')` 在非管理员、无开发者模式的 Windows 上 EPERM

**点 1：** `scripts/link-harness-packages.mjs:32`（开发文档六步之第 4 步）：
```
Error: EPERM: operation not permitted, symlink '..\..\..\deepseek-harness\packages\acp\acp' -> 'C:\Users\wowyuarm\src\dsh-agent-team\node_modules\@deepseek-ai\dsh-acp'
    at symlinkSync (node:fs:1879:11)
    at linkPackage (file:///C:/Users/wowyuarm/src/dsh-agent-team/scripts/link-harness-packages.mjs:32:3)
```
**点 2：** `scripts/generate-typert.mjs:27`（`npm run build` / `typecheck` / `test` 都会触发）：
```
Error: EPERM: operation not permitted, symlink 'C:\...\packages\agent-team\node_modules\zod' -> 'C:\Users\wowyuarm\src\deepseek-harness\packages\external-agent-team-pbdOBZ\node_modules\zod'
    at async symlink (node:internal/fs/promises:1009:10)
```
注意该调用是 `symlink(zod目录, 链接, 'file')` —— **type 给了 'file' 但目标是目录**（Linux 忽略 type 所以从未暴露；Windows 上 file symlink 同样要特权）。两处都在**核心构建/测试管线**上。Harness 自身的 profile 恢复逻辑（`app-boot/src/profile.ts:249-267`）已正确用 junction + 平台分支处理，说明仓库生态知道这个坑，但插件仓这两个脚本没有。

**测试绕行：** `NODE_OPTIONS=--require junction-shim.cjs` —— 按 target 实际类型重定向：目标是已存在目录 → junction（免特权、模块解析等价）；其余透传。特权环境为无害透传。已用探针验证 ESM 具名导入（`import { symlink } from 'node:fs/promises'`）同样被覆盖（Node 内建模块 ESM 门面与 CJS exports 共享对象）。junction 替代链接成功链接 258 个 Harness 包。

**附带观察：** generate-typert 的临时工作区建在 **Harness 树内**（`deepseek-harness/packages/external-agent-team-*`）——失败中断会残留到 harness 工作区（本次实测 finally 清理干净，但位置值得注意）。

## F4（附注，非缺陷）— 环境工程杂项

- Node 装在 `C:\Program Files\nodejs` 时文档的 `corepack enable` 需要管理员；非管理员用 `corepack enable --install-directory <用户目录>` + PATH 前插。（本机用 `C:\Users\wowyuarm\bin`。）
- corepack 首次从 WSL UNC cwd 调用产生 CMD "UNC 路径不受支持" 告警（仍成功）；PS 5.1 无 `try` 表达式；PowerShell 把 git 的 stderr 进度当 NativeCommandError 显示。
- git 走 GitHub 网络克隆到 /mnt/c（9p）极慢（190M 仓 15+ 分钟未完）；git bundle 单文件拷贝 138M 用时 2.3s，本地克隆秒级。Windows git system autocrlf=true → 13 个 src 文件工作区为 CRLF（对 tsc/vitest 无影响，已注意）。
- 本机 Edge + Chrome 都在；LongPathsEnabled=1；系统盘 C、数据盘 D/E。

## F5（环境/pnpm，待上游定性）— workspace 内 per-package 依赖链接在无特权 Windows 上损坏或缺失

**现象：** `corepack pnpm@11.7.0 install`（插件仓 workspace）后，`packages/agent-team/node_modules/zod` 是一个 **54 字节普通文本文件**，内容为相对路径 `../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod`（POSIX 风格正斜杠）——不是 junction 也不是目录，Node 模块解析无法穿过（仅靠向上解析到根 `node_modules/zod`（正常 Junction）兜底）。删除 node_modules 全量重装后，该条目**干脆不再创建**。

**影响：** `scripts/generate-typert.mjs:27` 显式把 `packages/agent-team/node_modules/zod` 链接进临时 workspace —— 该路径不是有效目录时构建必炸（且无特权下 `symlink(...,'file')` 本身 EPERM）。

**对照实验：** 同机同 pnpm 在**非 workspace** 最小包上 `pnpm install` 创建的是正常 Junction；harness workspace 的所有包级链接也都是正常 Junction。仅插件仓该条目异常（一次是文本文件、一次缺失）——机制未定论，可能与 workspace importer 链接的相对路径形态 + 无特权降级有关。

**测试绕行：** 手动 `New-Item -ItemType Junction packages\agent-team\node_modules\zod -Target <root>\.pnpm\zod@4.4.3\node_modules\zod`；junction-shim 同时增强为"目标若是 pnpm 文本占位文件，读取其内容解析到真实目录再建 junction"。

## F6（仓库代码，Windows bug）— `scripts/build-client.mjs` 以 POSIX 形态 spawn tsdown，Windows 必 ENOENT

**现象：** `npm run build` 最后一环 `build-client.mjs` 报：
```
Error: spawn C:\Users\wowyuarm\src\deepseek-harness\node_modules\.bin\tsdown ENOENT
```
**根因：** `scripts/build-client.mjs:13` `spawn(join(harnessRoot, 'node_modules/.bin/tsdown'))` —— 无扩展名 POSIX sh shim，Windows 上 `spawn` 无 shell 时不可执行（pnpm 在 Windows 的 `.bin` 提供的是 `tsdown.CMD` / `tsdown.ps1`）。

**对照：** WSL/Linux 侧正常。这是继 F3 的第三处平台敏感脚本（三处都不在产品运行时里，都在开发/构建面）。

**测试绕行：** `build-client-win.mjs`（同一逻辑改 spawn `tsdown.CMD` via `cmd.exe /c`，其余逐行一致）。

## 待归类（测试中确认）

- （占位）`dsh plugin add` 的 pnpm 转发在无 packageManager 钉的 profile 上是否复现 F2 — Layer 1 实测。

## F11（Harness 产品代码，Windows 竞态；插件侧已修复并 CI 验证，Harness 根修待上游）— suspend→resume 后 Member 卡 `unavailable`：JSONL 后端 win32 建目录 staging 与 list() 遍历的竞态

**对应 CI 失败：** run 34018526605 / 34018889990（windows-latest，fb8501f），`member-tool-policy.spec.ts` × "restores the same restricted surface across suspend, resume, and Host restart"，断言 :253 `expected 'unavailable' to be 'active'`。分支历史：39f7a08 上该测试在 windows 是绿的（464ms），fb8501f 两次全挂；fb8501f 的纯函数改动对 fresh member 输出不变 → 时序敏感 flake 被 worker 调度漂移触发，非该 diff 直接引入。

**真机复现（本机，暖环境）：** 210 个 suspend→resume 周期（5 轮 driver）5 次失败 ≈ **2-3%/周期**；单轮跑团队原版 spec 7/7 过 → 非确定性竞态，CI 冷缓存 + Defender 扫描把窗口拉宽数量级 → 2/2 必现。Linux 从未失败。

**Activation 失败原文（`memberFailures.activation`，经 driver 抓 `status.diagnostic`）：**
```
ENOENT: no such file or directory, scandir 'C:\Users\...\Temp\dsh-win-resume-ANVATJ\sessions\.dsh-mkdir-I3srVB'
```

**根因链（全部有代码与实测证据）：**
1. 插件 `suspendMember` → `disposeMemberSession` → `await handle.dispose()`：agent teardown 同步派发 `session/disposed`；Harness coordinator（session-persistence/src/coordinator.ts:1319）的 retire 只注册 promise **不 await**（`void retirement.then(...)`）→ suspend 返回后 flush/materialize 仍在后台跑。
2. 该 Member 的 session log 从未 materialize（add 时 sandbox/mode 事件走异步写队列，时序不定 —— 轮询显示有的周期 add 阶段就建好目录，有的周期拖到 resume 阶段）→ retire flush 走 `appendBatch(isMaterialized=false)` → **materialize** → `ensureDurableDirectoryWin32`（session-persistence-jsonl/src/win32.ts）以 "mkdtemp staging `.dsh-mkdir-*` → MoveFileExW(MOVEFILE_WRITE_THROUGH)" 方式逐级发布 project/session 目录。
3. 同一时刻 `resumeMember` → `activateMember`（插件 index.ts:1115）→ `sessionPersistence.list()` → `listProjectDirs()`（jsonl index.ts:896）`readdir(root)` 把 `.dsh-mkdir-*` staging 当 project 目录返回（`isDirectory()` 为真，无前缀过滤）→ `listSessionDirs(staging)`（:909）第二次 `readdir(staging)` 撞上 rename 已完成 → **ENOENT 直接抛出**（无容错）→ 被 activateMember catch 记入 `memberFailures.activation` → `memberStatus` 判 `unavailable`（`status.diagnostic` 有值，但团队测试没断言它，CI 日志全然不可见）。
4. POSIX 上 mkdir 是单次原子系统调用、树里不存在 staging 条目 → Linux 免疫；Windows 专属。

**轮询证据（1ms 观察者，driver 存 dsh-win-test）：** resume 阶段捕捉到根级 staging（→ project 目录）与 project 内 staging（→ session 目录）先后出现，如 cycle-32：t=7363 根级 staging → t=7365 project 目录（空）→ t=7370 project 内 staging → t=7372 session 目录出现；list() 恰在两步之间 crash。

**根因判定：真失败（Harness 产品代码缺陷），非"慢启动被当失败"，也非测试等待方式问题。** `resumeMember` 正确 await 了 activation；失败是并发 flush 与并发 list 之间的真实文件系统竞态。

**修哪一层的建议（修归团队，本侧只测）：**
1. **首选 Harness `session-persistence-jsonl`**：win32 durable-mkdir 的 `.dsh-mkdir-` 前缀是同包内契约，读者必须知情 —— `listProjectDirs`/`listSessionDirs` 过滤该前缀，或对子目录枚举 ENOENT 做单次重扫。这是根本修法：list() 还被插件 init、`membersForClient` 等更多路径调用，竞态面不止 suspend→resume。
2. 次选/可叠加 插件 `activateMember`：对 persistence list 的瞬态 ENOENT 做一次重试（窄、但掩盖语义，不如 1）。
3. 测试面改进（低成本高收益）：member 生命周期断言把 `status.diagnostic` 带进失败信息（如 `expect(x, JSON.stringify(status))`）—— 本次 CI 只给 unavailable、诊断全靠真机复现才拿到。
4. Host 侧缺口记录：coordinator 的 retirement 完成态不可等待（dispose 已 resolve 但 flush 未完），插件侧目前无法正确串行化 suspend→resume；若 1 修掉可不动。

**最小复现：** dsh-win-test/resume-race-driver.spec.ts.bak（policyHarness 复刻 + 循环 suspend/resume + diagnostic 捕获 + 1ms 轮询观察者）；证据 win-resume-evidence-final.json。跑法：放入克隆 `packages/agent-team/tests/` 改名 `.spec.ts`，`DSH_WIN_CYCLES=60 corepack pnpm exec vitest run packages/agent-team/tests/<file>`。


## F11 修复落地（2026-09-06 晚，operator 授权后在 fix 分支实施）

**分支提交（已推送）：**
- `5fb2c1a fix: tolerate the session retirement race in member activation`（packages/agent-team/src/index.ts，+29/-3）
  1. `resumeMember` 不再先走全树 `sessionPersistence.list()`，改为把已知 sessionId 作为 `knownSessions` 提示传入 `activateMember` —— resume 分支的 `agents.resume → prepare → waitForRetirement` 本身就与 retirement 串行化，这是结构性消除；同时语义更正确：日志真丢失时 fail loudly（"session not found"）而非静默重建。
  2. 新增私有 `persistedSessionHeaders()`：对 `list()` 的 ENOENT 做 4 次有界退避重试（25/50/75ms），init 全量与 `activateMember` 单查两处接入 —— 覆盖 recoverMember/reactivateMember 及其它成员并发 retirement 的残余竞态。
- `a37bfdc test: cover the member retirement race and surface diagnostics`（两个 spec，+65/-7）
  - member-lifecycle 新增 2 个确定性回归测试：① suspend 后把 `list()` 替换为必抛 ENOENT 的桩，resume 必须不咨询持久化树（钉死结构性修复，red 验证：未修复时以与 CI 相同的 `expected 'unavailable' to be 'active'` 失败）；② recoverMember 路径注入一次性 ENOENT，断言重试后 `consulted === 2` 且恢复 active。
  - member-tool-policy CI 失败断言改用 `expect(x, JSON.stringify(status))` 携带完整 diagnostic（今后 CI 失败自描述）。
  - 顺带修复 renew 测试自身的同一竞态：其"等待日志 materialize"循环内的裸 `list()` 会在全量套件下偶发 ENOENT（真机全量跑实抓 1 次，jsonl index.ts:909 listSessionDirs），同样加 ENOENT 重试。

**验证：** Windows 真机 red→green；`tsc -p packages/agent-team/tsconfig.json` 通过；全量 `vitest run`（28 文件，跳过本地损坏的 generate:typert 前置）连跑两遍 27 passed + 1 skipped 全绿；CI dispatch run 34030051849 **windows ✓ + linux ✓** —— 该分支 9 次 dispatch 中 windows 首次通过。

**Harness 根修（上游待办，插件侧无法替代）：** `session-persistence-jsonl` 的 `listProjectDirs`/`listSessionDirs`（index.ts:896/:909）应过滤 `.dsh-mkdir-*` staging 前缀或对子目录枚举 ENOENT 单次重扫；`prepare`/`loadStored` 的内部 walk 在其它成员并发 retirement 下仍有理论窗口。本次 CI 用的钉版 tag 不可随插件修复，需上游发版后随 certification 前移。
