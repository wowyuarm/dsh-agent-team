# Windows 原生环境系统性排查与 e2e 测试报告

**被测：** `dsh-agent-team` @ `fix/member-memory-dir-windows`（6ca9b3b，#7 修复）× `deepseek-harness` @ `dsh-v0.1.2-rc.1`（认证 tag，a66e470）
**环境：** Windows 11（10.0.26100，26100.9168）原生侧，PowerShell 5.1，Node v24.11.1（机器级），git 2.45.2.windows.1（system autocrlf=true），LongPathsEnabled=1，**非管理员、开发者模式关闭**；Edge 与 Chrome 均在。WSL2 仅作驱动（interop 执行 PowerShell/Node、经 /mnt 与 9p 读写证据）。
**结论速览：** #7 修复在原生 Windows 上**回归全过**（新成员目录净化、ledger、重启持久、旧账本迁移）；安装/构建/测试链暴露 **10 项 Windows 专属发现**（2 项产品代码级：F8 修复代码的 Windows-only 崩溃分支、F10 长路径下误导性失败；其余为开发/测试链的平台假设）；**#8 的冒号类别在真实环境复现**（0 字节 payload + ADS 数据丢失），保留名/尾点类别在 Win11 26100 已不复现。

---

## 第一层：#7 修复回归 — 4/4 PASS

