# 调研：OpenUI 与“让 LLM 直接写界面代码”的风险和隔离手段

日期：2026-10-20

## 问题

NeuroBook 要让 LLM 生成表单或界面（Agent 向用户提问、审批、临时工具界面）。本文只回答两件事，不给推荐，取舍由 ADR 或 Proposal 承载：

1. OpenUI（Thesys 的 generative UI 项目）是什么、怎么工作、对安全怎么说。
2. 让 LLM 写 TSX/JSX 并在应用里执行，有哪些已公开的危险，业界怎样隔离，浏览器里有哪些隔离手段、各挡得住什么。

JSON Schema 表单、A2UI、json-render、MCP elicitation 等由另一份调研负责，这里只在对照时一句话带过。

## 证据等级与验证边界

| 标记 | 含义 |
| --- | --- |
| 实测 | 我在本机运行得到 |
| 源码 | 读 `thesysdev/openui` 仓库 2026-10-19 的 HEAD（提交 `9823ec05d`，浅克隆，只有这一个提交，没有历史），或 npm 包内容 |
| 官方文档 | 仓库内 `docs/`、`spec/`，或官方站点文字 |
| 检索 | 网络搜索结果，未打开原页面核对 |
| 自报 | 项目方自己公布的数字或评价，未独立复现 |

验证边界：

- OpenUI 的解析器和参考组件库我装了已发布的 npm 包（`@openuidev/lang-core@1.0.1`、`react-ui@0.18.1`）并实际解析了示例，没有在浏览器里渲染，没有测任何浏览器行为。
- OpenUI 的 Vue 运行时我只读了 README 和源码目录，没有运行。
- 第二部分各产品的隔离机制来自各家官方文档或第三方逆向分析，我没有自己抓包验证。

---

## 一、OpenUI（Thesys）

### 1.1 基本信息

| 项 | 内容 | 等级 |
| --- | --- | --- |
| 仓库 | `github.com/thesysdev/openui`，官网 `openui.com`，公司 Thesys Inc. | 源码 |
| 许可证 | MIT，`LICENSE` 文件首行 `The MIT License (MIT)`，版权行 `Copyright (c) 2011-2024 Thesys Inc.` | 源码 |
| 创建时间 | 2024-12-02（GitHub API `created_at`） | 实测 |
| 最近推送 | 2026-10-19（GitHub API `pushed_at`） | 实测 |
| 星标／复刻 | 约 12257／830；开放 issue 约 169（2026-10-20 查询） | 实测 |
| 主要包的版本 | `lang-core` 1.0.1、`react-lang` 1.0.1、`react-ui` 0.18.1、`vue-lang` 0.4.2、`svelte-lang` 0.4.2、`angular-lang` 0.4.2、`server` 0.3.0、`a2ui` 0.5.0 | 源码 |
| 1.0 发布时间 | `lang-core` 与 `react-lang` 的 1.0.0 发布于 2026-10-12，1.0.1 于 2026-10-15（npm 时间戳） | 实测 |
| 发布节奏 | `lang-core`：0.3.0（09-15）、0.3.1（10-05）、0.3.2（10-08）、0.4.0（10-10）、0.4.1（10-10）、1.0.0（10-12）、1.0.1（10-15）；`vue-lang` 最早的版本 0.1.1 是 2026-04-14 | 实测 |
| 安全披露渠道 | `SECURITY.md` 只写了通过 GitHub Security Advisory 私下报告；没有列出已公开的安全公告（`security-advisories` 接口返回空列表） | 源码、实测 |

维护信号：近两周发布密集，1.0 发布才八天，规范刚冻结；`vue-lang`、`svelte-lang`、`angular-lang` 仍在 0.x。

供应链一点：`@openuidev/lang-core` 带 `postinstall` 脚本，安装时发送遥测（随机安装 ID、本地生成的项目标识、Node/操作系统/包管理器版本、是否 CI 或 Docker；官方文档称不收集提示词、源码、路径、密钥）。运行时遥测默认关闭，且只在服务端提示词生成时采样。我用 Bun 安装时，该脚本被 Bun 默认拦截（`bun pm untrusted` 列出 `@openuidev/lang-core @1.0.1 postinstall`）。出处：`docs/content/docs/openui-lang/telemetry.mdx`、`packages/lang-core/package.json`。等级：官方文档、实测。

### 1.2 同名项目 wandb/openui

`github.com/wandb/openui` 是另一个项目，与 Thesys 无关。

- 描述：`OpenUI let's you describe UI using your imagination, then see it rendered live.`（GitHub API `description`）。
- 做法：用户用自然语言描述界面，后端调用模型生成 HTML，实时渲染，并可把 HTML 转成 React、Svelte、Web Components 等。本机运行（Python 后端，端口 7878），可接 Ollama 或 OpenAI。等级：检索（搜索结果摘要），未读其源码。
- 许可证：GitHub API 返回 `Apache-2.0`；创建于 2024-03-17，约 22628 星，最近推送 2026-10-16。等级：实测（API）。
- 它是“模型写 HTML 并渲染”的开发者工具，不是给应用嵌入的受约束渲染器。其渲染沙箱我没有查。

下文的 OpenUI 一律指 Thesys 的项目。

### 1.3 OpenUI Lang 是什么

官方定义：`a compact, line-oriented language that a model writes to describe a user interface. It replaces JSON trees and raw HTML with a short program, one statement per line.`（`spec/overview.md`，官方文档）。

官方示例（`spec/overview.md` 第 1.1 节）：

```openui-lang
root = Card([header, chart])
header = Header("Monthly Revenue", "Last 6 months")
chart = BarChart(labels, [series])
labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]
series = Series("Revenue", [12000, 15000, 14000, 18000, 21000, 25000])
```

语法要点（`spec/language.md`、`spec/overview.md`）：

- 每行 `名字 = 表达式`；表达式是字符串、数字、布尔、`null`、数组、对象、组件调用 `Name(arg1, arg2, ...)`。
- 参数按位置传，顺序就是组件登记时 props 的顺序，不支持 `key: value` 命名参数（系统提示词里明说“colon syntax is NOT supported and silently breaks”）。
- 名字可以先用后定义（提升），所以模型先写 `root` 布局，再补数据。从 `root` 能到达的才渲染，不可达的语句不渲染。
- 另有表达式（算术、比较、逻辑、三元、成员访问、下标）、内建函数（`@Count`、`@Sum`、`@Filter`、`@Sort`、`@Each` 等）、`$` 开头的响应式状态变量、`Query`／`Mutation`、动作（见 1.5）。
- 1.0 新增：一致性测试夹具（`spec/fixtures/1.0/`，任何语言的客户端可对照）、消息协议、`library.extend()`、自定义函数和自定义动作。

