# UI 里程碑证据

- **工作项：** 2026-08 UI redesign
- **复跑命令：** `npm run test:browser`
- **运行环境：** 相邻 `../deepseek-harness` checkout、`/usr/bin/google-chrome`、无凭据的确定性 fixture

| 文件 | 验收点 |
| --- | --- |
| `ui-redesign-desktop-channel.png` | 桌面 Channel 的 header、timeline、composer 三段布局。 |
| `ui-redesign-active-thread.png` | Thread 中 Claim、Activity、Message 的层次与进行中状态。 |
| `ui-redesign-closed-thread.png` | Task 关闭后 composer 和发送操作被禁用。 |
| `ui-redesign-narrow-channel.png` | 390×844 下窄屏 Channel 无横向溢出。 |
| `ui-redesign-agent-create-modal.png` | Agent 创建 modal 的表单与操作层级。 |
| `ui-redesign-channel-create-modal-narrow.png` | 390×844 下创建 Channel modal 保持在视口内。 |
| `ui-redesign-members-modal-narrow.png` | 390×844 下成员 modal 的可用布局。 |
| `ui-redesign-restored-dsh.png` | 退出 Team mode 后普通 DSH conversation surface 恢复。 |

这些图不是像素级视觉回归基线。每次 `npm run test:browser` 的新图在 Git 忽略的 `artifacts/browser/`；只有完成一个工作项时人工筛选的代表图才进入本目录。
