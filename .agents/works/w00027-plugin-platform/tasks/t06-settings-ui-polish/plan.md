# t06 实施计划：按第四到第七轮定稿重做设置窗口的外观

> 取代 2026-10-21 的“收回 t80 定稿”计划（已实施的 S1–S5 在 Work 分支 `e59a4112c..c92f53320`，旧计划见本文件的 Git 历史）。S1–S5 里分段控件的表单合同、nb-form 选分段控件的规则保留；外观照本计划重做。

## Context

开发者 2026-10-22 推翻 t80 以来的画法重新设计，经评审板第四到第七轮定稿（README“设计决定”第 5–13 条；评审板 [artifacts/review](artifacts/review/index.html) 的 r4–r7）。草稿是实现的视觉依据，在草稿 worktree `.worktree/w00027-t06-drafts` 的 `packages/neuro-book/src/plugins/drafts/web/components/settings-redesign/`：

| 草稿 | 看什么 |
|---|---|
| `SettingsRedesignDraft.vue`（`direction: "flat"`） | 第四轮定的整体画法：左栏列表行、标题衬线字、分组标题下一条线、行与行只靠间距、模型服务的列表加下一级页面 |
| `SettingsFlatDraft.vue` | 第五轮的各状态：本作品标签、搜索结果、插件设置、设置文件、离开时的确认、窄窗口；深色 |
| `SettingsR6Draft.vue` | 第六轮：文案、只读的锁、14px 圆角的 `AlertDialog`、页面级操作在标题右侧 |
| `SettingsR7Draft.vue` | 第七轮定稿：出错与“选项拿不到”的原因收进名字旁图标、说明与标题并列、层出错警告按钮、点进设置文件后光标在出错处、整数行高 |

开发者已定（会话与评审板）：

- 出错收进名字旁图标、悬停或聚焦显示，用在所有表单（第 12 条）：改 `ui.forms` 本身。
- 四处合同（第 13 条）：左栏三组用已有的 `category`，只是显示组标题；页面级操作经 `SettingsPageActions` 放进标题区；插件显示名拆到 t09，t06 小组标题仍是插件 id；`SettingsPageList` 改为列表加下一级页面。
- 小确认框 14px 圆角与“叠放浮层的圆角不大于底下窗口”对全库生效。
- 文案按评审板第六轮的对照表改。