为什么这样设计，官方列出的设计目标（`spec/overview.md` 第 1.2 节）：

- 少 token：位置参数和短名字，“up to 67% smaller than the same UI in JSON”。
- 默认可流式：“Every partial program is a valid page”；解析器自动闭合未完成的括号和字符串。
- 容错：“A mistake removes the smallest broken piece. The rest of the page still renders.”
- 不经模型的交互：状态、表达式、动作在客户端运行。

自报的 token 数字（README 与 `docs/content/docs/openui-lang/benchmarks.mdx`；自报，用 `tiktoken` 的 GPT-5 编码器，七个场景）：

| 场景 | Vercel JSON-Render | Thesys C1 JSON | OpenUI Lang |
| --- | ---: | ---: | ---: |
| contact-form | 893 | 849 | 294 |
| settings-panel | 1244 | 1205 | 540 |
| 合计（七个场景） | 10180 | 9948 | 4800 |

合计比 Vercel JSON-Render 少 52.8%，比 C1 JSON 少 51.7%；“up to 67%”是单个场景（contact-form 对 Vercel）的最大值。对比对象含 Thesys 自家的 C1 JSON。基准脚本在仓库 `benchmarks/`，我没有复现。

### 1.4 组件怎么来

登记（`docs/content/docs/openui-lang/defining-components.mdx`，React 版）：

```tsx
const StatCard = defineComponent({
  name: "StatCard",
  description: "Displays a metric label and value.",
  props: z.object({ label: z.string(), value: z.string() }),
  component: ({ props }) => (<div><strong>{props.label}</strong><div>{props.value}</div></div>),
});
export const myLibrary = createLibrary({ root: "StatCard", components: [StatCard] });
```

- 用 Zod 写 props；`z.object` 里键的顺序就是位置参数的顺序；嵌套组件用 `Other.ref`，联合类型用 `z.union([A.ref, B.ref])`。
- `reactive(z.string())` 标记可双向绑定的 prop，绑定到 `$变量`。
- 库可以有 `id`、`version`；库的“存储兼容规则”：只在末尾加 props、不重排不删除、新必填 prop 要有默认值（因为已存储的程序没有 prop 名，只有位置）。

LLM 怎么知道有哪些组件：`library.toSpec()` 产出 LibrarySpec（JSON，含 `schema`、每个组件的 `signature` 和 `description`），`generateSystemPrompt({ library, promptOptions })` 生成系统提示词（`@openuidev/lang-core`，服务端也能用，不依赖框架）。我用参考库实测：82 个组件，提示词约 36113 字符。提示词里的组件签名形如：

```
Input(name: string, placeholder?: string, type?: "text" | "email" | "password" | "number" | "url", rules?: {required?: boolean, ...}, value?: $binding<string>)
Form(name: string, buttons: Buttons, fields?: FormControl[]) — Form container with fields and explicit action buttons
```

校验（`spec/language.md` 第 8 节错误表，另加我的实测）：

| 情形 | 错误码 | 处理 |
| --- | --- | --- |
| 组件不在库中 | `unknown-component` | 该组件丢弃，错误里带可用组件名 |
| 必填 prop 缺失或为 null | `missing-required`／`null-required` | 有 schema 默认值则补，否则丢弃该组件 |
| 类型或枚举不符 | `type-mismatch` | 有默认值则用默认值；可选 prop 或数组项被去掉；必填则丢弃组件 |
| 参数多于 props | `excess-args` | 多余参数丢弃，组件照常渲染 |
| 未知 `@函数` | `unknown-function` | 结果为 null，语句保留 |
| 表达式运行时抛错 | `runtime-error` | 该 prop 变 null |

实测（参考库，`createParser(spec.schema, spec.root).parse(...)`）：把 `Form` 写成 `Form2` 得到 `unknown-component`，整个表单被丢弃，`root` 的 children 为空数组；`Input("x","p","date")` 得到 `type-mismatch`（枚举里没有 date）；`Input` 多传两个参数得到 `excess-args (2 excess dropped)`。错误以结构化 JSON 返回，带语句名和提示，可以回传给模型让它用“增量编辑”补一行修正（`autofix` 文档里还有服务端自动修复）。

流式与部分输出：每个数据块到来都重新解析；已结束的语句（行尾换行已到）只解析一次并固定，未结束的尾部按“自动闭合”规则解析；未解析的引用在表达式里是 null，在组件位置不渲染，数组元素里直接略去；查询和变更在流式期间不执行；由宿主告知流结束（React 里 `isStreaming` 变 false）。1.0 起，没有到达 `root` 的截断输出渲染为空白而不是半棵树（`react-lang` 1.0.0 更新说明）。

### 1.5 有没有执行代码

渲染器解释的是一种声明式语言，不执行模型生成的 JS。证据：

- 语言只有上述表达式与内建函数；`@名字` 调用只能是内建函数、动作或库里宿主登记的自定义函数，其他“结果为 null 并报 `unknown-function`”（`spec/language.md` 第 3 节）。
- 自定义函数的实现 `fn` 在宿主库里，不在提示词里，“pure and synchronous … no side effects”（`spec/overview.md` 第 2.11 节）。
- 在 `lang-core`、`react-lang`、`vue-lang`、`react-ui` 的源码里搜 `new Function`、`eval(`、`dangerouslySetInnerHTML`、`v-html`、`innerHTML`，没有命中（`grep`，排除测试，源码）。
- 官方博客 `intelligent-ui-needs-a-new-html.mdx` 自己的立场：“Arbitrary code lets the model write anything, so you need a sandbox to run it.”，并把这当作不用 HTML/React 作为模型输出语言的理由之一（官方文档，自报立场）。

事件、状态、动作（`spec/overview.md` 第 2.4、2.9、2.10 节，`spec/language.md` 第 6 节）：

- 状态：`$name = 默认值`，用户输入或动作写入；绑定写法 `Input("search", "…", "text", null, $query)`。
- 内建动作五种：`@ToAssistant(消息, 上下文?)`（把一轮对话交回宿主，上下文可为任意值）、`@OpenUrl(url)`、`@Set`、`@Reset`、`@Run(查询或变更)`；多个动作用 `Action([...])` 按序执行；失败的变更会中止后续动作。
- 自定义动作：库里声明 `actions`，模型写 `@CopyToClipboard(text)`，渲染器把事件 `{type: "CopyToClipboard", params: {...}}` 交给宿主的 `onAction` 回调，宿主自己实现。
- 回调：React 的 `Renderer` 有 `onAction`；Vue 的 `Renderer` 同样有 `onAction`（README）。表单值随 `@ToAssistant` 一起交回（`spec/overview.md` 第 2.5 节）。
- 数据：`Query("工具名", 参数, 默认值)`、`Mutation("工具名", 参数)`。工具名由模型写，工具由宿主以 `toolProvider`（函数表或 MCP 客户端）提供，在浏览器里执行。官方原文：“Treat their arguments as untrusted. The model chooses them, and the calls come from the browser, so validate them in your API routes like any client request.”（`docs/content/docs/build-agents/tools.mdx`）。