| # | 测试 | 结果 | 证据 |
|---|---|---|---|
| 1 | 全新安装创建第一个 Agent Member | **PASS** | 真实 `dsh plugin --profile web add <repo>` 安装（profile 初始化 + `link:` 依赖，pnpm 11.7.0）→ `dsh web` → Web UI 建频道/Agent → 激活成功，无 ENOENT，成员绿点在线（`shots/team-shot-team.png`） |
| 2 | `%DSH_HOME%\agent-team\members\` 目录名 | **PASS** | 实际目录 `member-e99759ef-5646-41e9-8d12-c933bddf501f`（NTFS 真实目录，非链接）；ledger 记录 `privateMemoryPath` 同为连字符形态；branded ref 保持 `member:e99759ef-…`（冒号留在引用里，符合设计） |
| 3 | member 写 memory/notes/skills → 重启 → 存活 | **PASS** | `memory.md`（追加内容）、`notes\windows-e2e-note.md`、`skills\windows-e2e-demo\SKILL.md` 在服务完全重启后逐字节存活（BEFORE/AFTER 清单一致）；成员会话随重启 resume |
| 4 | 模拟升级：旧冒号形态 → 重启 → 迁移 | **PASS（Windows 形态）** | ledger `privateMemoryPath` 手工改回 `member:e99759ef-…` 冒号形态 → 重启 → 激活无错、运行时迁移到 `member-e99759ef-…`、内容完整、ledger 保留旧路径（设计如此，迁移是运行时行为）。**注**：NTFS 上无法构造冒号目录本身（冒号即 ADS 分隔符，这正是 #7 根因），带内容的冒号目录改名迁移由仓库 POSIX 套件覆盖（其 Windows 侧 fixture 构造失败见 F7c）；Windows 真实升级形态（旧账本+无目录，ENOENT 分支）已验证 |

## 第二层：Windows 路径语义面

| # | 测试 | 结果 | 说明 |
|---|---|---|---|
| 1 | 用户名含空格 | **PASS** | home=`…\dsh-homes\John Doe\.dsh`（含空格）+ workspace=`…\John Doe\ws\my project` 全链路：plugin add ✓ → web ✓ → 建频道/Agent ✓ → `member-a776201b-…` 净化目录 ✓。注：`C:\Users\<name>` 下标准用户不可建目录（F9），用可写区等价覆盖 |
| 2 | 非 ASCII（中文+变音符） | **PASS** | home=`…\汪伟José\.dsh`、ws=`…\项目 测试` 全链路通过；成员 `member-dc85839e-…` ✓；会话日志目录对 Unicode cwd 用 `~XXXX` 码点编码（`汪`→`~6C6A`、空格→`~0020`），编码方案工作正常 |
| 3 | 长路径（>260） | **部分 PASS + 新发现 F10** | Node 侧全部正常：323 字符 home 的 initProfile、351 字符深 workspace 的成员会话 spawn/日志键控、成员目录净化均 ✓。**失败边界**：长 home 下 `dsh plugin add` 报 `pnpm not found on PATH`（exit 127）——实为 `spawnSync('pnpm', {cwd: <323字符>, shell:true})` 的 cmd 子进程无法进入超长 cwd（ENOENT），报错文案误导（pnpm 实际在 PATH 上）。详见 F10 |
| 4 | 盘符与大小写 | **PASS** | home 在 `D:\dsh-e2e\home\.dsh`；插件安装路径 `c:/Users/Wowyuarm/Src/Dsh-Agent-Team`（小写盘符+正斜杠+大小写改写）安装成功；workspace `D:\dsh-e2e\WS\CASE TEST`（实际目录小写）混合大小写解析正常，会话键控 `--D-dsh-e2e-WS-CASE~0020TEST--`。同目录双拼写是否产生双 workspace 记录需 picker 交互验证，本项跳过（自动化无法驱动选择器，操作者手动路径可用） |
| 5 | 正反斜杠混用 | **PASS** | 安装路径正斜杠 + 配置/seed 路径反斜杠混合使用无异常（Node 解析层）；原生 cmd 侧未发现分隔符敏感点 |
| 6 | 附件（空格/中文/长名） | **PASS** | 经真实 UI 上传（Playwright 注入真实文件对象）：`验收截图 with spaces.png`、`中文附件名.png`、106 字中文长名、`CON.md` 全部落盘可读回（`agent-team\attachments\v1\<id>\` + meta.json 原名保留）；长名 payload Windows 侧读取完整（WSL 9p 读同一目录报 I/O error，属 WSL 怪癖，非产品问题） |
| 7 | **#8 复现确认（冒号名）** | **复现** | `report:final.md` 上传后落盘为 **0 字节 `report` 文件 + 备用数据流 `final.md`（17B 内容在里面）**——常规读取返回空，静默数据丢失，与 #8 描述一致。**补充**：`CON.md`（保留名）与 `尾随点.md.`（尾点）在 Win11 26100 均**正常**落盘（设备名保留语义已放宽）——#8 对 Win10/旧语义环境仍成立，冒号类别在所有 Windows 版本成立 |
| 8 | Skill 安装（私有目录读写） | **部分 PASS** | 成员 `skills/` 目录在激活/重启/删除链路中的创建与存活已验证（测试 3）；skill 内容进入模型 prompt 的真实链路未验（keyless 环境），该链路由 `member-skills.spec` 覆盖（Windows 套件 5/5 通过） |

## 第三层：e2e 全链路

| # | 测试 | 结果 | 说明 |
|---|---|---|---|
| 1 | `npm run typecheck` | **PASS** | exit=0（Host/tools/Client 三 tsconfig 全过） |
| 2 | `npm test`（对照 Linux 299 基线） | **25/28 文件通过，6 个失败全部为 Windows 平台偏差**（F7/F8），无产品功能失败 | member-context-integration 1（F8 真实崩溃分支）、member-lifecycle 3（F7a 附件正则、F7b #7 守卫冒号断言、F7c 迁移 fixture）、attachments 2（F7a）。其余 21 文件（含 loader-composition、auto-compaction 13、change-scopes、client 组件套件等）全绿 |
| 3 | `npm run test:browser` | **命令本体不可跑（F6）→ 绕过构建后完整旅程 PASS (1/1)** | `npm run test:browser` 的前置 `npm run build` 死于 F6；用等价 runner 直跑旅程：完整 opt-in 旅程（频道/Agent 创建、Inbox 读写、Human 频道与 Thread 导航、验收、重载持久化、退出还原）在 Edge 上全绿 |
| 4 | 真实模型 member turn | **SKIP**（需 `DEEPSEEK_API_KEY`，操作者未提供；fake LLM 方案被 UI 自动化的 presence 问题挡住，见候选观察） | 旅程已覆盖 agent 收发与验收链路（keyless）；真实模型面为平台无关 HTTP，Windows 特有风险低 |
| 5 | 长时间运行 | **方向性 PASS** | 场景服务器连续运行数小时、a1 实例经历 4+ 次硬重启后成员会话反复 resume：WS 133MB / Private 203MB（单成员会话，Windows 工作集口径，与 Linux ~258MB heap 口径不可直接比），无增长失控信号。严格长时浸泡未做 |

## 新发现清单

### F1（环境污染，已闭环验证）祖先 `node_modules` 里的 React 19 类型打挂 Harness 认证 tag 构建
`C:\Users\wowyuarm\node_modules\`（2026-02-17 遗留，含 `@types/react@19.0.7`）→ tsc 默认 typeRoots 沿目录树上爬全局注入 → `deepseek-harness` 的 `build:lib` client 段 6 个 `*.client.spec.tsx` 共 26 个 TS2344/TS2339（`Promise<ReactNode>`、`ReactElement<any, string | JSXElementConstructor<any>>` 均为 @types/react@19 签名，lockfile 锁定的 18.3.31 无此签名，两侧 md5 一致）。改名该目录后同机全绿。WSL 侧无祖先 node_modules，不受影响。**建议**：`docs/development.md` 环境检查项加"home 与各级祖先目录不得有遗留 `node_modules\@types`"。

### F2（文档/契约）插件仓未钉 `packageManager`，`corepack pnpm install` 在 Node 24 硬失败
`docs/development.md:112` 声称 "both repositories pin `pnpm@11.7.0`"；实际 `dsh-agent-team/package.json` **无该字段**（仅 harness 有）。无钉时 corepack 0.34.2 取默认 pnpm 12.3.4，其包布局是 `bin/pnpm.mjs`，corepack 硬编码加载 `bin/pnpm.cjs` → `MODULE_NOT_FOUND`。显式 `corepack pnpm@11.7.0` 正常。**建议**：补 packageManager 字段或修正文档。

### F3（开发链，非管理员 EPERM）两处构建期 `symlinkSync(..., 'dir'/'file')`
`scripts/link-harness-packages.mjs:32`（六步之第 4 步）与 `scripts/generate-typert.mjs:27`（build/typecheck/test 都触发，且对 zod **目录**用了 `type:'file'`）在无管理员/开发者模式的 Windows 上 EPERM（原文见 findings.md）。Harness 自身 profile 恢复已正确用 junction（`app-boot/profile.ts:249-267`）。**绕行**：junction 替代脚本 + `NODE_OPTIONS --import` 预加载 shim（ESM 具名导入同样被覆盖）。

### F4（环境杂项）
`corepack enable` 写 `C:\Program Files\nodejs` 需管理员（用 `--install-directory` 绕过）；UNC cwd 下 corepack/cmd 告警；git 网络克隆到 9p 极慢（bundle 单文件拷贝 2.3s 替代）；autocrlf=system 导致 13 个源文件 CRLF（对构建/测试无影响，实测确认）。

### F5（pnpm 行为）workspace per-package 依赖链接损坏或缺失
首次 `corepack pnpm@11.7.0 install` 后 `packages/agent-team/node_modules/zod` 是 54 字节**文本文件**（内容为相对路径，非链接）；全量重装后该条目**不再创建**。两种形态都让 `generate-typert` 的显式 zod 链接假设落空。同机非 workspace 安装与 harness workspace 均为正常 Junction——机制待上游定性，绕行为手动 junction。

### F6（仓库代码，Windows bug）POSIX 形态 spawn 三处
`scripts/build-client.mjs:13` spawn `…\.bin\tsdown`（ENOENT）；`scripts/run-browser-test.mjs:37` spawn 裸 `corepack`（ENOENT）；`team-ui.e2e.ts` 的 `cp` filter 用 `/node_modules`、`/src` 正斜杠匹配——Windows 反斜杠路径下**过滤全部失效**（temp profile 会拷入整个 node_modules）。三者都让 `npm run build`/`test:browser` 在 Windows 不可用。**绕行**：`cmd /c …\.CMD` 等价 runner（构建产物与原逻辑一致，旅程据此跑绿）。

### F7（测试套件）Windows 平台偏差断言 —— 6 个失败测试的归类
- **F7a**（3 个）附件 prompt 行正则硬编码 `attachments\/v1\//`：Windows 真实路径为反斜杠（产品行为对平台正确），断言应平台无关化（`path.sep` 或双斜杠兼容）。
- **F7b**（1 个）#7 守卫测试 `expect(member.privateMemoryPath).not.toContain(':')`：Windows 绝对路径必含盘符冒号，断言被误伤——**修复本身的守卫测试无法在它修复的平台上运行**。应断言目录段（basename）不含冒号。
- **F7c**（1 个）迁移测试 fixture 在 NTFS 上 `mkdir('member:<uuid>\notes')` 直接 ENOENT（冒号目录在 Windows 不可构造）。fixture 应平台条件化（Windows 走"旧账本+无目录"形态）。

