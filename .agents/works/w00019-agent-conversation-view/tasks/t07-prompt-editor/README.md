---
schema: nbook.task/v2
taskId: t07-prompt-editor
status: done
updated: 2026-10-22
---

# 提示词编辑器 PromptEditor

## 目标

切片 S6 的前一半：把输入框里的文本编辑器重做成独立组件 `PromptEditor`，供新输入框（t09）与历史消息的就地编辑共用。开发者 2026-09-30 确认 S6 拆成编辑器与输入框两个 Task，并认为现有编辑器不规范、需要重构。

## 合同

- 组件文档 [`PromptEditor.md`](../../../../../packages/neuro-book/app/components/common/form/PromptEditor.md)，先于实现写，“文字写法”一节是输入框、消息视图与服务端共用的数据格式。
- [ui.agent-conversation-view](../../../../../docs/specs/ui/agent-conversation-view.md)（planned）：本 Task 改了“服务”（触发菜单可分组、禁用、逐级进入，上下文带“是否位于开头”）、“消息”（已发送消息按输入框的方式显示附件与粘贴块）、“输入框与待处理区”（文字写法、附件、粘贴分档、输入历史、点击标签）、ctx 的 `composer` 行与 action 表（附件 action 改名并带 `kind`，新增 `attachment.open`、`skill.open`）。
- 需要后端补的三件事记入[数据层后续提案](../../../../../packages/neuro-book/docs/proposals/agent-session-data-layer.md) B9 到 B11：非图片附件上传、文件附件路径可被读文件工具读取、图片编号让模型看到。

## 现有编辑器的问题

旧编辑器是 `packages/neuro-book/app/components/common/form/ReferencePlainTextEditor.vue`（962 行，TipTap），输入框、旧历史消息编辑器和 `NovelPromptBar` 都在用：

- 放在公共目录，却引用 `novel-ide/agent/` 的触发菜单、建议项与图片事务类型，依赖方向反了；新组件按约定不能引用那个目录，因此没法复用。
- 图片上传状态由宿主通过十几个 expose 方法命令式写进编辑器，宿主漏接一个，标签就一直转圈；与新视图只走 props 与事件的边界冲突。
- 宿主改 `modelValue` 时直接覆盖用户正在输入的内容；新 Spec 用草稿版本号。
- 菜单浮层写死去找 `.novel-ide-theme`，无边框样式的圆角绑死输入框的变量；高度靠定时测量。
- 菜单外观不好，数据流有问题：开发者遇到过技能列表加载的 bug；加载中是用一个禁用的假候选项表示的。

## 需求（开发者 2026-09-30 逐条确认）

- 使用场景：Agent 输入框、历史消息就地编辑；`NovelPromptBar` 的需求一并考虑，但不在本 Work 迁移。
- 不做 Markdown 实时格式；图片、附件、技能、文件引用、`/` 命令要有专门的样子。
- 大段粘贴参照 omp（调研结论见进展记录）：小段原样；中等的在粘贴处包成 XML 标签的块；特别大的转为附件，只给模型路径，以后可以做 omp 那种 `local://` 地址，目前走会话附件；可配置为中等的也放到开头、粘贴处留位置标记。
- 图片与文本附件一样：附件条显示缩略图，正文留 `#N`；发给模型时图片保留位置。
- 编号与 omp 一样分开计：图片一套，文件与粘贴另一套。
- PDF、txt 等可以拖进来作为附件。
- 菜单重做，位置保持贴着输入框；`@` 没输入时列类别，输入了就全局搜索。
- 点击标签可以有反应（打开引用、预览附件），相关系统还没做好，先发出 action，在 Lab 事件日志里验证。
- 空输入框里按上方向键调出上一条已发送的内容；Ctrl+R 搜索已发送的内容。
- 保留展开模式，不做全屏编辑。
- 已发送的消息按输入框的方式显示附件条、`#N` 与折叠的粘贴块。
- 新编辑器与旧的并存，旧的不动；新侧栏接入主页面后再迁移 `NovelPromptBar` 并删除旧编辑器。