两点从源码看到的、与外传和执行有关的行为（源码，未在浏览器验证）：

1. `@OpenUrl` 的 URL 在解析层只要求是字符串。我实测 `Button("go", @OpenUrl("javascript:alert(1)"))` 被解析器原样接受，没有任何错误。
2. `react-ui` 提供了 `safeUrl`（拒绝 `javascript:`、`data:`、`vbscript:`、`file:`，并剥掉控制字符防 `java\tscript:` 之类混淆），注释写明用于“every LLM-controlled URL sink”。但 `packages/react-ui/src/components/OpenUIChat/utils/actionMessage.ts` 第 28 行处理 `open_url` 时是 `window.open(url, "_blank")`，没有走 `safeUrl`；全仓库只有 ContextCardBlock、VisualCardBlock、EditableTable 单元格、Sources 几处用了 `safeUrl`。因此是否被利用取决于所用渲染路径，我没有在浏览器里验证。

另外，参考库的 `Image(alt, src)` 的 `src` 是任意字符串（`genui-lib/Image/schema.ts`），库本身没有域名白名单；只要渲染成 `<img>`，浏览器就会向该地址发请求。这是图片地址外传（见第二部分）的前提，是否被页面 CSP 挡住取决于宿主。

### 1.6 运行时与框架

- 核心 `@openuidev/lang-core`（解析、提示词生成、表达式求值、状态与查询管理）描述为“no React, Angular, Vue, or Svelte dependency”（README），源码目录里没有框架导入的迹象（我只看了目录结构，没有逐文件检查）。
- 官方运行时：React（`react-lang`，另有 `react-ui` 的参考组件库和聊天界面）、Vue 3（`vue-lang`）、Svelte 5（`svelte-lang`）、Angular（`angular-lang`）。
- Vue 的情况（查实）：`@openuidev/vue-lang` 在官方仓库 `packages/vue-lang`，有 `Renderer.vue`、`RenderNode.vue`、`defineComponent`、`createLibrary`，peer 依赖 `vue >=3.5.0`、`zod`；最早的 npm 版本 0.1.1 发布于 2026-04-14，当前 0.4.2。包里有 `queryLoader`、`isQueryLoading` 等查询相关导出。
- 但版本滞后：`vue-lang/README.md` 写明“works with `@openuidev/lang-core` ^0.4 (OpenUI Lang 0.5). OpenUI Lang 1.0 features need the React renderer, `@openuidev/react-lang` 1.x, for now.”；`react-lang` 1.0.0 更新说明同样写“vue-lang, svelte-lang and angular-lang stay on 0.4 (OpenUI Lang 0.x)”。也就是说 Vue 目前不支持 1.0 的新特性（裸动作步骤、自定义函数与动作、`library.extend()` 等）。
- Vue 包没有像 `react-ui` 那样的参考组件库（`vue-lang` 的 `src` 只有 `Renderer`、`library`、`state`、`validation` 等），组件需要自己用 `defineComponent` 登记。（源码目录观察。）
- Vue 的 README 示例里组件模板写成 `<Greeting name='Alice' mood='happy' />` 的 XML 形式放在 `examples` 参数里，与 OpenUI Lang 的函数调用写法不一致；我没有查清这是 0.x 的旧写法还是文档笔误。

### 1.7 具体小例子：服务商连接表单

需求：ID 只读；名称；API Base；接口格式二选一；API Key；超时与重试并排；选了某个接口格式才显示代理。

下面是我用 `react-ui` 参考库的组件词汇写的版本。我用 `createParser(openuiLibrary.toSpec().schema, "Stack")` 实测解析，0 个错误；没有在浏览器渲染。

```openui-lang
$fmt = "openai"
root = Stack([form])
form = Form("provider", btns, [idF, nameF, baseF, fmtF, keyF, numRow, proxyF])
idF = FormControl("ID", TextContent("provider-7f3a"))
nameF = FormControl("名称", Input("name", "例如 公司网关", "text", { required: true }))
baseF = FormControl("API Base", Input("apiBase", "https://api.example.com/v1", "url", { required: true, url: true }))
fmtF = FormControl("接口格式", RadioGroup("format", [RadioItem("OpenAI", "chat/completions", "openai"), RadioItem("Anthropic", "messages", "anthropic")], "openai", null, $fmt))
keyF = FormControl("API Key", Input("apiKey", "sk-...", "password", { required: true }))
numRow = Stack([timeoutF, retryF], "row", "m")
timeoutF = FormControl("超时（秒）", Input("timeout", "60", "number", { min: 1 }))
retryF = FormControl("重试次数", Input("retries", "2", "number", { min: 0, max: 10 }))
proxyF = $fmt == "anthropic" ? FormControl("代理", Input("proxy", "http://127.0.0.1:7890", "url")) : null
btns = Buttons([save, cancel])
save = Button("保存", @ToAssistant("save-provider"), "primary")
cancel = Button("取消", @ToAssistant("cancel"), "secondary")
```

对照需求：

| 需求 | 做到了吗 |
| --- | --- |
| 并排 | 做到：`Stack([...], "row", "m")` |
| 接口格式二选一 | 做到：`RadioGroup`（或 `Select`），值绑到 `$fmt` |
| 选了某格式才显示代理 | 做到：三元表达式 `$fmt == "anthropic" ? … : null`，客户端求值，不经模型 |
| 必填、URL、数字范围校验 | 做到：`rules` 对象，渲染器校验并阻止提交 |
| ID 只读 | 参考库的 `Input` 没有 `readOnly`／`disabled` 参数（`genui-lib/Input/schema.ts` 只有 `name, placeholder, type, rules, value`），上面用 `TextContent` 显示文本代替，这不是只读输入框；要真的只读输入框须自己用 `defineComponent` 增加一个组件 |
| 表单值交回应用 | 部分：表单值随 `@ToAssistant` 动作交给宿主，宿主收到的是“发给助手的消息加表单状态”，不是一个类型化的提交回调；要直接提交到应用，需用自定义动作（1.0 的 `actions`，Vue 目前不支持）或 `Mutation` 调宿主工具 |
| 把接口格式、值预填 | 部分：`$fmt` 有默认值；其他 `Input` 的初始值通过 `value` 绑定 `$变量` 并声明默认值，上例没有写 |

另测一个畸形输入（实测）：错误的组件名、枚举外取值、多余参数分别被丢弃、去掉、截断，其余部分继续渲染（见 1.4）。

### 1.8 官方对安全的说法

按出处列出原文：

