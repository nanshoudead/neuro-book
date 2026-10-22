# t06 实施计划：把设置界面收回 w00017 t80 的定稿

## Context

开发者 2026-10-20 认为设置界面不好看，之前出过设计稿但没照着做。2026-10-21 对照后确认：外观以 w00017 t80 的定稿为准（[t80 评审板](../../../w00017-application-runtime-architecture/tasks/t80-settings-ui/artifacts/review/index.html) 第四轮“混合”排法），t06 把实现收回定稿，t80 之后新增的界面沿用定稿的语言，不另起画法（README“设计决定”第 2 条）。逐项对照在本 Task 评审板 v5 的“还原 t80 定稿”一节。

开发者已定：

- 三项以内、没有说明的单选改回分段控件，并改 nb-ui 的“同类零件的分工”与 `ui.forms` 的控件选择规则，nb-form 照新规则选控件（README“设计决定”第 3 条）。带说明或超过三项的仍用单选组、下拉。
- 注意力排序（第 1 条）。

合同：[`ui/forms.md`](../../../../../docs/specs/ui/forms.md)、[`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md)；nb-ui 规范 [`ui-development-spec.md`](../../../../../packages/nb-ui/docs/ui-development-spec.md) 4.5。

工作方式：主会话在 Work 分支 `feat/w00027-plugin-platform`（worktree `.worktree/w00027-plugin-platform`）上实现，逐片提交；Spec 与规范在主工作区 master 上改。完成后截图经 nbdev 发布给开发者看一次；界面实现审查派 Sonnet，nb-ui 与 nb-form 的合同改动派 omp。

## 技术选型

无新的通用问题：分段控件用 nb-ui 现有的 `SegmentedControl`，页内列表用 `src/ui/settings/SettingsPageList.vue`。

## 关键设计

### `packages/nb-ui/src/components/controls/SegmentedControl.vue`

补表单控件的统一合同（`ui.forms` 输出 26–28，照 `RadioGroup` 在 t07 S2a、S2b 的做法）：

- 新属性 `disabled`（整组停用）、`readonly`（可聚焦、写 `aria-readonly`、方向键移动焦点但不改值、不画成可点）、`invalid`（与字段上下文取或，写 `aria-invalid`，外框描红）。
- 读 `useFieldContext()`：根写 `id`、`aria-labelledby`、`aria-describedby`；没有字段上下文时照旧用 `ariaLabel`。
- 根已是 `role="radiogroup"`（t07 S2a），不变。现有调用方只按属性用，新属性都有缺省值，不受影响。
- 测试补在 nb-ui 现有的 `readonly-matrix.test.ts` 与 SegmentedControl 的测试里；Lab 场景加只读、停用、出错。

### `packages/nb-form/src/`

- `model.ts`：内建控件加 `segmented`；`defaultWidget` 的单选：没有 `options`（动态选项）、不超过 `RADIO_ROW_LIMIT` 项、且每项都没有说明时选 `segmented`，否则沿用 `radio-row` 与下拉的现规则。`selectWidget` 要知道“有没有说明”：调用方（`resolveForm` 里算 `choiceCount` 的地方）一并传入。
- `vue/controls/ChoiceControl.vue`：`segmented` 画 `SegmentedControl`（选项值仍用 `optionKey` 编码），把 `readonly`、`disabled`、`invalid` 传下去。
- `vue/NodeField.vue` 的 `CHOICE_WIDGETS`、`GROUP_WIDGETS` 加 `segmented`（组形态，名字经 `aria-labelledby` 来自字段标签）；`vue/layout.ts` 宽度按内容；`fallback.ts` 退回 `pick-one`。
- 写了 `widget: "segmented"` 的显式提示按 `widgetHonored` 照常校验（只配单选）。

### `packages/neuro-book/src/plugins/settings/web/components/SettingsWindow.vue`

- 左栏条目：选中项浅灰底、正文色，没有描边；未选中透明，悬停浅底（t80 第四轮稿）。不再用 `Button variant="secondary"`，改成窗口自己的条目样式（键盘焦点环由 nb-ui 的焦点环类给，只在键盘操作时出现）。
- 左边缘：“用户 | 本作品”、搜索框、分区条目与窗口标题左边对齐；层标签两段等宽、与左栏同宽（`fullWidth`）。
- 搜索框与条目同宽、同左边缘。
- fill 与 column 两个分支各写一份的分区标题、说明与层的提示抽成一个窗口内部组件 `SettingsSectionHeading.vue`（t02 审查第 17 条），外观不变。

### `packages/neuro-book/src/plugins/lab/web/fixtures/settings-scene/SampleModelsPage.vue`

收回 t80 定的 fill 页面写法：左边 `SettingsPageList`，右边详情，两栏各自滚动（t02 审查第 6 条随之消失，不再依赖 nb-form 的左列表右详情撑满父容器）。

- 列表第一项“常规”放“默认模型”“推理强度”（即时写入，同现在），其后每个服务商一项，列表底下“添加服务商”；服务商的说明行是接口地址。
- 选中服务商时右边是它的字段（`SchemaField` 画单个服务商对象），上方一行标题（服务商名）与“删除”；草稿、按值比较、`context.dirty`、别处改过时的“重新读取 / 仍然保存”、只读判断照 t02 S7 的现有逻辑不变。
- “保存”“放弃改动”放在详情标题那一行的右端，一直在，没有改动时停用（t02 审查已定按钮常驻）。
- 待确认清单里“模型服务用 nb-form 左列表右详情”一条写明改回。

### `packages/neuro-book/src/plugins/settings/web/components/SettingsFileView.vue` 与 t02 新增的提示

沿用定稿的字号与间距：文件视图的操作行与分区标题同一套样式；动态选项“已不存在”只在控件里写一次（`nb-form` 的选项状态行与下拉里重复时去掉下面一行）。逐个看图时发现的其它不一致在这一片里改，记进 README。

### 单行输入的宽度（t07 S5 审查第 8 条）

`SettingsListSection` 的单行输入从定宽 320px 改为 200–320px 随内容列收窄，放不下 200px 才整行换到标题下面；“恢复默认”跟在控件后面不单独换行。

## Spec 与文档改动

- `packages/nb-ui/docs/ui-development-spec.md` 4.5：`SegmentedControl` 除了换看法，也用于表单里三项以内、没有说明的单选；`RadioGroup` 用于带说明或要竖排的单选。
- `docs/specs/ui/forms.md`：输出 2 的单选规则改为“3 项以内且都没有说明用分段控件，带说明用横排单选组”，去掉“分段控件不用于表单”；输出 26、27 的控件清单加 `SegmentedControl`；输出 29 改写；“边界与兼容”里对 4.5 的引用改写。
- `docs/specs/settings/settings-window.md`：输出 9 的“字面量联合不超过 3 项用横排单选组”改为按 `ui.forms` 输出 2；排法里“横排单选组”加上分段控件；输出 1 的左栏选中样式不写进 Spec（外观）。
- nb-ui `SegmentedControl.md`、nb-form 的组件文档、`SettingsWindow.md`、`SampleModelsPage` 所在场景的说明同步。

## 切片

1. **S1 分段控件的表单合同**：nb-ui `SegmentedControl` 与测试、Lab 场景；4.5 与 `forms.md` 输出 26、27。验证：nb-ui 测试、`bun run --cwd packages/nb-ui typecheck`。
2. **S2 nb-form 选分段控件**：`model.ts`、`ChoiceControl`、`NodeField`、`layout`、`fallback` 与测试；`forms.md` 输出 2、29，`settings-window.md` 输出 9；设置窗口的组件测试与 e2e 里按控件种类的断言随之改。验证：nb-form 测试、应用 `test:affected`、`settings.e2e.ts`。
3. **S3 设置窗口的框架**：左栏条目、左边缘、层标签、搜索框、`SettingsSectionHeading`、单行输入宽度。验证：设置窗口组件测试、`lab:shot` 设置窗口全部场景（nbook 与 macos、浅与深、手机与 1200×800）。
4. **S4 模型服务样板**：`SampleModelsPage` 改回 `SettingsPageList`；e2e 里模型服务的步骤随之改。验证：样板页组件测试、`settings.e2e.ts`、`lab-scenes`。
5. **S5 t02 新增界面对齐定稿**：设置文件视图、动态选项提示与看图时发现的不一致。验证同 S3。
6. **收口**：全量 e2e；截图经 nbdev 发布给开发者看；Sonnet 界面审查、omp 审 S1–S2 的合同改动。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| `ui.forms` 输出 2（单选 3 项以内无说明用分段） | nb-form `model.test.ts` 的控件选择表；`SchemaField.dom.test.ts` |
| `ui.forms` 输出 26–28（分段控件的停用、只读、出错、名字） | nb-ui `readonly-matrix.test.ts`、SegmentedControl 测试；forms 验收 6 的 e2e |
| `settings.window` 输出 9（每项控件按 `ui.forms`） | `SettingsWindow.dom.test.ts`、`settings.e2e.ts` |
| `settings.window` 输出 19（fill 页面的二级列表） | `SettingsPageList.dom.test.ts`；样板页的组件测试与 e2e |
| 定稿外观 | `lab:shot` 截图对照 t80 第四轮稿，开发者看图确认 |

## 验证

- 每片跑受影响的测试与类型检查；S3–S5 用 `nbdev shot` 截设置窗口全部场景，逐张对照 t80 定稿看。
- 收口跑全量 e2e，开发服务用 `nbdev dev start`。
- 未验证边界：macOS 主题下的细节以 nbook 主题为主对照，macOS 只查溢出与焦点被裁。

## 不做与风险

- 不做：只读的统一外观（t07 S3 审查第 7 条）与“其它”小组标题改用插件的显示名，这两处 t80 没有定过，要出稿给开发者定，S5 之后单独一轮。
- 风险：nb-form 的选择规则变了，别处用 nb-form 画的三项以内单选（Lab 的 nb-form 场景）也会变成分段控件；动态选项不受影响（缺省下拉）。
