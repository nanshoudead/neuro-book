# nb-ui 组件盘点

2026-10-20 调研，依据 master `22f8e7ed2`。用量由脚本统计：在各包源码里找“从 `@notnotype/nb-ui` 导入了这个名字”的文件数，Lab 夹具与测试另算、不计入；“nb-ui 内部”是被 nb-ui 别的组件用到的文件数。旧应用一列只作参考（旧应用只读，见下文“待定”）。

## 数字

- `src/components/index.ts` 导出 82 个组件。
- 产品里有人用（neuro-book、dev-panel、nb-story 或 nb-ui 内部任一处）：48 个。其中 `Calendar`、`RangeCalendar` 只被 `DatePicker`、`DateRangePicker` 用，`Progress` 只被 `Notification` 用，`DropIndicator` 只被 `DropFeedbackOverlay` 用。
- **只有 Lab 夹具在用**：33 个——`Editable` `Pagination` `Stepper` `SwitchField` `Toolbar` `Rating` `HoverCard` `Banner` `Accordion` `AspectRatio` `CollapsibleSection` `Panel` `FileTree` `NavigationMenu` `Tree` `Autocomplete` `ColorPicker` `Combobox` `Listbox` `PinInput` `TagInput`，以及日期时间一族 12 个（`DateField` `DatePicker` `DateRangeField` `DateRangePicker` `MonthPicker` `MonthRangePicker` `YearPicker` `YearRangePicker` `TimeField` `TimePicker` `TimePickerDefault` `TimeRangeField`）。连同只被它们用的 `Calendar`、`RangeCalendar`，日期时间一族共 14 个，产品里一个都没用。
- **谁都没用**：`Avatar`（连 Lab 夹具都没有）。
- 旧应用从 nb-ui 导入 243 处。

## 用量表

