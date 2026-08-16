# DSH Client Plugin 开发基线

日期：2026-08-16
状态：M2 实施参考；基于 `deepseek-harness` 当前文档和源码确认。
适用范围：`dsh-agent-team` M2 Client package，以及后续所有 Team UI tickets。

## 目的

这份文档记录 DSH Web Client plugin 的真实接入规则。它不是 UI 设计稿，也不是 DSH 核心 API 的替代文档；它把本项目实施 M2 时反复需要查找的 package、bundle、Cordis、Slot 和测试边界集中起来。

M2 Client 必须遵循以下边界：

```text
Host / Team authority
        │ typed RPC / projection
        ▼
Team Client adapter
        │ local navigation + immutable view state
        ▼
React UI components
        │ slot registration
        ▼
DSH shipped Shell / layout / primitives
```

Client 不能直接读 operation ledger，也不能把 DSH shipped WorkspaceBrowser、ConversationRoot 或 Shell 复制进 Team package。

## 1. Plugin 加载模型

### 1.1 什么是 Client plugin

一个 package 只要通过 Cordis dependency injection 参与浏览器组合，就是 Client plugin。它需要在 `package.json` 声明 `dsh.client`：

```json
{
  "dsh": {
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-slots"
      ],
      "immediately": false
    }
  }
}
```

实际项目规则：

- `inject` 是 package 级依赖声明和加载图元数据；不能把它当作 UI slot 声明顺序。
- Client plugin 的 `apply(ctx)` 必须通过服务等待和 `ctx.slots.inject()` 适应声明方/注册方的并发激活。
- `immediately` 只表示第一阶段预取，不是激活屏障，也不是服务依赖保证。
- Host 组合决定哪些 package 进入 roster；package 自己声明 `dsh.client` 不等于所有部署都会加载它。
- activation 期缺 bundle、声明格式错误或 plugin fiber 失败会 fail loud；steady state 的单个坏 package 不应毒死其他 package。

### 1.2 浏览器 bundle

Client package 必须同时拥有 Node half 和 browser half。browser half 通过 DSH shared tsdown preset 输出 `lib/client.js`，包导出：

```json
{
  "exports": {
    "./client": {
      "types": "./lib/types/client/index.d.ts",
      "default": "./lib/client.js"
    }
  }
}
```

本仓库接入时沿用 Harness 的 `packages/client/tsdown.client.ts` 模式：

```ts
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-feature', [
  'lib/types/index.js',
  'lib/types/invariant.js',
])
```

注意：

- package 自己的 `tsdown.config.ts` 覆盖 workspace 默认配置，因此 Node half 也必须在配置中保留。
- 根项目的 `typecheck`、`build`、`pack` 必须显式包含新 package；只添加源码目录不会进入最终 bundle。
- browser bundle 是 closure factory，不是普通浏览器 ESM。它通过 `window.__ModuleLoader__` 注册，外部依赖必须是平台 module 或允许内联的 wire layer。
- plugin 间禁止 value import；跨 plugin 协作通过 Cordis service。`import type` 不触发此限制。
- `@deepseek-ai/dsh-client-ui-slots`、`web-react`、`ui-primitives` 等当前仍是平台/普通包；不要把它们当成需要新增 roster 的 plugin。
- bundle 使用 source map；CSS Modules 由 shared preset 编译并注入带 `data-plugin` 的 style tag，plugin unload 时由 Client loader 清理。

### 1.3 两阶段加载

```text
Host Loader
  → dsh.client scan
  → window.__DSH_BOOT__ graph
  → browser module registration / prefetch
  → Cordis Loader entry / fiber activation
  → service injection
  → slot registration
```

加载顺序不由 roster 数组位置保证。M2 Client plugin 必须能够在目标 slot 尚未声明时等待，而不是假设 `ui-sidebar` 或 `ui-conversation` 先 apply。

## 2. Cordis plugin 生命周期

标准 plugin 是导出 `apply(ctx)` 的 module：

```ts
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

export const inject = ['slots', 'workspaces']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    // registration / subscription / DOM side effect
    return () => {
      // synchronous cleanup or fire-and-forget async disposer
    }
  }, 'feature: lifetime')
}
```

长期规则：

- 所有注册、订阅和本地资源都挂在 `ctx.effect`，让 fiber unload 自动清理。
- `ctx.reflect.provide()` 的 disposer 也必须由 effect 管理；DSH 现有 service 一般在 cleanup 中 `void disposeService()`。
- `ctx.slots.register()` 本身返回 disposer，但生产代码通常再交给 `ctx.effect` 或 `ctx.slots.inject`，保证所属 fiber 正确。
- Plugin unload 会触发 slot declaration cascade：父 entry 释放后，其声明的 child slots 和 child registrations 一起消失。
- 失败必须可见；不要在 `apply` 中吞掉 slot registration、Host RPC 或服务注入错误。