- 对比表（`docs/content/docs/openui-lang/comparison.mdx`，自报）：`Security risk` 一行，OpenUI、json-render、A2UI 都是 `Minimal`，CopilotKit OpenGenUI（自由 HTML/SVG 放 iframe）是 `Medium`。
- 官方博客 `state-of-generative-ui-report.mdx`：对“目录约束”类方案（模型只能选已登记组件）写：“the security analysis is straightforward: there is no generated code …”，并说“That constraint is also the security model”（该段节选，我没有读完整段，引用时以仓库原文为准）。
- 同一篇对 MCP Apps 类写：“The security model is mandatory: iframe sandbox with no outside DOM/cookie/storage access, `postMessage` as the only communication channel, CSP declared by the server and enforced by the host.”
- 官方文档 `agent/guides/open-ended-html.mdx`（OpenUI 自带的“开放式 HTML 产物”示例）：“Generated HTML is untrusted content. Normalize and validate the document, enforce a Content Security Policy, restrict network access, keep the iframe sandbox narrow, and validate any messages crossing the iframe boundary.”
- 官方文档 `build-agents/tools.mdx`：见 1.5，工具参数当作不可信输入。
- `build-agents/frameworks/pi.mdx` 的安全节：示例让 Agent 拥有 `read／bash／edit／write` 且不经审批、接口无认证，“treat reaching the port as remote code execution”（这是示例，不是库的行为）。
- 我在 OpenUI 官方文档里没有找到关于提示注入的专门论述；`grep` 搜索 `prompt injection`、`untrusted`、`xss`、`sanitiz`、`allowlist` 只命中上面这些。

---

## 二、让 LLM 生成代码并执行：已公开的风险

本节分两类：一类是“提示注入让 Agent 把数据发出去”（与是否执行生成代码无关，渲染一张图就够），另一类是“生成内容进了浏览器执行环境后隔离失败”。

### 2.1 提示注入导致数据外泄的公开案例