在此基础上的取舍（写进了组件文档）：
- 放在 `app/components/common/form/`，不依赖任何 Agent 类型，是受控零件，只有 `state:local`：菜单就地渲染、不传送，高度用 CSS 夹住、不定时测量。
- 文字是唯一真相，读进来的文字原样写回；沿用现有的引用、技能、选区、图片写法，新增 `[file #N · 名称](目标)`、`<paste id="N">…</paste>`、`[paste #N]`，图片新写成 `![image #N](目标)`，旧草稿里没有编号的图片按顺序补号但文字不改。
- 分档默认值：内联上限 10 行、1000 字符（与 omp 相同），附件下限 100 行或 20000 字符（omp 只按行数，单行的超长文本不会触发）。
- 粘贴块展开后可以就地编辑（开发者 2026-10-01 决定：omp 是终端界面才不让编辑，图形界面可以更进一步），也可“转为文字”。Ctrl/⌘+Shift+V 粘贴原文，与 omp 的原样粘贴键对应。
- 菜单结果带 `loading` 与空结果文字，数据到达时宿主换一个新的 `resolveMenu`，不再用假候选项表示加载中。
- 附件条归编辑器，输入框与历史消息编辑都能用。外露只保留 `focus` 与 `insertText`。

## 范围与实现顺序

1. 文字写法的读入、写回与编号，触发匹配：纯函数与单测（读入再写回必须逐字相同）。
2. 编辑器本体：标签、按键、触发菜单、只读、`bare`、展开所需的高度参数。
3. 附件：附件条、图片与文件的加入、状态、移除联动。
4. 粘贴分档与粘贴块、粘贴原文。
5. 输入历史：上下方向键与 Ctrl+R 搜索。
6. Lab 场景与 smoke：打字与 `change`、回车与 Ctrl/⌘+回车、菜单的方向键与确认、加载中与空结果、标签整体删除、粘贴三档、附件状态、草稿版本替换、输入历史。

每步做完在 Lab 里可以单独看；视觉由开发者在 Lab 确认。

## 非目标

- 输入框本身（发送与 steer/followup/停止、命令执行、模式与模型、横幅、提问向导、排队消息、展开按钮）与历史消息就地编辑的接线：t09（t08 已用于 Lab 治理）。
- 已发送消息按新方式显示（`AgentUserContent` 的附件条、`#N` 与粘贴块）：t09。`composer.submit` 的 `images` 字段在附件都写进文字后是否还需要，也在 t09 定。
- 后端：非图片附件上传、文件附件的读取、图片编号进入模型请求（数据层提案 B9 到 B11）。
- 迁移 `NovelPromptBar`、删除旧编辑器。

## 当前状态（2026-10-01）：开发者已确认

实现文件都在 `packages/neuro-book/app/components/common/form/`：`PromptEditor.vue/.md`，以及 `prompt-editor/` 下的文字读写 `prompt-text.ts`、编辑器扩展 `prompt-editor-extensions.ts`、附件簿记 `prompt-attachments.ts`、类型 `prompt-editor.types.ts`、节点视图 `PromptTokenView`、`PromptPasteBlockView`，纯展示的 `PromptMenuPanel`、`PromptAttachmentStrip`（各带同名 `.md`）。Lab 登记了 `PromptEditor`（夹具扮演宿主，10 个场景）、`PromptMenuPanel`、`PromptAttachmentStrip`；新增 smoke 套件 `smoke:component-lab:prompt-editor`。旧编辑器与 `novel-ide/agent/` 未改动。

验证（2026-10-01，master 工作区，Lab 开在 3002 端口）：

- `bun run test -- app/components/common/form/prompt-editor`：3 个文件 130 条通过（文字读写与编号、编辑器扩展、挂载后的事件与粘贴块编辑）。
- `bun run smoke:component-lab:prompt-editor`：18 组检查通过（第三轮后）；变异检查确认能抓到组字不冻结查询、方向键不跳过禁用项、成对删除失效、点菜单项丢焦点、上方向键不看视觉首行这五处。`smoke:component-lab:core` 通过。
- `lab:shot`：三个组件的全部场景在手机与 1400×900、昼夜配色下无溢出、无页面报错。
- `bun run typecheck` 0 错误；`scripts:typecheck` 通过；`docs:check` 与 `governance:check` 失败 0。
- `app/component-lab` 与 `app/components/common` 的单测里另有 `WorkbenchShellLayoutFixture`、`DesktopTitleBar`、`DesktopTitleBarChrome` 失败（`localStorage.clear` 不存在、`DOMMatrix is not defined`），与本 Task 无关，从报错推断是本机 Node 26 的测试环境问题，未在干净检出上复跑。