### F8（产品代码，真实 bug）`memberMemoryDirectoryPath` 存在仅 Windows 可达的崩溃分支
`packages/agent-team/src/member-runtime.ts:76`：`sanitized === member.privateMemoryPath` 的早退分支在 POSIX 恒成立（路径无冒号）；Windows 上盘符冒号使其**必进**切片回退分支，`member.privateMemoryPath.length - member.memberId.length` 对 `memberId` 缺失/不匹配尾段的记录直接 TypeError。测试证据：`member-context-integration.spec` 用 `{ privateMemoryPath: root }`（无 memberId）构造，POSIX 通过、Windows `Cannot read properties of undefined (reading 'length')`。生产记录目前两者总是成对且长度匹配，故实际影响面窄，但该分支的平台不对称性建议消除（例如按路径段处理而非整串替换+长度算术）。

### F9（环境事实）标准用户不能在 `C:\Users` 下创建目录
含空格用户名场景不能用真实 `C:\Users\John Doe` 账户目录等价构造（管理员才能建）；以可写区带空格路径等价覆盖。

### F10（产品链路，Windows bug 候选）长路径 home 下 `dsh plugin add` 失败且报错误导
`spawnSync('pnpm', { cwd: <323 字符 profile 目录>, shell: true })` → cmd.exe 无法以超长 cwd 启动 → ENOENT → dsh 报 "pnpm not found on PATH — install pnpm to manage profile plugins"（exit 127）。pnpm 实际在 PATH 且 `where pnpm` 可见；Node 侧 initProfile 在同一路径成功。**建议**：spawn 前对超长 cwd 用 `\\?\` 前缀或短期先改善报错文案（检测 `cwd.length > 260` 时给出长路径提示）。

### 候选观察（低置信度，建议产品侧确认）
成员 presence 在多次**硬杀**重启后出现 `unavailable`（频道成员编辑器的"添加"按 `presence === 'unavailable'` 禁用，TeamChannelsPanel.tsx:177），且 UI 无恢复入口（recoverMember 的 UI 触点未找到）。早期重启后曾恢复绿点，故非"重启必现"；可能与硬杀时机有关。建议确认：Host 端 kill 后成员 resume 的 presence 恢复路径与 UI recover 入口的可发现性。

## 附：本测试对环境做过的变更（可逆，均未触碰被测仓库源码）
- `C:\Users\wowyuarm\node_modules` → 改名 `node_modules.stray-2026-02-17.bak`（F1 修复）
- `C:\Users\wowyuarm\bin\`：corepack shim（pnpm 等）+ `pnpm.cmd` 钉版包装器（F2 绕行）
- `C:\Users\wowyuarm\src\dsh-win-test\`：全部测试脚本、junction shim、日志与截图（不在被测仓内）
- 测试 home：`C:\Users\wowyuarm\dsh-homes\{a1,lp-home,John Doe,汪伟José,segment-1…8}`、`D:\dsh-e2e\`（场景数据，可整目录删除）
- harness 侧 `link-harness-packages`/自链接 junctions（258 个）与修复脚本 `repair-links.mjs` 产物
- **API key**：未获得真实 key；全程仅进程环境占位值 `test-key-not-a-real-credential`（配合本地 fake LLM），未写入任何文件

---

## 追加（2026-09-06 晚）F11：CI windows-latest 上 suspend→resume 后 availability 卡 `unavailable` —— 根因已定位

**触发：** 团队分支 `fix/member-memory-dir-windows` @ fb8501f 的 CI（run 34018526605 / 34018889990）唯一失败项 `member-tool-policy.spec.ts × restores the same restricted surface across suspend, resume, and Host restart`（:253 `expected 'unavailable' to 'active'`）。39f7a08 同测试在 windows 绿（464ms），Linux 全程绿。

**结论：真失败（Harness 产品代码缺陷），Windows 专属文件系统竞态，非"慢启动误判"、非测试等待方式问题。**

- **失败原文**（插件 `memberFailures.activation`，真机 driver 抓取 `status.diagnostic`）：`ENOENT ... scandir '...\sessions\.dsh-mkdir-XXXX'`
- **机制**：`suspendMember` 的 `handle.dispose()` 只同步派发 `session/disposed`，Harness coordinator 的 retire（flush/materialize）是 fire-and-forget；被 suspend 成员的 session log 尚未 materialize 时，retire flush 在 resume 阶段并发执行 win32 durable-mkdir（`mkdtemp .dsh-mkdir-*` → `MoveFileExW` 逐级发布目录）；同一时刻 `resumeMember → activateMember → sessionPersistence.list()` 的 `listProjectDirs()` 把 transient staging 目录当 project 目录返回、`listSessionDirs()` 第二次 readdir 撞 rename → ENOENT 无容错抛出 → activation 失败被 catch 记账 → `unavailable`。
- **Windows 专属原因**：POSIX mkdir 原子且无 staging 条目；Windows 的 mkdtemp→MoveFileExW 窗口被 CI 冷盘 + Defender 拉宽数量级（CI 2/2 必现）。
- **真机复现率**：暖环境 210 周期 5 败 ≈ 2-3%/周期；单轮原版 spec 7/7 过。
- **修哪一层的建议**：① 首选 Harness `session-persistence-jsonl`：`listProjectDirs`/`listSessionDirs` 过滤 `.dsh-mkdir-` 前缀或对子目录枚举 ENOENT 重扫（list() 的调用面远不止 suspend→resume，这是根本修）；② 可叠加插件侧对瞬态 ENOENT 单次重试；③ 测试断言应携带 `status.diagnostic`，否则 CI 永远只见 unavailable；④ 记录 Host 缺口：retirement 完成态不可等待，插件无法真正串行化 suspend→resume。
- 详见 findings.md F11；driver 与证据存 `C:\Users\wowyuarm\src\dsh-win-test\`（resume-race-driver.spec.ts.bak、win-resume-evidence-final.json、resume-race-out.txt）。
- 本轮环境备注：Windows 克隆已同步 fb8501f 并硬重置（原工作区为行尾噪音）；`packages/agent-team/node_modules/zod` 与根 `node_modules/zod` 以真实目录副本修复（F5 残留 + git-for-Windows 跟随 junction 删除的坑，详见 findings.md F11 附录动机）；克隆中被跟踪的 zod symlink 占位文件呈 " D" 状态属预期，未提交任何变更。