| 时间 | 案例 | 外传通道 | 出处与等级 |
| --- | --- | --- | --- |
| 2023-11-04（Simon Willison 转述；原文 embracethered.com/blog/posts/2023/google-bard-data-exfiltration/） | Google Bard：共享的 Google Doc 里藏指令，让 Bard 把之前读到的数据编进 URL，用 Markdown 图片发出。Google 的 CSP 只允许图片来自 Google 域名，研究者用 `script.google.com` 上的 Apps Script 充当收集端绕过 | 图片 URL；CSP 白名单里的可控域名 | [Simon Willison 链接博客](https://www.simonwillison.net/2023/Nov/4/hacking-google-bard-from-prompt-injection-to-data-exfiltration)，已打开核对；Google 称已修复，修法未公开 |
| 2024-06（arXiv 2406.00199） | ChatGPT 个人信息经提示注入外泄，用图片 Markdown 注入，摘要称仍只被部分缓解 | 图片 URL | [arXiv 2406.00199](https://arxiv.org/pdf/2406.00199)，仅见搜索结果摘要，未打开 |
| 2025-09-06（arXiv 2509.10540，CVE-2025-32711） | EchoLeak，Microsoft 365 Copilot：一封外部邮件零点击外泄。链式绕过：提示注入分类器、用引用式 Markdown 链接绕过链接脱敏、自动抓取的图片、CSP 允许的 Teams 代理 | 自动加载的图片 + 白名单内的代理 | [arXiv 摘要页](https://arxiv.org/abs/2509.10540)，已打开核对 |
| 2025-10-30 | Claude 代码解释器：文档里的间接提示注入让 Claude 读私有数据、写进沙箱、用攻击者的 API Key 经 Anthropic Files API 上传。“仅包管理器”的最严格网络设置仍允许访问 Anthropic API。Anthropic 的建议是“monitor Claude while using the feature and stop it if you see it using or accessing data unexpectedly” | 白名单内的官方 API，凭据是攻击者的 | [The Register 报道](https://www.theregister.com/2025/10/30/anthropics_claude_private_data/)，已打开核对；研究者 Johann Rehberger |
| 2025-12（Mindgard 报告，NSFOCUS 转述） | Amazon Kiro：steering 文件诱导 Agent 把本地文件内容拼进 Markdown 图片 URL | 图片 URL | [NSFOCUS 文章](https://nsfocusglobal.com/ai-security-incident-case-amazon-kiro-prompt-injection-vulnerability-analysis/)，仅见搜索摘要，未打开 |

规律（从上表归纳，非出处原话）：几乎所有案例的外传通道是“浏览器或服务端自动发起的请求”（图片、代理、官方 API），而不是模型执行恶意脚本；而且多次出现“CSP 白名单里恰好有一个攻击者能写入的域名”。

另有一个关于 v0 的说法：一篇新闻式文章称 Vercel 发布事后报告，承认 v0 存在提示注入，攻击者在项目描述里写指令让 Agent 把环境变量回显到外部 URL，影响不足十几个测试项目，并列出三条缺口（用户数据与系统提示未分离、生成时有网络访问且无出站过滤、用户之间无沙箱隔离）。出处：[aichatdaily.com](https://www.aichatdaily.com/ai-security/vercel-context-ai-breach)。我没有找到 Vercel 自己的事后报告，另一批搜索结果说的是 2026 年 4 月另一起 Vercel 事件（第三方 AI 工具的 OAuth 被攻破），二者未能对上。**此条未核实，只作线索。**

### 2.2 生成的界面或预览自身的隔离失败

| 时间 | 案例 | 原因 | 出处与等级 |
| --- | --- | --- | --- |
| 2026-02-17 | Open WebUI CVE-2026-26193（GHSA-vjm7-m4xh-7wrc，CVSS 7.3 高危，修复于 0.6.44）：存储型 XSS。响应消息里的 `embeds` 在 iframe 里渲染，`allowScripts`、`allowForms`、`allowSameOrigin`、`allowPopups` 全部硬编码为 true，用户可编辑聊天历史，分享的聊天同样触发；载荷可读取 localStorage 里的登录令牌并发给攻击者 | 沙箱同时给 `allow-scripts` 和 `allow-same-origin`，等于没有沙箱；设置里关闭 same-origin 的开关被忽略 | [GitHub 安全公告](https://github.com/open-webui/open-webui/security/advisories/GHSA-vjm7-m4xh-7wrc)，已打开核对 |
| 2026（日期未核） | Open WebUI CVE-2026-26192：引用弹窗里的 iframe 沙箱标志写死，同类问题；0.7.0 去掉静态的 `allow-same-origin` 并新增默认关闭的开关 | 同上 | [cvereports 页面](https://cvereports.com/reports/CVE-2026-26192)，仅见搜索摘要，未打开 |
| 2026-02-02 | `@nyariv/sandboxjs` CVE-2026-25142（GHSA-9p4w-fq8m-2hp7，CVSS 10.0，修复于 0.8.27）：基于 Proxy 的 JS 沙箱，经 `__lookupGetter__` 取到宿主的 `__proto__` 访问器，原型污染后到达宿主 `Function` 构造器，沙箱逃逸并执行任意代码 | 在同一个 JS 引擎内用对象代理做隔离，漏掉了继承自 `Object.prototype` 的旧式内省方法 | [GitLab 公告库](https://advisories.gitlab.com/pkg/npm/@nyariv/sandboxjs/CVE-2026-25142/)等多个数据库一致，我没有打开 GitHub 原公告；等级：检索 |
| 2019-10-02 | Figma 插件沙箱：原先用 Realms shim（同一个 JS 虚拟机里分内外），出现多处逃逸缺陷，第一处于 2019-09-14 公开、09-17 修复，其余私下报告、次周修复，没有发现被利用；2019-09-25 改为把 QuickJS 编译到 WebAssembly 运行插件代码。原文：混淆“沙箱内外对象”的这类 bug 在新方案里“is not possible”，代价是“somewhat slower for certain plugins, but intrinsically more secure” | 内外共用同一个 JS 虚拟机，对象身份容易混淆 | [Figma 博客](https://www.figma.com/blog/an-update-on-plugin-security/)，已打开核对 |
| 2023 前后 | vm2（Node）：README 称“researchers continuously discover new ways to escape the vm2 sandbox”、“vm2 should not be your only line of defense”，建议用隔离更强的方案（isolated-vm、独立进程或 Worker、容器或虚拟机）。我看到的 README 写“Actively maintained”，与我印象中的“已停止维护”不一致，以页面为准，未再查证 | 同一引擎内的对象代理 | [vm2 README](https://github.com/patriksimek/vm2)，已打开核对 |

我没有找到针对 Claude Artifacts 或 ChatGPT Canvas 的公开沙箱逃逸或 CSP 绕过报告（搜索过 Claude Artifacts XSS 与 CSP 绕过，未命中）。这只说明我没检索到，不说明不存在。

---

## 三、各家产品怎样隔离模型生成的界面

只记机制。除特别标注外为官方文档或规范。

### 3.1 MCP Apps（及 MCP-UI）

- 出处：MCP Apps 规范 2026-01-26 版（`modelcontextprotocol/ext-apps` 的 `specification/2026-01-26/apps.mdx`，已打开）。
- 资源：`ui://` URI，MIME 类型 `text/html;profile=mcp-app`，HTML 由 MCP 服务端提供。
- 沙箱：“All View content MUST be rendered in sandboxed iframes with restricted permissions.” Web 宿主要有一层位于不同源的沙箱代理：“The Host and the Sandbox MUST have different origins.” 代理的 iframe 必须有 `allow-scripts` 和 `allow-same-origin`（相对宿主是不同源，所以它的 same-origin 指代理自己的源）；桌面或原生宿主可不经代理直接渲染。内层 View 的 `sandbox` 属性规范里没有逐项列出（规范的安全一节也没有）。
- CSP：宿主按服务端声明的 `_meta.ui.csp` 构造 CSP 头，“Host MUST block connections to undeclared domains”，“No Loosening: Host MAY further restrict but MUST NOT allow undeclared domains”。字段：`connectDomains`（fetch／XHR／WebSocket，省略表示不允许外部连接）、`resourceDomains`（脚本、图片、样式、字体、媒体，允许通配子域）、`frameDomains`（省略则 `frame-src 'none'`）、`baseUriDomains`（省略则 `base-uri 'self'`）。未声明 `csp` 时的默认：`default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; connect-src 'none';`。规范内部有一处不一致：安全一节的示例以 `connect-src 'self'` 为底，规范正文的默认是 `connect-src 'none'`。
- 权限：服务端可申请 `camera`、`microphone`、`geolocation`、`clipboardWrite`，对应内层 iframe 的 `allow` 属性，宿主可拒绝。
- 通信：JSON-RPC 2.0 经 `postMessage`；沙箱代理转发所有不以 `ui/notifications/sandbox-` 开头的方法；宿主在收到 `initialized` 通知之前不得向 View 发请求；View 可调 `tools/call`，宿主“may block some View messages or require user approval”，应校验所有来自 iframe 的消息并记录 View 发起的调用；宿主应在 UI 需要外部域名时提示用户，宿主应实施资源限制（“a malicious View can consume CPU and memory”）。
- 另一段官方说明（MCP 文档站，经搜索摘要得到，未打开）：沙箱“does not make View requests trusted and does not replace authorization on the MCP server”。
- MCP-UI（`@mcp-ui/client`）：官方文档称“All UIs render in sandboxed iframes”，`AppRenderer` 需要传入 `sandbox={{ url }}`，指向单独的沙箱源，`AppBridge` 处理宿主与 UI 之间的 JSON-RPC。属性细节所在页面我没有取到。出处：mcpui.dev 客户端概览（已打开，信息有限）。

### 3.2 OpenAI Apps SDK

- 官方文档（developers.openai.com/apps-sdk/build/chatgpt-ui，已打开）：组件“run inside an iframe in ChatGPT”；与宿主经 MCP Apps bridge（`postMessage` 上的 JSON-RPC）通信；工具结果经 `ui/notifications/tool-result` 到达，UI 可调 `tools/call`；`window.openai` 是 ChatGPT 专有的可选扩展；示例代码在处理消息前检查 `event.source` 是 `window.parent`；文档说 `structuredContent` 要当作不可信输入。
- CSP：三个字段 `connectDomains`、`resourceDomains`、`frameDomains`，“Nested frames are blocked by default”，建议白名单尽量窄；文档说审核流程会把声明的策略与 UI 实际行为对比。
- 文档页没有写 iframe 的 `sandbox` 属性具体取值，也没解释 `domain` 字段的作用（页面里有 `domain: "https://example.com"` 示例）。社区论坛有帖子称 `_meta.ui.csp.connectDomains` 与旧键 `openai/widgetCSP` 在发布后的运行时里似乎被忽略，请求仍被拦截（等级：检索，帖子标为已解决，未核解决方式）：[OpenAI 社区](https://community.openai.com/t/published-apps-sdk-widget-updates-csp-behavior-inconsistent-after-redeploy-anyone-else-seeing-this/1381690)。

### 3.3 Claude Artifacts

- 2024-08-28 Simon Willison 转述 Anthropic 员工的说法（已打开）：“We use iFrame sandboxes with full-site process isolation.” “This protects users' main Claude.ai browsing session from malicious artifacts.” “We also use strict Content Security Policies (CSPs) to enforce limited and controlled network access.” 页面没有说 iframe 的源。出处：[Simon Willison](https://simonwillison.net/2024/Aug/28/how-anthropic-built-artifacts/)。
- 我没有找到 Anthropic 官方文档对 Artifacts 沙箱属性、域名、CSP 具体值的说明。

### 3.4 ChatGPT Canvas

- OpenAI 帮助中心（已见搜索摘要，未打开）：React／HTML 在“sandbox environment”里渲染预览；加载外部包或网络资源取决于工作区的 Canvas 网络访问设置；企业工作区默认代码执行开启、Canvas 代码的网络访问关闭，管理员可改；渲染后的 Canvas 可分享给其他用户。没有 iframe 属性、CSP 细节。出处：[OpenAI 帮助中心](https://help.openai.com/en/articles/9930697-what-is-the-canvas-feature-in-chatgpt-and-how-do-i-use-it)。

### 3.5 ChatGPT “Intelligent UI”（第三方逆向，Thesys 自家博客）

- 出处：Thesys 工程团队博客《How ChatGPT Intelligent UI works》，日期 2026-10-08，位于 OpenUI 仓库 `docs/content/blog/how-chatgpt-intelligent-ui-works.mdx`（已读）。这是 Thesys 对 ChatGPT 的逆向分析，不是 OpenAI 的说明，未独立验证。
- 其说法：模型写一种叫 DIL 的语言（Markdown + 类 JSX 标签 + JavaScript 状态与逻辑），服务端编译成 JavaScript 程序加 JSON 文档；“The program is model-written code, so it does not run in the ChatGPT page.” 客户端加载隐藏 iframe（`runner.html`），`sandbox` 为 `allow-scripts`，内容安全策略 `default-src 'none'`，iframe 里再起一个 Web Worker；Worker 在执行前从全局作用域移除网络、定时器、消息和动态代码执行能力并冻结其余全局；然后用 `new Function` 执行，把运行时对象和目录里的复合组件作为参数传入；有看门狗：超时的程序被隔离并重启 Worker。Worker 内只做协调（reconcile），输出一串“创建／设置属性／放置”操作，由 iframe 外的渲染器画出，Worker 自己不画任何东西。
- 属性校验：“properties that fail validation against the catalog are removed and recorded as diagnostics”。

### 3.6 Vercel：AI SDK 与 v0

- AI SDK 的 generative UI（官方文档 ai-sdk.dev，已打开）：“the process of connecting the results of a tool call to a React component.” 模型只选工具，工具结果传给开发者写好的组件；文档不涉及模型写代码，也没有安全论述。AI SDK RSC（`streamUI`）的现状我在该页没找到。
- v0：我没找到 v0 预览如何隔离的官方文档。Vercel 的 Sandbox 文档称每个沙箱是一个 Firecracker 微虚拟机，有独立文件系统、进程和网络，Vercel 变更日志称 v0 等团队在生产使用该基础设施（经搜索摘要，未打开）：[Vercel 指南](https://vercel.com/kb/guide/how-to-execute-ai-generated-code-safely)。这说明的是 v0 构建与运行代码用微虚拟机，不是浏览器里预览界面的隔离方式。

### 3.7 OpenUI 自己的两条路

对照 1.5：OpenUI 的主路径不执行生成代码（声明式语言加宿主登记的组件）；其“开放式 HTML 产物”示例走另一条路——模型写完整 HTML，放在 iframe 里，官方提示“keep the iframe sandbox narrow”并“enforce a Content Security Policy”（见 1.8）。对比表里 CopilotKit OpenGenUI（自由 HTML/SVG 放 iframe）的 `Security risk` 标为 `Medium`（OpenUI 自报）。

---

## 四、浏览器里可用的隔离手段及边界

每种手段给出：能挡什么、挡不住什么、与 Vue 组件共存的方式。除标明外出处为 MDN 或规范，已打开核对。

### 4.1 sandbox iframe

- 机制（MDN `iframe`）：`sandbox` 为空表示应用全部限制，用空格分隔的令牌逐项放开。不含 `allow-same-origin` 时，内容被当作一个“special origin”（不透明源），“always fails the same-origin policy”，不能访问宿主的 cookie、存储和部分 JS API。`allow-scripts` 允许脚本；`allow-forms` 允许表单提交（不放开时提交不会发送数据）；`allow-popups`、`allow-top-navigation` 等需要显式放开。
- 明确警告（MDN）：同源时同时给 `allow-scripts` 与 `allow-same-origin`，“lets the embedded document remove the `sandbox` attribute — making it no more secure than not using the `sandbox` attribute at all”。另外“Sandboxing is useless if the attacker can display content outside a sandboxed iframe — such as if the viewer opens the frame in a new tab”，这类内容应放在独立源。2.2 的 Open WebUI 案例正是这条。
- 能挡：读宿主 DOM、cookie、localStorage、调用宿主页面里的全局对象；表单提交、弹窗、顶层导航（不放开对应令牌时）。
- 挡不住：沙箱内脚本照常发网络请求（`fetch`、图片、WebSocket），除非另用 CSP 限制；消耗 CPU 和内存（MCP Apps 规范也写了“a malicious View can consume CPU and memory”）；对宿主通过 `postMessage` 暴露的一切（消息通道本身是攻击面，MDN 要求校验 `origin` 与 `source` 并校验消息结构）。
- 与 CSP 的关系：CSP3 第 7.8 节写明，本地方案文档（`srcdoc`、`blob:`、`data:`、`about:blank`）“will inherit a copy of the policies in the source document”，目的是“a page can't bypass its policy by embedding a frame or opening a new window”，继承的是创建时刻的快照。Simon Willison 2026-04-03 的测试（只用了 `allow-scripts`，Chromium 与 Firefox）显示：沙箱 iframe 内用 `<meta>` 设置的 CSP，脚本通过移除、修改、替换文档都无法解除，导航到 `data:` URI 后仍然有效。出处：[Simon Willison](https://simonwillison.net/2026/Apr/3/test-csp-iframe-escape/)（已打开；细节在他的 `simonw/research` 仓库，我没有看）。CSP3 的另一处说明：`report-uri`、`frame-ancestors`、`sandbox` 指令在 `<meta>` 里无效（第 3.3 节注）。
- 与 Vue 共存：不能直接把宿主页面里的 Vue 组件放进沙箱 iframe。iframe 是独立文档，里面要另起一个应用并自带组件代码与样式；宿主与沙箱的事件靠 `postMessage` 传，数据要能结构化克隆（函数、DOM 节点传不过去）。MCP Apps 的做法是整个 UI 是一个自包含的 HTML 资源，不共享宿主设计系统，OpenUI 官方博客也承认这一点：“The resource does not share a design system with the host … And there is no incremental streaming over the transport: the resource arrives whole”（`state-of-generative-ui-report.mdx`，官方博客，自报）。要让沙箱内用 `nb-ui` 的组件，需要把组件库打包进沙箱页面；这是我从机制推出的，不是出处原话。
- 性能：每个 iframe 是独立文档、独立 JS 环境，有额外加载与内存开销（MCP Apps 对应的官方博客文字：“Sandboxing adds overhead”）。

### 4.2 CSP 能否挡住外传

- `connect-src` 覆盖的接口（MDN 列出）：`<a ping>`、`fetch()`、`fetchLater()`、`XMLHttpRequest`、`WebSocket`、`EventSource`、`navigator.sendBeacon()`。缺省时回退到 `default-src`。
- 图片、字体、样式、脚本、媒体各有自己的指令（`img-src` 等）；MCP Apps 的默认 CSP 因此把 `default-src` 设为 `'none'`，再逐项开放。
- 不回退到 `default-src` 的指令（MDN 目录归类，页面本身没给明确清单）：`form-action`、`frame-ancestors`、`base-uri`、`sandbox` 等。检索结果（HackTricks 一类，二手）说缺少 `form-action` 会让表单提交不受限，`navigate-to`（限制导航目标）浏览器支持有限，不能单独依赖；我在 MDN 的 CSP 页面里没有找到 `navigate-to` 或 `webrtc` 指令。
- CSP3 第 8.6 节（Exfiltration）：“Content Security Policy can mitigate data exfiltration if used to create allowlists of servers”，但“a policy which lacks the default-src directive cannot mitigate exfiltration”，并且存在“kinds of requests that are not addressable through a more-specific directive”；即使 `img-src 'none'; script-src 'none'; font-src 'none'`，仍可能经 `fetch()` 或预取外传。
- 检索结果（二手，且自述不可靠）列出的其他渠道：`<link rel="dns-prefetch">`、WebRTC（经 STUN/TURN）、CSS 属性选择器泄露、`window.location` 导航。我没有找到权威来源核实 WebRTC 与 dns-prefetch，**此处存疑，未验证**。
- 白名单里的域名自己可写：Bard 的 Apps Script（2.1）、EchoLeak 的 Teams 代理、Claude 的 Files API（用攻击者的凭据）。这说明 CSP 只管“去哪里”，不管“那个地方是谁的”。
- 不使用 `allow-same-origin` 的沙箱 iframe 也要靠 CSP 才能限制网络；两者是叠加关系：sandbox 防读宿主，CSP 防外发。

### 4.3 Web Worker

- 能挡（MDN）：Worker 里没有 DOM，“The main thing you can't do in a Worker is directly affect the parent page. This includes manipulating the DOM and using that page's objects.”
- 挡不住：Worker 里 `fetch()`、`XMLHttpRequest`、WebSocket、IndexedDB 都可用；Worker 脚本有自己的执行上下文，“in general, not governed by the content security policy of the document … that created them”，例如页面 CSP 为 `script-src 'self'`，Worker 内仍可使用 `eval()`；只有 `data:`／`blob:` 等全局唯一标识源的 Worker 才继承创建者的 CSP；要给 Worker 设策略，要在送达 Worker 脚本的响应上加 `Content-Security-Policy` 头。同源的 Worker 与页面共享该源的存储（IndexedDB 等）。Worker 也能无限循环占用线程（可 `terminate()`，这一点是我的认知，MDN 页面本次未取到）。
- 因此直接把生成代码放进同源 Worker，只防住 DOM，不防网络和同源存储；Thesys 描述的 ChatGPT 做法是把 Worker 放进 `sandbox="allow-scripts"` + `default-src 'none'` 的 iframe 里，并在 Worker 全局里删除网络和动态执行能力（3.5，逆向，未验证）。
- 与 Vue 共存：Worker 里没有 DOM，Vue 组件渲染不了；只能让 Worker 产出数据或“操作列表”，由主线程渲染（Thesys 对 ChatGPT 的描述正是如此）。通信用 `postMessage`，数据结构化克隆（复制不共享，函数不能传）。

### 4.4 ShadowRealm

- 状态（TC39 仓库 README，已打开）：页面写“Currently at Stage 2.7”，同时演示列表里有 2024 年 12 月“Stage 3 Request”，状态行可能过期；页面没说有哪些浏览器已发布。explainer 说目前替代做法是 Node 的 VM 模块和浏览器的同源 iframe。
- 官方立场（explainer，已打开）：“not aiming to defend against malicious code or xss injections”；安全评级为 integrity ✅、availability ⛔️、confidentiality ⚠️；与外层同进程同堆同线程；“can produce resource exhaustion”；存在计时侧信道；跨 realm 靠“callable boundary”，非原始值不能直接传，只能用包装函数；执行受外层 CSP 约束，不允许 `unsafe-eval` 的策略会挡住 `ShadowRealm#evaluate`。
- 结论性事实：官方自己说它不是安全边界。

### 4.5 SES／Hardened JavaScript（Endo）

- 提供（SES README，已打开）：`lockdown()` 改变所在 realm，冻结共享内置对象；`Compartment` 是独立执行上下文，有自己的全局对象，默认不获得 `fetch` 等宿主 API；`harden` 冻结对象图。声称可安全执行第三方 strict 模式 JS。默认连 `Date.now`、`Math.random` 和 `Date` 构造器的行为都被禁用，可按需授予。
- 不挡：可用性（客户代码可“execute for an indefinite amount of time”、“allocate arbitrary amounts of memory”，Compartment 不能缓解）；计时（`SharedArrayBuffer` 可造高精度计时器，宿主不得向客户暴露它）；宿主交给 Compartment 的任何对象（“a host program is responsible for maintaining any of the invariants above that it considers necessary”）；V8 和 SpiderMonkey 上遮蔽调用栈，JavaScriptCore 上做不到。
- 使用要求：建议作为单独的 script 标签引入（避免打包器的供应链风险）；`lockdown()` 作用于整个 realm，会冻结页面里的内置原型，可能与依赖修改原型的库冲突（我从机制推出，README 本次未明说这一点）。
- 与 Vue 共存：把 Vue 组件当作 `endowment` 传进 Compartment 就等于把宿主能力交给了客户代码（组件内部可以访问 DOM）；SES 本身不处理 DOM。要在同页使用，须自己设计“只传哈登后的、无权限的代理”。这是机制推断。

### 4.6 QuickJS／WebAssembly 解释器

- `quickjs-emscripten`（README，已打开）：在 WebAssembly 里运行 QuickJS，支持大部分 ES2023；“By default, no host functionality is exposed to code running inside QuickJS.”；可设内存上限、最大栈和 `shouldInterrupt`（截止时间等）中断；每个 context 有自己的全局。README 自述：“This project makes every effort to be secure, but has not been audited. Please use with care in production settings.” 版本低于 1.0，API 可能变；asyncify 版本更大更慢；全部变体安装体积约 9 MB，单变体核心包约 1.3 MB；许可证页面未取到，需看仓库 LICENSE。
- 旁证：Figma 2019 年从 Realms shim 换成 QuickJS-in-WebAssembly，理由是对象身份混淆在新方案里“is not possible”，代价是“somewhat slower for certain plugins”（2.2）。
- 挡住：JS 引擎层面的逃逸（对象与宿主不共享）、宿主 API（默认没有）、死循环与内存（有限制手段）。
- 挡不住：宿主主动暴露的函数；解释器自身或 Wasm 运行时的漏洞（README 说未审计）。
- 与 Vue 共存：解释器里没有 DOM，也没有 Vue。客户代码只能产出数据或操作，由宿主主线程用 Vue 渲染。因此“LLM 直接写 TSX”要多一步编译和 JSX 工厂：把 JSX 编译成对宿主提供的 `h()` 之类函数的调用，返回纯数据树，宿主再映射到真实组件。这一点是我从机制推断，OpenUI 博客对 ChatGPT 的描述正是这种形态（3.5）。

### 4.7 小结表

| 手段 | 挡 DOM／宿主存储 | 挡网络外传 | 挡死循环与内存 | 与宿主 Vue 组件同页共存 |
| --- | --- | --- | --- | --- |
| sandbox iframe（无 `allow-same-origin`） | 是 | 否，需加 CSP | 否（资源限制要宿主做） | 否，组件需打进 iframe，用 `postMessage` 通信 |
| 同源 Worker | 挡 DOM，同源存储仍可访问 | 否，且页面 CSP 不自动管 Worker | 可 `terminate()` | 否，只能产数据，主线程渲染 |
| ShadowRealm | 官方自称非安全边界 | 否 | 否 | 提案未落地，且无法保证安全 |
| SES Compartment | 默认无宿主 API | 默认无 `fetch`，但取决于授予了什么 | 否 | 可以，但要自己设计授予的能力 |
| QuickJS-wasm | 是（默认无宿主 API） | 是（默认无网络） | 有手段 | 否，只能产数据，主线程渲染 |

表中“是”都以对应一节的出处为准，且都以“没有向客户代码暴露额外能力”为前提。

---

## 五、在页面里执行代码之前的静态手段

### 5.1 能做什么

- 把代码解析成 AST，检查导入语句只来自白名单组件，禁止某些全局标识符（`fetch`、`window`、`document`、`eval`、`Function`）、动态 `import()`、`new Function`、`constructor` 成员访问等。这是常见的想法，我没有找到某个主流产品公开说它们靠这个方式隔离。
- 对 JSX 本身：React 不清洗 URL 属性，`href="javascript:..."` 可在点击时执行（二手来源，且这些来源称 React 控制台警告“a future version of React will block javascript: URLs”，但没确认现状）；`dangerouslySetInnerHTML` 是另一条路径，需要消毒（如 DOMPurify）。OpenUI 的 `react-ui` 里针对 URL 做了 `safeUrl`（1.5），也印证了这类 sink 需要逐个处理。

### 5.2 为什么不能单靠它（有出处的部分）

- 动态性：JS 能用计算属性名、字符串拼接、原型链从任意对象走到 `Function` 构造器。SandboxJS 的 CVE-2026-25142 正是通过 `__lookupGetter__` 取得宿主 `__proto__` 访问器，再到 `Function` 构造器（2.2，检索）。静态黑名单要挡的是“所有能到达的路径”，而不是几个标识符。
- 沙箱库自己都难做对：vm2 README 称持续有新的逃逸方式，SandboxJS 有满分的 CVE，Figma 的 Realms shim 有多处逃逸（2.2）。这些是“运行时对象代理”类沙箱，不是 AST 检查，但它们说明在同一引擎内拦截所有路径很难。
- 我没有找到专门论述“AST 黑名单检查对 JavaScript 不够”的权威出处（搜了一次，只命中 SandboxJS 的 CVE 写作），**以上结论里属于“静态检查不充分”的部分是我的推断，不是出处原话**。

### 5.3 与另一类静态手段的对照

OpenUI 把“静态”做在语言层而不是 JS 层：语言本身没有赋值给宿主对象、调用任意函数、动态属性访问的能力，只能引用登记的组件和函数，因此“白名单”是语言的语法边界而不是事后过滤（1.5）。它仍然需要对 URL、图片地址等 sink 单独处理（1.5 的两点观察）。

---

## 六、没查到或存疑

1. OpenUI Vue 运行时只读了 README 和源码目录，未运行；其 README 里 `examples` 的 `<Greeting ... />` 写法与 OpenUI Lang 语法不符，原因未查清。Vue 包停在 OpenUI Lang 0.x，1.0 特性是否在路线图上，没有查到。
2. `@OpenUrl` 绕过 `safeUrl` 的位置（`actionMessage.ts` 第 28 行）只是读源码，未在浏览器验证 `window.open("javascript:...")` 的实际表现；是否所有渲染路径都经过这里也没逐一查。
3. OpenUI 的 “up to 67%” 与 token 基准全是自报，未复现；基准的对比对象包含 Thesys 自家格式。
4. OpenUI 官方文档里没有关于提示注入的专门论述；`Query`／`Mutation` 的工具调用在浏览器端发起，工具参数由模型决定，官方只提醒“像校验普通客户端请求一样在 API 路由里校验”。
5. Claude Artifacts、ChatGPT Canvas、v0 预览的具体 `sandbox` 属性、源与 CSP 值没有官方文档；只有 2024 年 Anthropic 员工的口述、OpenAI 帮助中心的一句话、Vercel 沙箱产品页。ChatGPT Intelligent UI 的做法只来自 Thesys 的逆向文章。
6. 没有找到针对 Claude Artifacts 或 ChatGPT Canvas 的公开沙箱逃逸或 CSP 绕过报告；搜索没命中不等于没有。
7. v0 提示注入事故只有一篇新闻式二手文章，未找到 Vercel 原始事后报告，未核实。
8. CSP 之外的外传渠道（dns-prefetch、WebRTC、`window.location` 导航）只有二手检索结果，未经权威来源核实，也未实测。
9. ShadowRealm 的当前阶段、浏览器实现状态：仓库页面的状态行与演示列表互相矛盾，未查到各浏览器的实现状态。
10. `quickjs-emscripten` 的许可证、QuickJS 的性能数字、SES 与 Vue 同页共存的实际做法，都未实测；相关“与 Vue 共存”的描述标为机制推断。
11. 没有查 MCP elicitation、A2UI、json-render、JSON Forms 等，那些归另一份调研。
12. 星标、发布时间等随时间变化的数字，取自 2026-10-20 当天的查询。
