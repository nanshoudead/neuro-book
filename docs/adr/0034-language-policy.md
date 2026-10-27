---
schema: nbook.adr/v1
status: accepted
decided: 2026-10-27
superseded-by: null
---

# ADR 0034：界面文字、开发诊断与给模型的文字各用什么语言

- 日期：2026-10-27
- 决策者：开发者
- 关联工作：[w00031](../../.agents/works/w00031-language-policy/README.md)、[w00028](../../.agents/works/w00028-i18n/README.md)
- 相关文档：[`docs/standards/code/common.md`](../standards/code/common.md#文字用哪种语言)、[`packages/nb-harness/docs/omp-capabilities.md`](../../packages/nb-harness/docs/omp-capabilities.md)
- 部分取代：[ADR 0023](0023-v2-frontend-backend-stack.md) 决策 2 中的 vue-i18n；0023 的其余决定不变

## 背景

新应用里的文字没有统一的语言规则：

- 报错大多是中文消息配英文错误码；界面有多处把 `error.message` 或命令失败的 `reason` 直接当正文显示，英文界面的用户会看到中文原因。
- 界面文字直接写在代码里的 `{zh-CN, en-US}` 两份，应用、nb-agent-ui、nb-form、nb-markdown 四处各有一套类型与代入函数。这个写法源自 w00017 t49 的一句“不引入 vue-i18n”，没有记录理由。ADR 0023 写了前端用 vue-i18n，新应用并没有落地它。
- 给模型的文字里，领域提示词是中文，命令 `description` 按 Spec 是英文，OMP 原生编辑工具的错误文本是英文，没有说明各自为什么。

开发者要为以后的国际化定下政策。讨论稿、三轮审查与一份只拿到目标的独立设计在 w00031 t01 与 w00028 t01 的证据里。

## 决策

### 1. 文字按读者分三类

- **界面文字与给用户看的失败说明**：本地化（决策 3）。
- **开发诊断**（异常 message、诊断事件 message、日志、堆栈）：英文，不本地化。
- **第三方库的错**：原样保留，外面包一层；进程内用标准的 `Error.cause` 保留原错。

程序需要区分的失败，用所属错误域的稳定码分支，不按诊断文案分支。

理由：日志会落盘，用户的 bug 报告也会带上它。如果按当时的界面语言翻译，同一份日志里会混着两种语言，同一个错误在不同语言下也搜不到同一串文字。诊断数量大、常拼着内部状态，翻译的维护成本高、收益小。vim、git 这类工具也只翻译给用户看的文字，诊断和调试输出都不翻；检索靠的是错误码。

代价：现有的中文诊断要迁移（w00031 t04）。迁移之前它们保持原样，新写的诊断用英文。

### 2. 错误：各错误域保留自己的合同，界面按码取文案

- 跨进程帧、`RemoteCallError`、`DiagnosticsError`、命令失败结果保留各自的形状，不统一成一个错误对象。
- 跨进程只传码、结构化参数和安全的 detail。远程的 `cause` 仍是那几个有限的传输阶段枚举，与决策 1 里进程内的 `Error.cause` 是两回事。
- 服务端、runtime、harness 不产生界面文字。界面按“拥有者命名空间 + 码”的消息键，从拥有者的消息目录取文案；遇到不认识的码，显示通用说明并附上码。

理由：硬统一成一个形状，会改掉跨进程帧的 schema（`additionalProperties: false`），并丢掉“写请求从帧发出起结果未知”这类各域自己的语义。不同合同的码会重名，例如远程路由与命令结果都有 `unavailable`、`denied`，所以消息键要带上拥有者。

代价：命令通知、跨进程 detail 这些现在放句子的字符串槽，要改成码加参数（w00031 t03）。

### 3. 界面文字用按插件、按包分的消息目录

- 每个插件、每个共享包自带按语言分的 JSON 消息目录，按插件 id 或包名分命名空间，随插件登记、注销。
- 声明（命令标题、视图标题、设置项等）里放消息键；与语言无关的文字（路径、项目名、用户输入）照旧写字符串。
- 引擎用 i18next，消息用它的原生格式；日期与数字用 `Intl`。
- 共享包不依赖 i18n 库：导出自己的默认目录，接收宿主给的翻译函数。

本条取代 ADR 0023 决策 2 中的 vue-i18n。

理由：

- **插件自带消息资源是插件生态的常规做法**，例如 VS Code 的 l10n、Chrome 扩展的 `_locales`。目录集中在文件里，才能接翻译平台；以后加语言也不用改任何声明。
- **为什么不用 vue-i18n**：它带 Vue 运行时依赖，无框架的共享核心不能直接依赖它。统一用一个不绑框架的宿主引擎、共享包经端口隔离，比两套机制并存简单。
- **为什么用原生格式**：用它的子集，共享包自带的最小实现预计会很小。具体的子集和实现由 w00028 t02 验证，本 ADR 不承诺行数。

代价：约 1100 条内联文字要迁移进目录；几份 Spec 的声明字段，以及 nb-agent-ui、nb-markdown 包级规则里“包内中英两张表、组件收 `locale`”的写法要改（w00028）。键、目录登记、回退链、类型检查、跨运行实例的取用，由 w00028 的设计与 Spec 定。

### 4. 给模型的文字

- **三条轴分开**：界面语言、作品语言、回复语言是三件事。界面语言不进提示词。
- **领域提示词**（写作、剧情问答、抽取规则）：用中文，原则上跟着作品语言走。“作品语言”现在还没有这个概念，引入时另定。现有的领域提示词资产（nb-story 的抽取提示词与问答 Profile）受逐字回归与 Profile 版本合同约束，本 ADR 不改变它们，改动仍按 nb-story 的规则另做质量对照。
- **基础设施提示词**（system reminder、工具说明、工具失败结果）：新写的用中文。合同已经规定为英文的字段（命令 `description`）和现有的英文说明保持原样，等 [w00031 t05](../../.agents/works/w00031-language-policy/tasks/t05-prompt-language-eval/README.md) 的中英文对照评测再定；t05 现在搁置。
- **OMP 原生工具**：`read`、`edit` 的错误文本原样保留英文。
- **领域工具**：失败时在 `details` 里给结构化的 `code`，按码写中文说明。第三方工具不强制。

理由：

- **为什么基础设施提示词用中文**：输出的是中文小说，上下文里少混一种语言。但没有找到可信的中英文提示词对照研究，所以改动现有说明要先评测。
- **为什么 OMP 原生错误文本例外**：仓库的 OMP 能力记录写明，它的错误文本与模型训练时所见一致，不要翻译或改写。
- **为什么领域提示词不跟界面语言走**：中文小说的作者把界面切成英文时，写作提示词不该跟着变。

代价：评测之前，同一个上下文里中英文并存。改了工具说明，旧会话会因为工具快照对不上而不能续跑（`session_incompatible`），这个代价等 t05 一起定。

### 5. 标识符用英文

错误码、事件名、字段名、工具名、参数名、标签名一律用英文。注释、文档、Spec 与 Task 记录仍按根 [`AGENTS.md`](../../AGENTS.md) 用中文。

## 备选方案

- **内联双语字面量**：应用的 schema 现在闭合为两种语言。扩成多语言可行，但每加一种语言都要改所有调用点，文字分散，接翻译平台还要另做提取与回写。
- **vue-i18n**：带 Vue 运行时依赖，见决策 3。
- **开发诊断也做 i18n**：日志会混着两种语言，检索更难，收益小，见决策 1。
- **统一的错误形状**：见决策 2。
- **基础设施提示词改用英文**：独立设计推荐过，但它自己也承认证据很弱，所以等 t05。
- **服务端按请求语言出文案**：每个后端插件都要带目录，请求要带语言，热卸载和错误冒泡的路径更长；只在显示的那一刻、在一个地方翻译更简单。

## 后果

- **执行顺序**：先做错误处理的只读审查（w00031 t02），再做失败投影设计（t03），然后迁移（t04）。迁移之前，中文诊断保持原样。
- **下列真相源由对应的 Task 修改**，本 ADR 落盘时不改它们：

  | 真相源 | 要改什么 | 负责 |
  |---|---|---|
  | [`workbench/commands.md`](../specs/workbench/commands.md) 的失败结果与通知 | `reason` 不当主文案，按码投影 | w00031 t03 |
  | [`agent/harness.md`](../specs/agent/harness.md)、nb-session 的会话条目 | 工具结果的结构化 `code`、错误文字的语言 | w00031 t03 |
  | [`runtime/diagnostics.md`](../specs/runtime/diagnostics.md) | 诊断消息用英文 | w00031 t03、t04 |
  | [`story/cli-skill.md`](../specs/story/cli-skill.md)、[`story/qa.md`](../specs/story/qa.md)、[`story/ingest.md`](../specs/story/ingest.md)，nb-story 的包级规则与 Skill | CLI 分成提示词、给人看的输出、JSON 三层；提示词资产不变的边界 | w00031 t03 |
  | dev-panel 的命令行文档与包级规则 | nbdev 的错误用英文，面板保持中文，共用的校验改成返回码加参数 | w00031 t03 |
  | [`workbench/menus.md`](../specs/workbench/menus.md)、[`workbench/views.md`](../specs/workbench/views.md)、[`settings/settings-window.md`](../specs/settings/settings-window.md)、[`workbench/editor.md`](../specs/workbench/editor.md) | 声明字段从内联双语改为消息键 | w00028 t01、t03 |
  | nb-agent-ui、nb-markdown 的包级规则与 nb-form 的文字说明 | 改为自带目录，加上 `t` 端口 | w00028 t01、t03 |
  | [`workbench/commands.md`](../specs/workbench/commands.md) 的 `description` | 暂不改 | w00031 t05（已搁置） |

- **已发布的 npm 包**：nb-form、nb-agent-ui、nb-markdown、nb-story 的公开接口与版本窗口由 w00028 t03 处理，发布本身逐次授权。
- **插件 SDK**：还没发布（ADR 0030），目录方案落地时直接切换。