合同：[`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md)（标“planned”的条目）、[`ui/forms.md`](../../../../../docs/specs/ui/forms.md) 输出 14 与 `bare` 一段；nb-ui 规范 [`ui-development-spec.md`](../../../../../packages/nb-ui/docs/ui-development-spec.md) 与 [`design-language.md`](../../../../../packages/nb-ui/docs/design-language.md)。

工作方式（开发者 2026-10-22 指定 autonomous-delivery，允许派 Sonnet 子代理实施）：每片派一个 `coder` 子代理（`model: sonnet`），在 Work 分支上开自己的 worktree 与分支；主会话审 diff、自己跑验证后合进 Work 分支，再派下一片。B 依赖 A 给 `Tooltip` 加的受控打开，A 合入后再派 B；C1–C4 都碰设置插件，按顺序派。计划审查（omp，11 条，见 [evidences/plan-review-omp.txt](evidences/plan-review-omp.txt)）的处理已写进下面各节。界面实现审查在全部切片合入后派一个 Sonnet `reviewer`；nb-form 合同的改动由 omp 审查。

## 技术选型

无新的通用问题：提示用 nb-ui 的 `Tooltip`，确认框用 nb-ui 的 `AlertDialog`，标题区插槽用 Vue 的 `Teleport`。不加依赖。

## 关键设计

### A `packages/nb-ui/`

- 小确认框：`AlertDialog` 的外框改用新的主题层 token `--radius-dialog-compact`：在 `src/theme/tokens.ts` 登记（`tokens.test.ts` 的登记、裸 `:root` 基线与层级不重叠检查都要过，`theme-loader` 据此把它列为保留变量），`tokens.css` 缺省 `var(--radius-dialog)`，nbook 的 `vars.css` 写 14px；macOS 等主题不写，沿用缺省；`docs/authoring-themes.md` 的可覆写变量里加上它。`Dialog` 不变。
- `Tooltip` 加受控打开：可选属性 `forceOpen`（布尔），为真时提示显示，悬停与焦点的开合照旧叠加在上面（真时悬停离开不关）；在提示开着时按 `Esc` 关掉，直到 `forceOpen` 先变假再变真才再次强制显示。`Tooltip.md` 的“不支持”一节改掉这条；nb-ui 测试补“forceOpen 显示、Esc 关闭后要再置真才显示、悬停照旧”。
- 规范：`docs/ui-development-spec.md` 浮层分级里加“叠在另一个窗口上的浮层，圆角不大于底下窗口的圆角；小确认框用 `--radius-dialog-compact`”；`docs/design-language.md` 几何一节加“行内的文字块与控件同奇偶，用整数行高，免得控件落在半像素上（边框被抗锯齿糊开）”。
- `AlertDialog.md` 写新的圆角；Lab 场景照旧。

### B `packages/nb-form/src/vue/`

- `FieldShell.vue`：标题后面一个状态图标，包在 nb-ui `Tooltip` 里；去掉警告图标上的原生 `title`。出错、警告、状态可以同时有：只画一个图标，色调取最重的（出错危险色 `i-lucide-circle-alert` > 警告 `i-lucide-triangle-alert` > 状态淡色），提示按出错、警告、状态的顺序逐行列出全部原因。焦点在控件上时也显示提示：外壳监听 `focusin`、`focusout`，用 A 的 `forceOpen`。图标不改变行高。
- `bare`：不再在控件下面画状态与警告文字；`SchemaField` 发出 `field-state`（`{error, warnings, status}`，变化时发出，`ui.forms` 第 83 行一段）。
- 读屏不变：`aria-describedby` 照旧指向出错、警告与状态各自的读屏文字（稳定 id，合并进已有的说明 id，不覆盖）。`SchemaForm` 的问题汇总、`focusIssue` 的语义不变。
- 测试：nb-form 现有的 DOM 测试里补“出错时标题后有图标、聚焦控件时提示可见”“出错、警告、状态同时有时一个图标、色调取出错、提示三行”“`bare` 发出 `field-state`、不画文字”“问题汇总与 `focusIssue` 照旧”。

### C1 `packages/neuro-book/src/ui/settings/` 与 `plugins/settings/web/components/SettingsListSection.vue`

照 `SettingsR7Draft` 的 `.sfd__row` 一套：

- `SettingsRow.vue`：行用换行的弹性布局，放不下控件时控件换到标题下面（输出 16 的窄窗口）；标题加控件的排法改为控件靠右，最右一格固定 26px 放“恢复默认”或锁（没改过也留）；已修改是标题后的小圆点（`Tooltip`“已修改”）；`applies` 标注是小标签；只读（`readOnly`）只写值加锁；状态原因（出错、选项拿不到、“已不存在”）是标题后的图标加 `Tooltip`，原因由调用方经新属性 `reasons?: ReadonlyArray<{tone: "error" | "warning" | "muted"; text: string}>` 传入，画法同 B（一个图标、色调取最重的、提示逐行列出），读屏文字有稳定 id 并合进插槽给控件的 `describedby`；本作品标签的“单独设置”“移除本作品的设置”（图标按钮）照输出 12。整数行高：标题 20px，说明 18px，名字与说明的间距让文字块为偶数高（草稿是 20 + 2 + 18）。宽排法的“恢复默认”与那一格对齐。
- `SettingsListSection.vue`：“未保存”的原因照旧由 `describeIssues` 算（只取出错），警告与状态取自 `field-state`，合成 `reasons` 交给行；删掉控件下面那一行字；文案照对照表。
- `row-state.ts`、`setting-text.ts` 的文案照对照表。
- 测试：`SettingsRow.dom.test.ts` 按新外观改断言（圆点、那一格、原因图标、多原因），行为断言不放宽；Lab `SettingsRow` 加一个 560px 宽的场景，`lab:shot` 断言没有溢出、控件换到标题下面。

### C2 `packages/neuro-book/src/plugins/settings/web/components/` 外框

- `SettingsWindow.vue`：
  - 左栏：212px；三组上方组标题“通用”“写作助手”“扩展”（`category` 映射，文案两种语言）；分区是列表行（没有描边、悬停与当前项一层 `--overlay-item-active` 一类的淡底、按下不缩放）；“其它”显示为“插件设置”。
  - 标题区（取代 `SettingsSectionHeading` 的现有画法）：标题用 `--font-display`、26px、行高 32px；说明跟在标题后同一行，放不下截断、`Tooltip` 显示全文；右侧从右往左是页面级操作的 Teleport 目标与层警告。关闭按钮不与右侧重叠（标题区右边让出位置）。
  - 出错位置的数据链（审查第 1 条）：`shared/layers.ts` 的无效 `LayerContent` 加可选 `reason` 与 `position`；`backend/layer-owner.ts` 的 `fromText()` 把 `parseLayerText` 已经算出的 `reason`、`position` 带上（另一处调用同理）；窗口模型的层通知（`settings-window.ts` 的 `SettingsLayerNotice`）带上它们。configuration Spec 输出 5 已加这条（planned）。`configuration` 的层快照测试补“无效时带位置”。
  - 层警告：`invalid` 时是“设置文件格式有误”加“打开”的按钮，`Tooltip` 写位置、原因、“修复前，这一层的设置无法保存”与路径；点了经窗口模型新入口“打开设置文件并定位”（参数是层与可选的 `{line, column}`）切到 `file` 分区。这个动作和别的离开动作一样先过输出 22 的未保存确认；确认后切过去，位置挂在窗口模型上，设置文件视图读完文件后用一次并清掉；取消不清、不切。没有位置时只打开。`unavailable` 是不可点的警告文字。
  - 页面能不能写（审查第 4 条）：`SettingsPageContext` 加 `writable`（当前标签那一层不是 `invalid`、`unavailable`）；`SettingsPageActions` 的内容包在一个 `<fieldset :disabled="!writable">` 里（nb-ui 的按钮是原生按钮，随之停用），层恢复时自动恢复。Spec 输出 13 与上下文接口已加（planned）。
  - 搜索结果：组标题“分区名 › 小组名”；标题与说明里命中的字用 `<mark>` 标底色；页面命中放最后的“页面”组，每条一行、右端“打开 ›”。
  - 离开时的确认：`AlertDialog` 的标题与正文照对照表（正文带分区标题）。
  - 窄窗口：左栏顶上两行、分区横排可横向滚动、不显示组标题与图标。
- 新 `src/ui/settings/page-chrome.ts`：窗口经 `provide` 交给页面的标题区通道：操作的 Teleport 目标、层能不能写、`SettingsPageList` 打开一项时的标题替换。标题替换的所有权（审查第 8 条）：`claim({title, back})` 返回一个撤销函数，只撤自己那次登记（按登记次序认，后来的登记先撤时旧的撤销不起作用）；`SettingsPageList` 在打开项时登记、返回或卸载时撤销。页面卸载的各条路（离开分区、开始搜索、关窗口、重新加载、重试、撤回）都会卸载组件，撤销随卸载发生；切标签页面不重建，替换保留。只给 `src/ui/settings/` 里的组件用，不是公开接口。
- 新 `src/ui/settings/SettingsPageActions.vue`（同名 `.md`）：默认插槽 Teleport 到通道给的目标；没有通道时（例如在 Lab 单独渲染）就地渲染。
- 测试：`SettingsWindow.dom.test.ts` 补“层警告点了切到设置文件并定位、有未保存改动时先确认、取消不切”“没有位置时只打开”“页面级操作出现在标题区、层坏了时停用、恢复后可用、页面卸载后消失”“详情态下离开分区、开始搜索、关窗口、重试后标题恢复，切标签保留”“搜索结果的组标题与页面组”“命中高亮：标题与说明各自单词、多词、大小写，特殊字符转义，文本总值不变、`<mark>` 只包命中片段，list 行与页面命中都覆盖”（审查第 11 条）；`window.test.ts` 的行为断言不动，文案断言照对照表。
- Lab：`SettingsPageActions` 加场景（没有通道时原位渲染、多个操作、停用）；`fixtures/index.ts` 登记。

### C3 `plugins/settings/web/components/SettingsFileView.vue` 与保存栏

- 新 `src/ui/settings/SettingsSaveBar.vue`（同名 `.md`）：属性 `dirty`、`busy`、`message?`，发出 `save`、`discard`；没有改动时按钮停用、不写字；放在内容列底部，上面一条两端不碰边的线（`SettingsFlatDraft` 的 `.sfd__bar`）。
- 设置文件视图：操作行移到底部的保存栏；文本框左边加行号（行号列与文本框同一个滚动容器，或者跟随文本框的 `scroll` 同步，二选一以实现简单为准；不自动换行，所以行号一行对一行）；`invalid-text` 与从层警告进来时，出错行标出错底色、光标放在出错处，标题区右侧写对应文字（经 C2 的通道）；键提示的文案照对照表。
- 测试：`SettingsFileView` 的现有测试补“从层警告进来时光标在出错处、只定位一次”；`window.test.ts` 的设置文件用例文案照改。
- Lab：`SettingsSaveBar` 加场景（没有改动、有改动、保存中、自定义文字）；`fixtures/index.ts` 登记。

### C4 `src/ui/settings/SettingsPageList.vue` 与 Lab 样板

- `SettingsPageList.vue` 改为列表加下一级页面（Spec 输出 19）：`items` 每项 `id`、`title`、可选 `description`、`icon`、`status`、`tone`、`modified`；`modelValue` 为 `null` 时画列表（`SettingsRedesignDraft` 的 `srd__row--link` 一套），否则画默认插槽，并经通道登记标题替换（“‹ 页面标题”与这一项的标题）；`update:modelValue` 发 `string | null`（点一项发 id，返回发 `null`，审查第 5 条），值由调用方改；返回时焦点回到这一项。同名 `.md` 照改。
- `plugins/lab/web/fixtures/settings-scene/SampleModelsPage.vue`：选中项初值改为 `null`，首屏是列表；服务商改用新的 `SettingsPageList`；“添加服务商”经 `SettingsPageActions` 放标题区；详情页的“测试连接”与删除放标题区；保存与放弃改用 `SettingsSaveBar`；未保存保护（`context.dirty`）的行为不变。
- 测试：`SettingsPageList.dom.test.ts` 重写为受控的列表 → 详情 → 列表、首屏是列表、返回后焦点；`settings.e2e.ts` 里 Lab“模型服务”的用例按新结构改选择器，判据不变。
- Lab：`fixtures/index.ts` 里独立登记的 `SettingsPageList` 场景（审查第 6 条）按新合同重做“列表”“打开一项”两个场景（要插槽时用 fixture 包装组件）。

## Spec 与文档改动

- `docs/specs/settings/settings-window.md`：已在本计划之前写好（标“planned”的条目），实现验证后去掉标记、更新“实现合同”与“证据”。
- `docs/specs/ui/forms.md`：输出 14、`bare` 一段，同上。
- nb-ui 规范与组件 `.md`：A 片里改。
- `src/ui/settings/` 新组件的同名 `.md`：C2、C3 片里写。

## 切片

| 片 | 内容 | 依赖 | 自跑验证 |
|---|---|---|---|
| 0 | 主会话把 master 合进 Work 分支 | — | `test:affected --since <合并前> --typecheck --with-consumers` |
| A | nb-ui 圆角 token（登记）、`AlertDialog`、`Tooltip` 的 `forceOpen`、规范 | 0 | nb-ui 测试（含 `tokens.test.ts`）与类型检查、Lab `AlertDialog` 在 nbook 与 macOS 下截图 |
| B | nb-form 图标与提示、`field-state` | A | nb-form 测试与类型检查 |
| C1 | 设置的行 | A、B | 应用 Vitest 的 settings 部分、类型检查、Lab `SettingsRow` 截图 |
| C2 | 层快照的出错位置、窗口外框、标题区通道、`SettingsPageActions`、`writable`、层警告、搜索、窄窗口、确认框文案 | C1 | 同上加 settings 的 Bun 测试与 `settings.e2e.ts` |
| C3 | 保存栏、设置文件视图 | C2 | 同上 |
| C4 | `SettingsPageList`、Lab 样板 | C3 | 同上加 `lab-scenes.e2e.ts` |
| 收口 | 主会话：全量 e2e、Lab 全部设置场景在浅深与 1200×800、600×500 下截图对照草稿、Spec 去 planned | C4 | `test:affected --since 41f3db21f --typecheck --with-consumers`、全量 e2e、`docs:check`、`governance:check` |

每片一个或几个提交，合进 Work 分支后 push。

## 验收映射

- `settings.window` 输出 1、3、9–14、16、18–23（planned 部分）→ `SettingsWindow.dom.test.ts`、`SettingsRow.dom.test.ts`、`SettingsPageList.dom.test.ts`、`window.test.ts`；验收 4（改坏、点警告、修好）→ `settings.e2e.ts`。
- `ui.forms` 输出 14、`bare` 的 `field-state` → nb-form 的 DOM 测试。
- 外观（圆点、那一格、整数行高、标题区、确认框圆角）→ Lab 截图对照草稿，`lab:shot` 的溢出与焦点环检查为 0。

## 验证

- 每片：子代理自跑上表的命令；主会话在合并前重跑、看 diff。
- 收口：全量 e2e；Lab `SettingsWindow`、`SettingsRow`、`SettingsPageList`、`SettingsPageActions`、`SettingsSaveBar`、`AlertDialog` 场景在 nbook 浅深、macOS 浅色、1200×800、600×500 与 560×600（窗口窄于 600px）下截图，与草稿逐张对照，结果经 nbdev 发布给开发者看。
- 未验证边界：插件显示名（t09）；第三方插件页面里自定义的控件不受 `SettingsRow` 管。

## 不做与风险

- 不做：插件显示名（t09）；页面内列表的排序（`SettingsPageList` 不支持，Lab 样板去掉上移下移已是现状）。
- 风险：子代理照草稿抄样式时把草稿里的硬编码（如 26px、`#fff`）带进产品代码 → 说明里写明草稿只看外观，样式要用 token，`token-consumption.test.ts` 的字面字号规则会拦一部分；C2 的标题区通道与 C4 的标题替换是新的跨组件约定，审查时重点看页面卸载后的清理。
