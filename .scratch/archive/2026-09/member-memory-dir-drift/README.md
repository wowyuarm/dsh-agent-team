# member 私有目录命名漂移（member: vs member-，issue #7 本机面）

**状态：** complete — 修复已验收并在真实数据上实战验证（2026-09-07）；等 Human accept Task task:907fe730。
**最后核对：** 2026-09-07 20:15（Host 重启后本机收尾验证通过）。

## 结论

外部 issue #7（Windows `member:<uuid>` 目录 ENOENT）在本机暴露为同根源的静默形态：POSIX 上 colon 目录合法，模型从 branded ref `member:<uuid>` 推导磁盘路径时无人拦截。同一 Member 三种拼写并存（身份 ref colon / 磁盘 `member-<uuid>` / skill provider `member-private:`）且注入块未声明映射规则，是漂移放大器。

**修复（commit 见 git log，amend 含本归档）**：`initializePrivateMemory` 在 ledger-legacy 迁移后新增孪生合并——`twinMemoryDirectoryPath` 从 sanitized 段严格 regex 推导 `member:<uuid>` 孪生；`mergeTwinMemoryDirectory` 把孪生内容并入 live 根：冲突时 live 胜、孪生败者 rename 成 `<name>.colon-twin.<ext>` 留档（POSIX rename(2) 静默替换目标，必须 stat 探测而非 catch EEXIST——该 catch 在两个平台都是死代码）；孪生独有文件原名迁入；清空后删除孪生目录。

**验收**：判别测试（仅磁盘孪生、无 ledger legacy 记录的 fixture）+ 内容保全 + 冲突语义 + 幂等 + twin 目录删除五组断言；全套件 418 passed / 1 skipped、typecheck 0、lint 0。判别测试在交付过程中实战抓到上述 rename 覆盖 bug（红测 expected 'live root fact' / received 'twin fact'）后修复。

**真实数据实战（2026-09-07 20:13 Host 重启）**：两个活跃冒号孪生目录全部回收——`member:93ab2850`（Vera，twin 独有 note 原名迁入，10,634B）；`member:6e8a5b10`（Tars，双版本冲突：live 版胜出，colon 版以 `.colon-twin.md` 留档，3 个独有小事实可追溯）。`member:7108f70d` 归档孤儿按设计保留（archived 成员不激活，迁移不触碰）。

## 决策记录

- **注入块 prompt 全删**（Human 拍板 8789/8805 之间的取舍）：机制兜底（Linux 重启合并回收 / Windows 直接报错自纠）已把复发代价封在一次多余重启周期；「never derive」短句最终未保留，常驻 token 零增量。
- **取证方法**（可复用，详见 forensics.md）：session 日志多帧 zstd 解压（magic `28 b5 2f fd` 切帧 + node:zlib 逐帧）重建时间线；sqlite ledger 只读查询；目录 inode birth/mtime/ctime 交叉验证（rename 保 birth）。

## 索引

- `forensics.md` — Vera 端取证全过程：6 天时间线重建（60+ 次 colon 操作惯例 → 16:16 激活迁移 → 19:15 复写）、写入方字节级判别、受影响面量化、验收口径与终审记录。