| 组件 | 目录 | neuro-book | dev-panel | nb-story | nb-ui 内部 | 旧应用 |
|---|---|---|---|---|---|---|
| `Button` | controls | 18 | 21 | 0 | 4 | 31 |
| `Badge` | display | 0 | 24 | 3 | 0 | 21 |
| `IconButton` | controls | 16 | 1 | 9 | 1 | 31 |
| `FormInput` | form | 6 | 5 | 6 | 0 | 14 |
| `SegmentedControl` | controls | 3 | 3 | 9 | 0 | 7 |
| `Dropdown` | controls | 8 | 0 | 1 | 1 | 8 |
| `Tooltip` | feedback | 4 | 4 | 0 | 2 | 10 |
| `Dialog` | feedback | 5 | 4 | 0 | 0 | 23 |
| `FormSelect` | form | 2 | 6 | 1 | 0 | 14 |
| `Spinner` | display | 3 | 3 | 0 | 3 | 9 |
| `FormTextarea` | form | 1 | 7 | 0 | 0 | 6 |
| `ContextMenu` | feedback | 2 | 0 | 2 | 0 | 4 |
| `EmptyState` | display | 0 | 3 | 0 | 1 | 1 |
| `FormCheckbox` | form | 1 | 0 | 2 | 1 | 0 |
| `FormField` | form | 1 | 3 | 0 | 0 | 2 |
| `Kbd` | display | 3 | 0 | 0 | 1 | 0 |
| `AlertDialog` | feedback | 2 | 1 | 0 | 0 | 0 |
| `Collapsible` | layout | 0 | 2 | 0 | 1 | 1 |
| `DropFeedbackOverlay` | layout | 3 | 0 | 0 | 0 | 2 |
| `GridRenderer` | layout | 3 | 0 | 0 | 0 | 4 |
| `RadioGroup` | form | 0 | 3 | 0 | 0 | 2 |
| `Slider` | form | 0 | 0 | 3 | 0 | 1 |
| `Splitter` | layout | 0 | 1 | 1 | 1 | 0 |
| `Tabs` | controls | 2 | 0 | 1 | 0 | 1 |
| `Breadcrumb` | navigation | 0 | 1 | 0 | 1 | 0 |
| `Drawer` | feedback | 0 | 2 | 0 | 0 | 0 |
| `DropIndicatorLabel` | layout | 1 | 0 | 0 | 1 | 2 |
| `InfoTip` | feedback | 2 | 0 | 0 | 0 | 0 |
| `Notification` | feedback | 0 | 1 | 0 | 1 | 0 |
| `OverlayScrollbar` | layout | 2 | 0 | 0 | 0 | 0 |
| `Popover` | feedback | 0 | 1 | 1 | 0 | 1 |
| `Switch` | controls | 1 | 1 | 0 | 0 | 8 |
| `Calendar` | form | 0 | 0 | 0 | 1 | 0 |
| `CheckboxGroup` | form | 0 | 1 | 0 | 0 | 1 |
| `ColorSwatches` | form | 1 | 0 | 0 | 0 | 0 |
| `DropIndicator` | layout | 0 | 0 | 0 | 1 | 0 |
| `FileBrowser` | navigation | 1 | 0 | 0 | 0 | 0 |
| `FormNumberInput` | form | 1 | 0 | 0 | 0 | 0 |
| `Menubar` | controls | 1 | 0 | 0 | 0 | 0 |
| `NotificationViewport` | feedback | 1 | 0 | 0 | 0 | 0 |
| `Progress` | display | 0 | 0 | 0 | 1 | 0 |
| `QuickInput` | feedback | 1 | 0 | 0 | 0 | 1 |
| `RangeCalendar` | form | 0 | 0 | 0 | 1 | 0 |
| `ScrollArea` | layout | 1 | 0 | 0 | 0 | 0 |
| `Separator` | layout | 1 | 0 | 0 | 0 | 1 |
| `Skeleton` | display | 1 | 0 | 0 | 0 | 0 |
| `Table` | display | 0 | 1 | 0 | 0 | 0 |
| `ToggleGroup` | controls | 1 | 0 | 0 | 0 | 2 |
| `Accordion` | layout | 0 | 0 | 0 | 0 | 0 |
| `AspectRatio` | layout | 0 | 0 | 0 | 0 | 0 |
| `Autocomplete` | form | 0 | 0 | 0 | 0 | 1 |
| `Avatar` | display | 0 | 0 | 0 | 0 | 0 |
| `Banner` | feedback | 0 | 0 | 0 | 0 | 0 |
| `CollapsibleSection` | layout | 0 | 0 | 0 | 0 | 5 |
| `ColorPicker` | form | 0 | 0 | 0 | 0 | 0 |
| `Combobox` | form | 0 | 0 | 0 | 0 | 0 |
| `DateField` | form | 0 | 0 | 0 | 0 | 0 |
| `DatePicker` | form | 0 | 0 | 0 | 0 | 0 |
| `DateRangeField` | form | 0 | 0 | 0 | 0 | 0 |
| `DateRangePicker` | form | 0 | 0 | 0 | 0 | 0 |
| `Editable` | controls | 0 | 0 | 0 | 0 | 0 |
| `FileTree` | navigation | 0 | 0 | 0 | 0 | 0 |
| `HoverCard` | feedback | 0 | 0 | 0 | 0 | 0 |
| `Listbox` | form | 0 | 0 | 0 | 0 | 0 |
| `MonthPicker` | form | 0 | 0 | 0 | 0 | 0 |
| `MonthRangePicker` | form | 0 | 0 | 0 | 0 | 0 |
| `NavigationMenu` | navigation | 0 | 0 | 0 | 0 | 0 |
| `Pagination` | controls | 0 | 0 | 0 | 0 | 0 |
| `Panel` | layout | 0 | 0 | 0 | 0 | 0 |
| `PinInput` | form | 0 | 0 | 0 | 0 | 0 |
| `Rating` | display | 0 | 0 | 0 | 0 | 0 |
| `Stepper` | controls | 0 | 0 | 0 | 0 | 0 |
| `SwitchField` | controls | 0 | 0 | 0 | 0 | 0 |
| `TagInput` | form | 0 | 0 | 0 | 0 | 0 |
| `TimeField` | form | 0 | 0 | 0 | 0 | 0 |
| `TimePicker` | form | 0 | 0 | 0 | 0 | 0 |
| `TimePickerDefault` | form | 0 | 0 | 0 | 0 | 0 |
| `TimeRangeField` | form | 0 | 0 | 0 | 0 | 0 |
| `Toolbar` | controls | 0 | 0 | 0 | 0 | 0 |
| `Tree` | navigation | 0 | 0 | 0 | 0 | 1 |
| `YearPicker` | form | 0 | 0 | 0 | 0 | 0 |
| `YearRangePicker` | form | 0 | 0 | 0 | 0 | 0 |

## 名字的问题

