# dsh-agent-team 领域词汇

## Agent Team

一个 dshHome 内唯一的共享协作域。Agent Team 保存跨成员的协作事实，不共享成员的模型上下文、session transcript 或私有记忆。

## Member

Agent Team 中可被授权读取、发言、认领和接收投递的稳定身份。Member 由不可变的 member ref 标识，并绑定一个 workspace。首版包含 Human Member 和 Agent Member。

## Human Member

当前 Harness 用户对应的特殊 Member。Human Member 参与消息、claim 和 activity，并拥有 channel、成员、验收及 task 终态的管理权限。

## Agent Member

由 Agent Team 创建和管理的 Member。一个 Agent Member 绑定一个 dsh session、一个显式 team-enabled preset 和一个 workspace；普通 session 与 fork 不自动获得成员身份。

## Workspace

一个项目及其共享工作目录。Agent Member 的 session cwd 是其 Workspace 的项目目录；成员私有记忆不存放在项目根目录。

## Channel

Workspace 内的持久协作场所。Agent Member 必须显式加入 Channel 才能读取、发言、认领或 follow；Human Member 可以管理和查看 Workspace 内全部 Channel。

## Message

Member 在 Channel 或 Task Thread 中显式发出的不可变内容。dsh 对每条 Channel 顶层 Message 自动创建 Task；这是本地可追踪性策略，Raft 只把显式标记为 task 的顶层消息放入 task board。Thread Message 只延续已有 Task。

## Task

由 Channel 顶层 Message 创建的可追踪承诺。Task 的工作状态从 claims 派生，human acceptance 与 closed 是显式覆盖事实。

## Thread

一个 Task 下的单层回复与 activity 序列。Thread revision 随 Message 或 Activity 的提交递增；回复必须携带该 Thread 的当前 revision。

## Claim

Member 对一个 Task 中某个 Direction 的工作承诺。Claim 的状态为 active、done 或 released；同一 Task 中规范化后相同的 Direction 最多有一个 active Claim。多 Claims 是 dsh 对 Raft 单 owner 的有意偏离，不同文本仍可能表达重复工作。

## Direction

Claim 的自由文本工作方向。比较时执行 Unicode 规范化、首尾空白删除、连续空白压缩和大小写折叠；不推断同义词。

## Follow

Agent Member 对一个 Thread 后续 Message 和 Activity 的投递订阅。发言或被 mention 会建立 Follow；unfollow 只停止普通订阅投递，不撤销 Channel 可见性。dsh 的 Follow 不等于 Raft 的 channel membership 或 Activity feed。

## Activity

由 Agent Team 记录的协作状态事实，例如 claim、release、accept、close、reopen 和成员管理。Activity 不是任何 Member 的发言，但会进入相关 Thread 的顺序与 revision。

## Delivery

一个已提交 Message 或 Activity 到目标 Agent Member Inbox 的投递意图。Delivery 的持久状态为 queued、admitted 或 canceled；admitted 只表示目标 session 存在可重建的 Inbox evidence，不表示消息已被 claim、进入模型、处理、回复或验收。Raft bridge wake acceptance、Raft message-check ack 与 dsh admitted 是不同层次的确认。

## Operation

Agent Team ledger 中一次不可变的原子业务提交。每个 Operation 有全局递增 sequence、稳定 operation id、幂等 request id、actor 和一种业务事实。

## Revision

特定 Thread 最近一次相关 Operation 的 sequence。Revision 是 optimistic concurrency fence，不是消息数量。

## Ref

跨重启稳定、带对象类型且不可由调用者拼接的标识。Member、Channel、Task、Message、Claim 和 Delivery 使用不同的 branded refs。

## Team DM

未来可能增加的私有 Place 类型，具有独立 participant set、visibility、Message、Thread、Follow 和 Delivery 语义。M2 direct chat 只打开 Agent Member session，不是 Team DM，也不写 Team ledger。

## Suspend

临时停止 Agent Member 的 live Agent，同时保留成员身份、session、claims、follows 和 queued deliveries。Resume 恢复同一 session。

## Remove

不可逆地停用 Agent Member。Remove 释放 active claims、清除 follows、取消 queued deliveries 并归档 session；历史 Message、Activity 和身份快照永久保留。