## 进展记录

- 读了旧编辑器、它的 TipTap 扩展与文字读写（`app/utils/plain-reference-text.ts`）、服务端对图片写法的解析（`shared/agent/agent-image-markdown.ts` 与 `neuro-agent-harness.ts`），确认文字写法是跨端的产品数据，新编辑器必须兼容。
- nb-ui 的 `Popover` 不能锚定到光标、打开时会把焦点移进浮层，不适合做边打字边选的触发菜单，所以菜单由编辑器自己画。
- 子代理调研了 omp（`@oh-my-pi/pi-tui` 与 `pi-coding-agent` 源码）的大段粘贴：
  - 分档：超过 10 行或 1000 字符时，主输入框插一个 `📄 #1` 标签，上方卡片预览前 4 行；发送时原位换回原文，默认不包标签。
  - 大段：100 行及以上（设置项 `paste.largeMenuThreshold`，可选 0、100、250、500、1000）弹菜单三选一：原样、包成 `<attachment>…</attachment>`、存为会话本地文件 `local://paste-N.md`（模型用读文件工具读）。
  - 编号：每条消息内只增不减，发送后归零；图片单独计数。
  - 删除：退格删整个标签，连同内容。
  - 图片：正文写 `[Image #N]`，图片本体附在文字之后。
  - 文件：拖入非图片文件只当路径文字；`@路径` 在发送时读取，文本文件包成 `<file path="…">` 附在消息后。
  - 没有“附件放到开头”的设置，只有命令行 `omp @文件` 会把文件内容放在消息前面。
- 2026-10-01 实现时与计划不同的几处：
  - 节点视图的附件状态、悬停联动经扩展选项传入（节点视图的 `extension` prop），不用 provide/inject：公共目录的组件耦合度必须为 0，`state:inject` 计入耦合。
  - 编辑器用 `@tiptap/vue-3` 的 `Editor` 的子类，`state` 改为直接读视图状态：换草稿版本时用 `view.updateState` 换整份状态（清空撤销历史），原类读的是一份随事务更新的响应式副本，不会跟着变。
  - ProseMirror 找不到文字光标时会退成全选（正文只有粘贴块时 `focus("end")` 就会这样，接着输入会替换全文），开头、末尾与读入后的光标都改由 `edgeSelection` 放，那一端是粘贴块时放间隙光标。
  - `atStart` 收紧为“触发字符前面没有任何内容”，与命令只认正文第 0 个字符一致；选区标签的 `startLine`、`endLine` 可为 null（`[[路径]]` 没有行号）。
  - 内部复制粘贴不解析剪贴板 HTML，读 `text/plain` 按结构重新读入：复制出来的文字就是原文。
  - 菜单在没有可确认的项时，回车照常发送、Tab 照常移动焦点，已写进组件文档。
- 2026-10-01 环境：根依赖 `koffi` 已在锁文件里但本机没装，开发服务器与 `nuxt typecheck` 起不来；按锁文件执行 `bun install --frozen-lockfile` 后恢复，锁文件未变。
- 2026-10-01 开发者在 Lab 里试用后的反馈与处理：
  - 手打的 `$reviewer` 不变标签：原规则是只有读入、粘贴、菜单确认才出标签。改为写完即变（`$名称` 与开头命令在后面打了空白或标点时，以括号收尾的写法在打出收尾括号时），只改显示、不改文字；粘贴原文与“转为文字”的内容不自动变。另外技能写法与触发字符前面允许中文标点（“，$reviewer”）：服务端不解析 `$技能`，是模型读文字，所以这只影响显示与菜单。
  - 行首是标签时 Home 停在标签后面（浏览器自带行为）：Home、End 改为按坐标找光标所在屏幕行的行首行尾，Shift 同时选中。
  - Ctrl+A 时标签没有选中反馈：标签设了不可选中，浏览器不画底色。改为选区覆盖节点时用 TipTap 给节点视图的 `selected` 自己画。先试过给节点加装饰，TipTap 只在节点本身变化时才把装饰传给节点视图，没生效。粘贴块之后那一段开头的字仍没有选中底色，DOM 选区其实覆盖了它，是 Chrome 的绘制问题，未处理。
  - 附件目标不用 sha256 长路径：改为会话内短地址 `local://名称`（名称唯一、不含空白与括号，由宿主在上传完成时给出），写进组件文档与数据层提案 B10；编辑器把目标当不透明字符串，不用改逻辑，旧的长路径照常识别。
