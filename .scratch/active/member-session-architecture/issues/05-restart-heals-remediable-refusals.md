# 05 — 成员重启修复可修的拒绝;diagnostic 说明哪种动作有效

**What to build:** 一个成员的激活因确定性格式拒绝失败时,侧栏"重启"独自完成"先修再激活"(同套幂等与全量校验)并当场恢复;确无 Team 可修内容时,diagnostic 标明 non-remediable,界面显示 artifact 路径与"重启无效",不再提供安慰剂重启。每个不可用成员都能看出该做什么。

**Blocked by:** 04 — 调用方接入 seam;timeline 截断显式标记

**Status:** complete（代码与单测完成 2026-09-11；浏览器验收 2026-09-12 由 Vera 在合并树 `9d8362d` 上执行——`npm run test:browser` 1 passed / 24.1s，桌面 1440×960 与 390×844 截图齐备、人工过目无回归）

- [x] `SessionRemediation` 暴露单成员有界修复,返回 `{repaired, completed}`;启动全量遍历复用同一实现
- [x] Host 持有启动时打开的 remediation 实例(remediation 域名只 open 一次);`resume` Remote 的 failed-activation 分支按 spec §3 四条规则执行修复与重试
- [x] `AgentTeamAgentMemberStatus.diagnostic` 改为结构 `{class, detail, location?, sessionId?, remediable?}`;六类取值与激活失败分类路径按 spec §4;Typert 重新生成
- [x] preset 装载/校验失败以 `PresetCompositionError` 标记;rollover 窗口与 runtime/compaction 错误归入对应类别
- [x] Client:refused+non-remediable 与 rollover 不提供重启动作;refused 显示路径与"重启无效"文案(zh+en);`restartStillUnavailable`/`runtimeRiskDetail`/presence dot 消费新结构
- [x] 测试:可修拒绝 → 重启后成员恢复;不可修拒绝(E 类)→ remediable:false、无重试循环;io 激活失败 → 重启可恢复;既有 diagnostic 断言迁移到新结构
- [x] `npm run test:browser` 通过;desktop 与 390×844 截图人工过目;键盘/焦点与普通 DSH 恢复不受影响
  - 2026-09-11 沙箱状态:test:browser 在本沙箱**于 base 提交(6377d25)即同样失败**——首轮 `page.goto` 报 `net::ERR_ABORTED; maybe frame was detached`(base、03+04、03+04+05 三种状态逐一同点失败;Chrome 本体在本沙箱可加载普通页面)。属本沙箱与 harness web e2e 栈的既有不兼容,非本改动回归。**浏览器验收与截图过目需在 operator 环境执行**(`npm run test:browser` 或 dev profile `dsh web --profile web-dev`)。
- [x] 维护文档(architecture/domain-model,中英)记录 seam、失败类别与 diagnostic 契约;timeline 截断标记写入工具契约文档
