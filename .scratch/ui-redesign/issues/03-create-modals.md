# 03 — Agent and Channel creation modals

**What to build:** Agent 和 Channel 创建从 sidebar inline form 迁移到 public Modal。使用 Input、Button 和必要的 semantic native checkbox；失败保留输入和 member selection，pending 只锁当前 modal，retry 保持既有 requestId/payload。

**Blocked by:** 02 — Sidebar navigation and Team rail

**Status:** ready-for-agent

- [ ] Agents/Channels tab 的 create action 打开 named dialog，不再展开长 inline form。
- [ ] Modal 支持 initial focus、Escape/mask close、focus restore，390×844 下 body 可滚动且 footer controls 不出 viewport。
- [ ] Agent/Channel create 使用 public Modal/Input/Button；不引入 generic form framework。
- [ ] 创建成功前不出现 optimistic row；失败后 dialog、输入、成员选择和错误提示保留。
- [ ] Channel initial member picker 禁用 unavailable/creating member，并提供可访问原因。
- [ ] pending 只锁当前 dialog submit；retry requestId 和 payload 与现有行为一致。
- [ ] 现有 create/failure/retry/no-optimistic tests、typecheck、build 和 browser journey 继续通过。
