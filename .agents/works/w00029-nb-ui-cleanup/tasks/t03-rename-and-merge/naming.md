# 新旧名字与合并方案（草案，待开发者定）

2026-10-20，依据 master `e09a9d9f8`（t02 之后剩 49 个组件）。命名规则见 t01 决定 3。

## 改名

| 现在 | 改成 | 理由 |
|---|---|---|
| `FormInput` | `Input` | 去掉 `Form` 前缀 |
| `FormTextarea` | `Textarea` | 同上 |
| `FormSelect` | `Select` | 同上；也与“下拉菜单”分开 |
| `FormCheckbox` | `Checkbox` | 同上 |
| `FormNumberInput` | `NumberInput` | 同上 |
| `FormField` | `Field` | 它是“标签、说明加一个控件”的整行容器，按规则叫 `…Field`；不是输入控件 |
| `Dropdown` | `DropdownMenu` | “点按钮弹出一列动作”，和“从几项里选一个值”的 `Select` 分开；与 `ContextMenu`、`Menubar` 一族 |
| `QuickInput` | `QuickPick` | 它是“输入筛选、从候选里挑一项”的浮层（命令面板、快速打开、跳到行都用它）；`QuickInput` 是照搬 VS Code 的内部名，看不出是干什么的 |
| `GridRenderer` | `NestedGrid` | 与它的 Spec 同名（[`ui/nested-grid.md`](../../../../../docs/specs/ui/nested-grid.md)）；“Renderer”说的是实现方式 |
| `NotificationViewport` | `NotificationStack` | 屏幕一角排队显示的通知；“Viewport”说不清是什么 |

## 合并与消歧

| 组 | 方案 |
|---|---|
| `SegmentedControl` 与 `ToggleGroup` | `SegmentedControl` 管“几个模式里选一个”；`ToggleGroup` 只留多选（格式开关），去掉单选。唯一用单选的 `JsonViewer` 改用 `SegmentedControl`（它现在还要绕开“再点一次会取消选中”） |
| `Tabs`、`SegmentedControl`、`RadioGroup` | 不合并，各写清用途：`Tabs` 换去处（下面的内容跟着换），`SegmentedControl` 换模式（同一处内容换个看法），`RadioGroup` 表单里选一个值 |
| `Banner` | 保留，dev-panel 的 `App.vue` 与编辑器组的 `EditorGroup.vue` 改用它，删掉两处手写的横幅 |
| `ScrollArea` 与 `OverlayScrollbar` | 留给 t04 与弹出列表的滑块一起定成一套；本批不动 |
| `DropIndicator`、`DropIndicatorLabel`、`DropFeedbackOverlay` | 产品里只有 `DropFeedbackOverlay` 被直接用（三处）与 `DropIndicatorLabel`（一处）；`DropIndicator` 不再导出，作为覆盖层的内部件 |
| `Breadcrumb` | 保留（dev-panel 在用）；编辑器的面包屑是 neuro-book 自己的 `EditorBreadcrumbs`，功能不同（每段可下拉），不合并 |

## 挪出 nb-ui

| 组件 | 去处 |
|---|---|
| `FileBrowser` | neuro-book（唯一使用方是目录选择器 `PathPickerDialog`），放到使用它的插件下 |

## 不动

`Button` `IconButton` `Menubar` `Switch` `Tabs` `Toolbar` `Badge` `EmptyState` `Kbd` `Progress` `Skeleton` `Spinner` `Table` `AlertDialog` `ContextMenu` `Dialog` `Drawer` `InfoTip` `Notification` `Popover` `Tooltip` `CheckboxGroup` `ColorSwatches` `RadioGroup` `Slider` `Collapsible` `Separator` `Splitter` `Tree`

## 影响面

- 改名要改 neuro-book、dev-panel、nb-story 里的导入与模板，Lab 夹具与组件文档（同名 `.md`）跟着改名；旧名字不留别名（旧应用不管，t01 决定 2）。
- `nb-ui` 的 Nuxt 模块（`./nuxt` 子路径，按目录自动注册组件）只有旧应用与 playground 在用，改名后组件名跟着变。
