---
schema: nbook.task/v2
taskId: t09-composer
status: done
updated: 2026-10-22
---

# 输入框

## 目标

切片 S6 的后一半：用 t07 的 `PromptEditor` 做出对话视图的输入框，接上历史消息的就地编辑，并让已发送的消息按输入框的方式显示附件与粘贴块。开发者 2026-10-01 确认范围与顺序，并同意先把 `app/components/agent/` 按界面区域分目录。

## 合同

- [ui.agent-conversation-view](../../../../../docs/specs/ui/agent-conversation-view.md)（planned）：“消息”“输入框与待处理区”两节、ctx 的 `composer` 与 `editing`、服务 `resolveTriggerMenu`、action 表的输入框与提问两组。
- 组件文档 [`PromptEditor.md`](../../../../../packages/neuro-book/app/components/common/form/PromptEditor.md) 的“文字写法”：输入框发出的文字与已发送消息的显示都按它。

## 范围与顺序

0. **目录分类**（已完成）：`agent/` 平铺的 54 个文件分到 `parts/`、`stream/`、`tools/`，根目录只留顶层组件、类型、注册表与内置登记；分法与依赖方向写在 [`agent/README.md`](../../../../../packages/neuro-book/app/components/agent/README.md)。
1. **已发送消息的新显示**：用户消息里的文字按“文字写法”显示，引用、技能、命令是标签，图片与文件进附件条、正文留 `#N`，粘贴块默认折叠。点击标签：引用发出 `reference.open`，图片打开原图预览，文件发出 `attachment.open`，技能发出 `skill.open`。
2. **输入框本体** `AgentConversationComposer`（旧目录已有 `AgentComposer`，Lab 按组件名区分，不能重名）：回车发送，运行中回车为 steer、Ctrl/⌘+回车为 followup，运行中且输入为空时发送按钮变为停止；`/` 命令发出 `command.run`；触发菜单接 `services.resolveTriggerMenu`；附件上传状态；模式、模型与思考档位，Shift+Tab 切换模式；展开按钮；排队中的消息；输入历史。
3. **历史消息就地编辑**：用户消息就地变为 `PromptEditor`，原文还在加载时只读并显示加载状态；提交发出 `message.editSubmit`，Escape 或取消发出 `message.editCancel`。
4. **横幅与提问向导**：`availability` 不是 `ready` 时输入框上方显示横幅与恢复动作、输入框只读；有待回答的提问时提问向导替换输入框。
5. **合同同步**：视图类型跟上 t07 改过的 Spec（附件 action 带 `kind`、`attachment.open`、`skill.open`、触发菜单可分组与逐级进入、上下文带 `atStart`）；决定 `composer.submit` 的 `images` 字段去留。

每步做完在 Lab 里可以单独看，视觉由开发者确认。

## 设计取舍

- **已发送消息不用只读的 `PromptEditor` 显示**：每条消息挂一个编辑器实例，长对话里会有上百个，每个都在 `document` 上监听选区变化；编辑框的 `role="textbox"` 也不适合放在消息里。改为新增静态显示组件 `PromptTextView`（与 `PromptEditor` 同在 `common/form/`），用同一套读入函数解析文字。标签与粘贴块的外观抽成纯展示零件 `PromptTokenChip`、`PromptPasteFrame`，编辑器的节点视图与静态显示共用，附件条直接复用 `PromptAttachmentStrip`，避免两份样式各自走样。

## 非目标

- 待处理区的其他条目（Workflow 待回答、工作区变更）、顶栏、状态栏、面板与弹窗：S7。
- 后端：非图片附件上传、文件附件的读取、图片编号进入模型请求（数据层提案 B9 到 B11）。
- 接入主页面、迁移 `NovelPromptBar`、删除旧编辑器。

## 当前状态（2026-10-22）：已收尾，剩余部分移交 t10、t11