## 3. Slot 模型

### 3.1 声明就是占有 render authority

Slot 只有被父 registration 的 `children` 声明后，其他 plugin 才能注册进去：

```ts
ctx.slots.register({
  name: 'sidebar',
  children: {
    'sidebar.workspaces': { kind: 'single', scope: 'root' },
    'sidebar.settings': { kind: 'single', scope: 'root' },
  },
}, SidebarRoot)
```

一个 entry 声明 child slot，就必须在自己的 component props 中消费 `renderSlot`。这保证声明方确实拥有 render site。

### 3.2 Slot kind 与优先级

- `single`：同一个 priority 只能有一个 registration。
- `list`：`id + priority` 不能重复；同一 slot 可以并列多个 id。
- `keyed`：`key + priority` 不能重复。
- `chain`：由 selector 和 priority 决定尝试顺序。
- 非 chain slot 默认 priority 是 `0`；数字越低越优先渲染。
- 不同 priority 的 single registration 可以 shadow；相同 priority 会直接抛错。

M2 Team mode 使用动态 shadow：

```text
shipped occupant: priority 0
Team occupant:    priority -100
```

退出 Team mode 时只释放 Team registration，shipped occupant 自动成为 winner。不要把 `root` slot 当作 Team 接入点；它是 AppFrame 的内建 single slot，直接替换会删除整个 Shell。Team 只接管：

- `sidebar.workspaces`
- `conversation`
- `sidebar.settings`

Team 入口本身使用 `sidebar.footer.action` 的 list registration。

### 3.3 `ctx.slots.inject()` 与动态声明

插件不能依赖 apply 顺序注册 child slot。正确模式：

```ts
ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register(
  { name: 'sidebar.workspaces' },
  TeamWorkspaceBrowser,
))
```

`ctx.slots.inject()` 会等待目标 declaration 出现，在 declaration lifetime 内安装 registration；目标 declaration 消失时自动释放 registration，重新出现时重新安装。Team mode 自己的 mode state 决定是否创建 shadow entry；mode exit 必须让 entry disposer 立即释放。

### 3.4 Owner props 与业务 inject 分离

Slot component props 由多个来源组成：

```text
Owner props       parent renderSlot(...) 提供
Runtime props     session/root standard kit
Store props       slot store handle（如有）
Inject props      register({ inject }) 返回
Locale props      register({ locale }) 注入 t
```

业务数据和操作应放在 plugin 自己的 `inject` face 或 Client service，不要把 ledger/projected data 塞进 parent owner props。

## 4. M2-01 的确定接入点

### 4.1 Team mode registration

M2-01 的最小结构：

```text
sidebar.footer.action (list, additive)
  └── Team toggle / return action

Team mode = true
  ├── sidebar.workspaces (single, priority -100)
  ├── conversation      (single, priority -100)
  └── sidebar.settings   (single, priority -100, null occupant)
```

Sidebar Shell 仍由 shipped `ui-sidebar` 持有；它继续提供 brand row、collapse control、New Session 和 footer render sites。Team 不接管 `sidebar` 或 `root`。

`conversation` 的 scope 是 `session-maybe`。Team center component 必须同时处理有/无普通 Session 的状态，并且不应把 Channel 伪装成 Session。

### 4.2 Workspace 复用

Team 读取和创建 Workspace 使用 `ctx.workspaces`：

- `ctx.workspaces.list` 是 real Host projection，顺序保持 Host registry order。
- `ctx.workspaces.create({ path })` 是唯一 Workspace create 入口。
- 目录选择通过 `sidebar.workspaces.directoryFlow` 的既有 owner contract 复用，不复制 `WorkspaceBrowser`。
- 第一阶段不实现搜索、不实现 Team-specific sort、不创建第二套 Workspace store。

### 4.3 持久状态

M2-01 只持久化 root-local 的：

```ts
interface TeamNavigationState {
  mode: 'conversation' | 'team'
  workspaceId?: WorkspaceId
}
```

Channel、Thread、tab 和打开的 modal 是 transient state。持久化必须经过现有 localStorage/engine-store 约定；恢复时验证 Workspace 仍存在，失效 id 清除并回退到可用 Workspace。普通 Session selection 不属于 Team state，进入/退出不改写 `ctx.sessions` 当前选择。

## 5. 测试接缝

### 5.1 高层测试