- **`Form` 前缀不一致**：`FormInput` `FormTextarea` `FormSelect` `FormCheckbox` `FormNumberInput` `FormField` 带前缀，同样是表单控件的 `Slider` `Switch` `RadioGroup` `CheckboxGroup` `TagInput` `PinInput` `Combobox` 不带。`FormField` 是“标签加说明加控件”的容器，与“输入控件”不是一类东西，却共用前缀。
- **业务语义进了通用库**：`FileTree`、`FileBrowser` 带文件系统语义（图标、目录）；`FileTree` 没人用，`FileBrowser` 只有 neuro-book 一处在用。资源管理器用的是 neuro-book 自己的 `ExplorerTree`。
- **实现细节当成组件导出**：`TimePickerDefault` 是 `TimePicker` 的主题默认实现。
- **名字太泛或说不清**：`Panel`（一个带边框的容器）；`Editable`（就地编辑一段文字）；`QuickInput`（其实是命令面板与快速打开的浮层，名字照搬 VS Code 的内部名）；`GridRenderer`（嵌套分隔面板）。
- **一族名字各说各的**：`Notification`（一条内联通知）、`NotificationViewport`（右下角的通知队列）、`Banner`（常驻横幅）；`DropIndicator`、`DropIndicatorLabel`、`DropFeedbackOverlay`。

## 有歧义或功能重复的几组

| 组 | 成员 | 问题 |
|---|---|---|
| 弹出列表 | `Dropdown` `ContextMenu` `Menubar` `NavigationMenu` `FormSelect` `Combobox` `Autocomplete` `QuickInput`，常驻的 `Listbox`；应用里的 `PromptMenuPanel` | 外壳类共用，菜单项、高亮与选中、滚动条各写各的：高亮两套、选中四套、圆角四套；浮动滑块只在 `Dropdown` 与 `FormSelect` 里有，两份逐字复制；截断高度按 32px 行高算，`Dropdown` 实际 28px。`Combobox` 与 `Autocomplete` 都是“输入框加候选”，差别只在值是不是必须选中项 |
| 浮层说明 | `Tooltip` `InfoTip` `Popover` `HoverCard` | `InfoTip` 是“问号图标加 `Tooltip`”的组合；`HoverCard` 与 `Popover` 只差悬停还是点击打开 |
| 折叠 | `Collapsible` `CollapsibleSection` `Accordion` | 三个都管展开收起；产品里只用了 `Collapsible`（dev-panel） |
| 互斥切换 | `SegmentedControl` `ToggleGroup` `Tabs` `RadioGroup` | 四个都能“从几个里选一个”；`ToggleGroup` 还能多选 |
| 开关与勾选 | `Switch` `SwitchField` `FormCheckbox` `CheckboxGroup` | `SwitchField` 是“开关加标签整行可点”，没人用；设置页用的是 neuro-book 自己的设置行 |
| 滚动 | `ScrollArea` `OverlayScrollbar`，`Dropdown`/`FormSelect` 里的自绘滑块 | 三套滚动条外观与时机 |
| 树 | `Tree` `FileTree`，应用里的 `ExplorerTree` | 两个 nb-ui 树都没人用 |
| 通知 | `Notification` `NotificationViewport` `Banner` | 见上节 |
| 日期时间 | 14 个 | 都没人用；还有主题替换入口（`TimePicker` 与 `TimePickerDefault`） |
| 容器与分栏 | `Panel` `Splitter` `GridRenderer` | `Panel` 没人用 |

## 文档与 Spec

- nb-ui 自己的文档：`README.md`（309 行）、`docs/ui-development-spec.md`（441 行）、`docs/design-language.md`（1270 行）、`docs/authoring-themes.md`（333 行）、`PROJECT-STATUS.md`，每个组件一份同名 `.md`。
- `ui-development-spec.md` 与代码对不上的已知几处：浮层底色写 65% 透明度，代码是不透明的 `--bg-panel`；截断高度写 228px 与 194px（6.5 项与 5.5 项），代码紧凑档只给 5 项（160px）；浮层圆角写外框 12px、内圈 5px，代码走 `--radius-menu` 到 `--radius-panel`；要求危险项用 `.nb-ui-menu-item-danger`，`Dropdown` 却内联了同样的颜色。规范里还按组件逐个写“方案 2-A”“BH1-C”这类评审代号，读的人不知道指什么。
- 仓库级：`docs/specs/ui/component-lab.md`、`nested-grid.md`、`theme/system.md` 写到 nb-ui；`docs/standards/code/components.md` 是组件文档的写法规范。nb-ui 自己没有 `docs/specs/` 里的 Spec。

## 待开发者定

见 Task README。