- 第 0、1 步开发者已确认（含重做的原图预览）。第 2 步已实现，开发者没来得及在 Lab 确认。
- 代码一直没提交，2026-10-13 随归档提交 `865c9f593`（分支 `archive/legacy-ui-tuning`）原样保存。
- 2026-10-21 w00019 重新打开，方向改为单独成包 `nb-agent-ui`（见 [Work README](../../README.md#重新打开开发者2026-10-21)），本 Task 不再在旧应用上继续：
  - 第 0 到 2 步的代码随 [t10](../t10-migrate-nb-agent-ui/README.md) 迁进新包，第 2 步的 Lab 确认放到迁移之后；
  - 第 3、4 步（就地编辑、横幅与提问向导）并入 [t11](../t11-complete-view/README.md)；
  - 第 5 步的合同同步已在第 2 步做完，Spec 改动在归档提交里，t10 把 Spec 搬回 `docs/specs/ui/` 时一起带上。
- 下文的路径都指归档提交里的旧应用目录 `packages/neuro-book/app/`，验证结果也都是旧应用上的。

## 已做部分（2026-10-01）


第 2 步的设计：

- `agent/composer/` 下：`AgentConversationComposer`（排队消息、拒收提示、`PromptEditor`、工具栏）、`AgentModelPicker`（模型与思考档位合在一个下拉里，窄屏不挤）、`AgentQueuedMessages`（排队消息，S7 再收进待处理区）；纯逻辑 `composer-submit.ts`（回车与 Ctrl/⌘+回车的投递方式、命令识别）。
- 点击标签的去向（引用、选区、技能、文件、图片）抽成根目录的 `prompt-token-action.ts`，输入框与 `AgentUserContent` 共用。
- 内置登记 `builtin-composer.ts`：触发字符 `@`、`$`、`/`；命令沿用旧输入框菜单与旧宿主能处理的那一套（new、plan、mode、model、compact、clear、rename、summarize、fork、settings），执行仍由宿主决定。
- `/` 位于正文开头时，菜单由视图按注册表的命令列出（说明与参数提示来自登记项）；其余触发字符的菜单来自 `services.resolveTriggerMenu`。Spec 原文是“菜单内容都来自服务”，登记项里的说明与参数提示却没有地方显示，所以改为这样并回写 Spec。
- `PromptEditor` 外露补 `insertFiles(files)`，输入框的“添加附件”按钮用它，行为与粘贴文件相同。
- `composer.submit` 去掉 `images`：附件都写进了文字，文字是唯一真相，宿主需要时从文字里读。
- 视图类型跟上 Spec：`composer.attachments`（带种类与就绪目标）、`recall`、`pastePolicy`，附件 action 改名带 `kind`，触发菜单可分组、禁用、逐级进入，上下文带 `atStart`。

第 1 步的实现：

- `common/form/prompt-editor/PromptTokenChip`、`PromptPasteFrame`：从两个节点视图里抽出的纯展示零件，节点视图改为包一层用它们，外观不变。折叠行数 `PASTE_COLLAPSED_LINES` 与联动键 `numberKey` 挪到不依赖编辑内核的 `prompt-text.ts`。
- `common/form/PromptTextView`：静态显示一段文字写法，附件条直接用 `PromptAttachmentStrip`（只读）。
- `agent/stream/AgentUserContent`：文字块改用 `PromptTextView`；点击引用、选区、技能、文件发出 `reference.open`、`skill.open`、`attachment.open`，点击图片发出新事件 `preview-image`，经轮次、过程块与原始视图转给 `AgentConversationView`，由它打开 `OriginalImagePreviewDialog`（取 `resolveAttachmentUrl(locator, "original")`，取不到不打开）。旧消息里文字外面的附件块照旧显示，改为可点击。
- 视图类型补上 Spec 已有的 `attachment.open`、`skill.open`；Spec“消息”一节写明点击结果与输入框相同。
- Lab：登记 `PromptTokenChip`（11 个场景）、`PromptPasteFrame`（5 个）、`PromptTextView`（4 个）；`AgentUserContent` 新增“文字写法”场景并记录 `action`、`preview-image`；对话视图的“附件与投递状态”场景多了一轮按文字写法发出的消息。

## 验证

- 第 2 步：`bun run typecheck` 0 错误；`scripts:typecheck` 通过；`bun run test -- app/components/agent app/components/common/form app/component-lab` 342 条中失败的 9 条同上，新增 `composer-actions.test.ts` 11 条与 `PromptEditor.test.ts` 的 `insertFiles` 1 条。smoke `agent-conversation`（新增 `agent-composer.ts`：空闲回车发送并由宿主清空、`/` 命令菜单与参数提示、`command.run`、Shift+Tab、运行中停止与 steer/followup 及排队消息、拒收图片的提示、上传中与失败时不能发送、重试、发送的文字带图片标签、展开后回车换行与 Ctrl+回车发送、模型下拉、只读）与 `prompt-editor` 通过；把 steer 与 followup 对调、去掉“上传中不能发送”两处变异都被抓到。`lab:shot`：`AgentConversationComposer`、`AgentModelPicker`、`AgentQueuedMessages`、`AgentConversationView` 全部场景在手机与 1400×900、昼夜配色下无溢出、无页面问题；`AgentModelPicker`、`AgentQueuedMessages` 的宽高由内容决定，“没撑满舞台”的提示是预期的。

- 原图预览重做：`bun run typecheck:quick` 0 错误；`scripts:typecheck` 通过；`bun run test -- app/components/agent app/components/common/form app/component-lab app/components/novel-ide/project-image-experience` 333 条中失败的 9 条同上，`project-image-experience` 契约测试（只在打开时挂载图片、下载链接）通过；smoke `agent-conversation`（`sentPromptText` 新增：卡片留在画布里、图片不被裁掉）、`prompt-editor` 通过；让图片不缩小的变异被抓到。浏览器实测：1200×800 的图在随窗口画布里缩到 754×502、在手机画布里缩到 340×226，卡片贴着图片；150×150 的小图按原尺寸居中、卡片 274px 宽、标题完整；鼠标点开时没有焦点框，键盘打开时焦点框在“下载”上，关闭后焦点回到图片标签。

- 第 1 步：`bun run typecheck` 0 错误；`bun run test -- app/components/agent app/components/common/form app/component-lab` 329 条中失败的 9 条同上（`WorkbenchShellLayoutFixture`），新增 `PromptTextView.test.ts` 7 条、`AgentUserContent.test.ts` 3 条；smoke `agent-conversation`（新增 `sentPromptText`：附件条与粘贴块、点击引用发出 action、没有地址的图片不打开、点击图片打开预览、Escape 关闭）、`prompt-editor`、`core` 通过；让预览不打开的变异被 `sentPromptText` 抓到。`lab:shot`：`PromptTextView`、`PromptPasteFrame`、`PromptTokenChip`、`AgentUserContent` 在手机与 1400×900、昼夜配色下无溢出、无页面问题；它们高度由内容决定（与正文段落一样），“没撑满舞台”的提示是预期的，宽度都跟着画布走（标签除外，它的宽度由文字决定）。浏览器实测：编辑器里过长名称的标签与它外面的包装同为 256px；粘贴块编辑框与预览的字体、字号、内边距一致。
- 第 0 步：`bun run typecheck` 0 错误；`bun run test -- app/components/agent app/component-lab` 中失败的 9 条都在未改动的 `WorkbenchShellLayoutFixture.test.ts`（`localStorage.clear` 不存在），与 t08 记录相同；`docs:check` 失败 0；smoke（3013 端口，`bun run lab`）`core`、`agent-conversation` 通过。`agent-conversation` 首跑失败一次，是新起的开发服务在运行时发现新依赖（`typebox`）后刷新了页面，随后连续三次通过。

## 进展记录

- 2026-10-01 第 0 步：移动 46 个文件（`git mv`，暂存区里是改名），改写目录内外 30 个文件的引用，并修正 6 份组件文档里类型声明的相对路径。依赖方向核对过：`parts/` 不引用其它子目录，`tools/` 不引用 `stream/`，`stream/` 有 3 处用到 `tools/`（原始视图与过程条目打开工具详情）。
- 2026-10-01 第 1 步：抽零件后 smoke 的 `line-edges` 失败一次（从行尾标签右边往回拖选不出选区）。节点视图多包了一层普通行内 span，Chrome 把落点放进了这层不可编辑元素里；TipTap 要求根元素是 `NodeViewWrapper`，所以保留这层，把它设为与标签同宽的 `inline-flex`，并写了注释。
- 2026-10-01 开发者确认第 1 步，只觉得原图预览不好看。原来的预览是固定约 1080×780 的大框：小图被放在一大块灰底里，标题是没有信息的“查看原图”，文件名在底部小字，整条页脚只有一颗下载按钮，在手机画布里还会超出。重做 `common/OriginalImagePreviewDialog`（旧侧栏、项目选择页也用它，props 与事件不变，外观一起变）：卡片贴着图片，头部是文件名加“下载”“关闭”两个图标按钮；图片按原始尺寸、放不下时等比缩小，尺寸按浮层宿主（产品里是窗口，Lab 里是画布）的可用空间计算，因为卡片高度随内容时图片的百分比高度没有参照；很小的图片在至少 240px 宽的区域里居中。预览标题在目标是 `local://名称` 时带上文件名。另外发现鼠标点开时“下载”上有一圈焦点框：已发送消息里的标签是普通 `span`，点了不获得焦点，Dialog 再把焦点放进来时 Chrome 就画框；给 `PromptTokenChip` 加了 `interactive`，静态显示里的标签成为可聚焦的按钮（回车、空格触发），顺带补上了键盘操作。smoke 断言里的有名箭头函数被 tsx 包上 `__name`，在页面里跑不了，改为页面只取矩形、在 Node 里比较。
- 2026-10-01 第 2 步：新增 `agent/composer/` 的 `AgentConversationComposer`、`AgentModelPicker`、`AgentQueuedMessages` 与 `composer-actions.ts`，根目录的 `prompt-token-action.ts`（`AgentUserContent` 改用它）与 `builtin-composer.ts`；`PromptEditor` 外露补 `insertFiles`；视图类型、Spec 按设计同步，`composer.submit` 去掉 `images`。Lab：新增输入框夹具（7 个场景，另登记一个插件工具栏按钮演示扩展点）与两个零件的场景，宿主逻辑抽成 `agent-composer-lab-host.ts` 由对话视图与输入框夹具共用，菜单数据从 PromptEditor 夹具抽到 `prompt-lab-menu.ts`；对话视图夹具加了“开始运行”“下次上传失败”，运行模拟会把排队消息交出去。
- 第 2 步途中改的三处：附件就绪时编辑器把标签写回文字也会发出 `change`，拒收提示若跟着 `change` 消失，用户来不及看到，改为关闭、发送或换草稿时消失；没上传完的附件不在文字里，这时发送会丢附件，补了“上传中、失败时不能发送”并写进组件文档；输入框在 Lab 默认按紧凑模式摆放，画布高度跟着内容走，展开的 55% 算成了内容高度的 55%，把它加进 Lab 的撑满名单。