- 2026-10-01 第二轮反馈：
  - 行尾标签后面没有字时，从标签右边往回拖选，光标跟着鼠标走、拖不出选区。对比实验定位到 ProseMirror 在行尾不可编辑节点后插的占位图 `img.ProseMirror-separator`：隐藏后锚点保持不变，点在标签右边放光标、前后拖选、跨行拖选都不受影响（Chromium）。样式里隐藏它，smoke 加了这条并做了变异检查。
  - 附件卡片悬停的描边是“1px 描边 + 2px 外环”两层，缩略图圆角比描边内侧小、四角露底，按钮伸出卡片压住相邻卡片。改为描边画在缩略图之上（悬停、聚焦、联动时一层 2px 强调色），缩略图铺满并按圆角裁切，按钮收进卡片右上角。
  - Lab 组件树（不属于本 Task，开发者顺带要求）：行里只写组件名，显示名与别名留在顶栏补充说明与检索里；选中的组件不在可见范围时自动滚到可见处。已同步 `docs/specs/ui/component-lab.md`，core smoke 加了检查并做了变异检查。
- 2026-10-01 第三轮，开发者决定：`PromptEditor.vue` 不拆分；粘贴块做成展开后可编辑。实现：
  - 粘贴块仍是原子节点。内容完整显示时（展开，或不超过 3 行）正文区换成外观相同的文本框，每次输入用 `setNodeMarkup` 写回节点属性：叶子节点上它是一次带位置映射的替换，连续输入在撤销历史里合并成一步（只改属性的 `AttrStep` 不合并，变异检查确认）。
  - 文本框里的 Ctrl/⌘+Z、Ctrl/⌘+Shift+Z、Ctrl+Y 走编辑器的历史，撤销后光标放在变化处；撤掉整个粘贴块时焦点回到正文。Ctrl/⌘+回车发送；Escape 与开头、末尾的方向键回到正文里块的前后（`selectionBesideBlock`）。
  - 恰好是 `</paste>` 的一行会让写回的文字提前结束，这样的输入不写回、文本框标为无效并给出说明，离开时恢复。
  - `focus`、`blur` 改由正文区的 `focusin`、`focusout` 判断：焦点在正文与文本框之间移动不再发出，编辑器外框保持聚焦样式。
  - Lab：`PromptEditor` 改按“撑满”显示（`component-index.ts` 的 `deriveDisplayMode`），夹具根容器去掉 `min-h-[460px]` 与留白，编辑器在舞台里垂直居中（起初贴底，开发者指出左下、右下角被画布圆角裁掉）；`bare` 的外框标 `data-lab-host`。Lab 治理的其余改动记在 [t08](../t08-lab-governance/README.md)。
  - 验证：上面单测与 smoke；`lab:shot` 展开后的粘贴块在手机与 1400×900、昼夜配色下无溢出。
- 2026-10-01 第四轮：空正文按 Ctrl/⌘+A 会出现一小块像空格的选中底色。原因是全选覆盖了唯一的空段落，Chrome 把它的占位换行画成选中底色；正文为空时 Ctrl/⌘+A 改为什么也不做（`isEmptyPrompt`）。单测覆盖判空，smoke 的 `line-edges` 检查空正文全选后浏览器选区是折叠的。新增 `fill`（撑满父元素的高度），见 [t08](../t08-lab-governance/README.md) 的“画布与撑满”。