M2 主要测试真实 Client composition：

```text
real Loader
  + real runtime / slots / workspace services
  + real Team Client plugin
  + real UI slot renderer
  + controlled Host/RPC fixture
```

必须覆盖：

- Team footer action 进入/退出。
- three shadow registrations 的 winner 与释放恢复。
- Settings 在 Team 中隐藏，退出后恢复。
- 普通 Session selection 保持不变。
- plugin stop/unload 后无旧 registration、listener、style 或 local state 泄漏。
- refresh 时 `mode + workspaceId` 恢复，以及 stale Workspace fallback。
- slot same-priority conflict fail loud。

### 5.2 适合纯单测的内容

只把不需要真实 composition 的逻辑单测化：

- persisted navigation state parse/serialize。
- stale Workspace reconciliation。
- Workspace order projection。
- Team mode transition reducer。
- Team status/empty-state derivation。

不要 mock slot registry 来宣称完成真实 takeover；Slot winner、declaration cascade 和 unload 必须至少有一条真实 composition 测试。

## 6. 需要继续查阅的 Harness 资料

实施每张 M2 ticket 前，优先查这些资料和源码：

| 主题 | 资料 |
| --- | --- |
| Client package / boot graph | `deepseek-harness/docs/subsystems/client-modules.md` |
| Client plugin lifecycle | `deepseek-harness/.agents/notes/implemented/architecture/2026-07-23-client-plugin-loading-model.md` |
| Cordis plugin 基础 | `deepseek-harness/docs/cordis-tutorial/01-first-plugin.md`、同目录 lifecycle/services 章节 |
| Slot contract | `deepseek-harness/packages/client/ui-slots/src/index.ts`、`renderer.ts`、`store.ts` |
| Slot runtime lifecycle | `deepseek-harness/packages/client/runtime/src/client/slots.ts` |
| Sidebar slots | `deepseek-harness/packages/client/ui-sidebar/src/client/contract/slots.ts`、`SidebarRoot.tsx` |
| Workspace reuse | `deepseek-harness/packages/client/ui-workspace/src/client/contract/slots.ts`、`index.ts` |
| Settings takeover | `deepseek-harness/packages/client/ui-settings/src/client/contract/slots.ts`、`ui-settings-general/src/client/index.ts` |
| Conversation takeover | `deepseek-harness/packages/client/ui-conversation/src/client/contract/slots.ts`、`apply.ts` |
| Existing Client plugin shape | `deepseek-harness/packages/client/ui-goal/src/client/index.ts`、`tsdown.config.ts` |
| Client composition tests | `deepseek-harness/packages/client/*/tests/*client.spec.ts`、`apps/web/tests` |

这张表是导航，不替代上游源码；若 Harness contract 变化，应先更新本文件中的接入结论，再改 Team 实现。

## 7. 后续 Compaction 恢复点

每次会话压缩后，先恢复以下事实：

1. 当前 M2 frontier：`.scratch/m2-ui/issues/01-enter-leave-team-mode.md`。
2. 本项目 M2 设计出口：`.scratch/m2-ui/spec.md`。
3. Client plugin contract：本文件 §1-3。
4. M2-01 slot strategy：本文件 §4。
5. 验证策略：本文件 §5。
6. 代码开始修改前，再读 Harness 上游路径表中的对应 contract，确认没有漂移。

当前实现已验证：Team Client 使用 `@deepseek-ai/dsh-client-runtime/client` 的类型、真实 Cordis + SlotRegistry composition test、真实 React renderer DOM snapshot，以及根项目显式 `tsc` + Harness `tsdown` bundle。M2-01 的 Chromium browser journey 与完整 Team 流程由 M2-06 统一覆盖；后续 compaction 先读 M2-02 frontier，再回到本文件 §1-5。

## 来源

- `deepseek-harness/docs/subsystems/client-modules.md`
- `deepseek-harness/.agents/notes/implemented/architecture/2026-07-23-client-plugin-loading-model.md`
- `deepseek-harness/docs/cordis-tutorial/01-first-plugin.md`
- `deepseek-harness/packages/client/ui-slots/src/index.ts`
- `deepseek-harness/packages/client/runtime/src/client/slots.ts`
- `deepseek-harness/packages/client/ui-sidebar/src/client/contract/slots.ts`
- `deepseek-harness/packages/client/ui-workspace/src/client/contract/slots.ts`
- `deepseek-harness/packages/client/ui-settings/src/client/contract/slots.ts`
- `deepseek-harness/packages/client/ui-conversation/src/client/contract/slots.ts`
- `deepseek-harness/packages/client/ui-layout/src/client/index.ts`
