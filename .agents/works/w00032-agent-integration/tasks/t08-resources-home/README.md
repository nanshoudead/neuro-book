---
schema: nbook.task/v2
taskId: t08-resources-home
status: planned
updated: 2026-10-28
---

# 资源地址与 home：会话、Profile、Agent 三层与文档

## 目标与范围

定 Agent 可见的资源地址：session、profile、agent 三层 home 与真实目录的映射，附件存放，docs:// 与插件贡献文档，以及 local:// 的歧义。

来源：需求 11、12；清单外第 9 项（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 三层 home 的方案名与真实目录；每层放项目里还是跨项目。
- `local://` 的歧义：资源 Spec 里是会话工作目录，提示词编辑器 Spec 里是附件短地址。
- 附件：按内容哈希存、能否共享、fork 会话时怎样处理。
- `docs://` 的内容（产品使用文档、SDK 作者文档、插件贡献的文档）与贡献点。
- 插件注册资源方案的接口（资源 Spec 里 planned）。
- 长期记忆落在哪一层；`artifact://` 与工具大结果的溢出（分支 t18）。

## 材料

- [`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md)、[`ui/prompt-editor.md`](../../../../../docs/specs/ui/prompt-editor.md)
- [外部参照](../../../../../docs/research/agent-runtime-references.md)第 1 节（omp 的 URI）
- [调研](../../research/2026-10-28-repo-survey.md)第 5 节（旧应用的 profile home 与附件）

## 前置

t03、t05。

## 设计稿（2026-10-28，第二版，待开发者确认）

第一版把 Profile home 固定在项目里，开发者指出 Profile home 不一定属于项目、维度要列清楚。第二版先列维度，再用例子推出整套方案。

### 维度

| 维度 | 取值 |
|---|---|
| 归属 | 会话、Profile、所有 Agent 共用、插件、用户 |
| 项目范围 | 某个项目（随书的文件夹走）、跨项目（随状态根，即随这台机器上的用户） |
| 寿命 | 临时（关会话或启动时清理）、随会话（删会话即删）、长期 |
| 谁写 | Agent 读写、Agent 只读、用户写 Agent 读 |
| 算不算作品内容 | 算：只读模式下写入弹审批（t06）、nb-history 记账、Files 里看得到；不算：Agent 自己的东西 |
| 真实还是虚拟 | 真实目录（bash 能用）、虚拟（只能经读写工具，必要时由 harness 换成真实路径） |
| 会话没有项目时 | 可用、不可用 |

Profile 与项目两个维度交叉：

| | 当前项目 | 跨项目 |
|---|---|---|
| 某个 Profile | `profile://`：写手在这本书上的进度与笔记 | `profile-global://`：写手跨书的心得（“用户不喜欢破折号”） |
| 所有 Profile | 普通的 `project://` 文件：`project://AGENTS.md`、设定集，用户也看、也改 | `user://agent/`：用户写的 Profile 与 Skill、跨书偏好 |

### 方案

| 方案与路径 | 真实位置 | 作用 | Agent | 作品内容 | 真实/虚拟 | 没有项目时 |
|---|---|---|---|---|---|---|
| `project://<路径>` | `<主项目>/<路径>` | 作品文件（已实现） | 读写 | 算 | 真实 | 不可用 |
| `projects://<短名>/<路径>` | `<该项目>/<路径>`；`projects://` 本身是项目列表 | 跨项目读写别的书（ADR 0024 的租约） | 读写 | 算（那本书的） | 真实，列表虚拟 | 可用 |
| `session://<路径>` | `<状态根>/agent/sessions/<会话 id>/files/<路径>` | 本会话的工作区：计划、草稿、脚本；bash 的工作目录 | 读写 | 不算 | 真实 | 可用 |
| `session://attachments/<名称>` | 同上目录下 | 用户上传的附件，上传后不可改；fork 时硬链接 | 只读 | 不算 | 真实 | 可用 |
| `tmp://<路径>` | `<系统临时目录>/nbook-<状态根哈希>/<会话 id>/<路径>` | 一次性临时文件；会话关闭或启动时清理 | 读写 | 不算 | 真实 | 可用 |
| `artifact://<序号>` | `<状态根>/agent/sessions/<会话 id>/artifacts/<序号>/<工具名>.log` | 本会话工具大结果的全文 | 只读 | 不算 | 虚拟 | 可用 |
| `profile://<路径>` | `<主项目>/.nbook/agent/profile-homes/<profileKey>/<路径>` | 本 Profile 在本书上的笔记 | 读写 | 不算 | 真实 | 不可用 |
| `profile-global://<路径>` | `<状态根>/agent/profile-homes/<profileKey>/<路径>` | 本 Profile 跨书的心得 | 读写 | 不算 | 真实 | 可用 |
| `user://<路径>` | `<状态根>/user/<路径>`（已实现） | 用户的跨项目资产；`user://agent/profiles/` 放用户写的 Profile，`user://agent/skills/` 放用户 Skill | 读；写要询问 | 不算 | 真实 | 可用 |
| `docs://neurobook/…`、`docs://sdk/…`、`docs://plugins/<插件 id>/…` | 应用包、SDK 包、各插件包里声明的文档目录 | 产品文档、插件作者文档、插件贡献的文档 | 只读 | 不算 | 虚拟 | 可用 |
| `skill://<名>/<路径>` | 内置、插件、用户 Skill 的目录 | Skill 的说明与脚本（t15） | 只读 | 不算 | 虚拟，可换真实路径 | 可用 |
| `sessions://<会话 id>/…` | 相关会话（子代理、父会话、fork 来源）的 `transcript.md`、`files/` | 读别的会话的记录与产物（t14） | 只读 | 不算 | 虚拟 | 可用 |
| `history://…` | nb-history 的时间线与旧版本 | 读文件的旧版本（t13） | 只读 | 不算 | 虚拟 | 不可用 |
| `mcp://<服务>/<资源>` | MCP 服务 | MCP 资源（t19） | 按服务 | 不算 | 虚拟 | 可用 |
| 插件方案（例如 `plot://`） | 由插件定 | 插件自己的数据 | 由插件定 | 由插件定 | 由插件定 | 由插件定 |

- 去掉 `local://` 的两种含义：会话工作目录改为 `session://`，附件改为 `session://attachments/`。
- `user://` 的写入规则从“Profile 显式授权”改为“写入要询问”（t05、t06 定了 Profile 不碰审批）。
- 主项目：会话在哪个项目里建的；`project://`、`profile://` 按它解析。

### 用例子验证

| 例子 | 落到哪里 |
|---|---|
| 计划模式写计划 | `session://plan.md`；不算作品内容，只读模式下不弹审批 |
| 用户粘贴一张图 | `session://attachments/image-1.png` |
| 工具输出 300 KB | 截断后给模型，全文 `artifact://3` |
| bash 跑 Python 统计字数 | 工作目录 `session://`，中间文件 `tmp://` |
| 写手决定“悟空口头禅是‘俺老孙’” | 书的设定，所有 Profile 都要知道：写进 `project://设定/人物.md`（作品内容，用户可见） |
| 写手记“第 12 章写到第 3 节” | 只对写手、只对这本书有用：`profile://progress.md` |
| 用户对写手说“我不喜欢破折号” | 写手在所有书上都要记住：`profile-global://preferences.md` |
| 用户说“所有 Agent 都用简体中文” | 所有 Profile、所有书：`user://agent/preferences.md` |
| 没打开项目时和 Agent 聊天 | `project://`、`profile://` 不可用；`session://`、`profile-global://`、`user://` 可用 |
| 在《A》的会话里参考《B》的设定 | `projects://b/设定/人物.md` |
| 导演派写手写一章，导演读写手的产物 | 写手的结果作为工具结果返回；要细看时 `sessions://<写手会话>/files/…` |
| Agent 写一个插件 | 读 `docs://sdk/…`；插件源码放哪随 Creator 的设计另定 |
| Skill 带的脚本 | `skill://outline/scripts/count.py`，bash 执行时换成真实路径 |
| 读第 3 章三天前的版本 | `history://…`（t13 定写法） |
| 把书拷到另一台机器 | 作品文件与 `profile://` 跟着走；会话、`profile-global://`、`user://` 不跟（t03 已接受） |

## 当前状态

设计稿第二版，等开发者确认。

## 下一步

开发者确认或修改上面的方案后，把决定写进本 README。
