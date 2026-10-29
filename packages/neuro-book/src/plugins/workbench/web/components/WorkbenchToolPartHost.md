---
标签: [state:local, state:inject]
别名: ["工具区宿主", "Tool Part Host"]
验证入口: WorkbenchShellLayout
---

# WorkbenchToolPartHost

一个工具区域（Sidebar、AuxiliaryBar 或 Panel）里的框：选中容器的挂载落点，加上这个区域自己的标题行（[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 外壳二输出 15–17、25）。容器宿主不由它创建：落点元素经 `target` 报给宿主，宿主把选中容器的宿主搬进去。三个区域的标题行不同：

- Sidebar：容器切换在 ActivityBar 上，这里只在 single 时画 32px 容器标题行（标题加上提的动作）；multiple 不画，每个视图有自己的标题。上提的动作只在指针位于整个 ToolPart 上、焦点在里面或动作的菜单开着时显示，其余时候透明：根是显示范围（`data-hover-actions-scope`），动作区带 `data-hover-actions`（`hover-actions.css`，[`docs/specs/workbench/views.md`](../../../../../../../docs/specs/workbench/views.md) 输出 10）。
- AuxiliaryBar：32px 标题行是容器标签带（nb-ui `Tabs`，只有一个容器也保留；没有容器时标签带空着但仍占位，是拖到 Switcher 的落点），右侧是 single 时上提的动作。
- Panel：没有自己的标题行——面板框架 `WorkbenchPanelSurface` 是 Panel 32px 标题行唯一的拥有者，标签带由宿主放进它的导航槽；这里只有落点。

## 布局

Sidebar 与 AuxiliaryBar 取 `--panel-surface`，自己不画外框、圆角，四周不留白；卡片还是平铺由外壳按主题决定（卡片的圆角、缝与投影在外壳的卡片包装上），Panel 填满面板框架的内容区（[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 输出 38）。标题行固定 32px、不画底线（容器标签带也不画底边线，选中的标签只有指示线），右边留 4px，标签带放不下时逐级让位（nb-ui `Tabs` 的 `overflow="adapt"`：截断到 96px、只留图标、收进“更多”）、动作区不让位；容器标题的省略号裁切在拖动把手自己身上，把手的焦点光环不被标题切掉。区域里没有容器时落点不出现，空正文填满标题行以下的区域，整块是空 Part 的落点；里面内缩 8px 画一个虚线框（1px，正文色 24%，圆角 10px），`emptyText`（产品里是“将视图拖动到此处显示”）在框里居中。

## 交互

- 标签带：点击或方向键切换发 `select`；roving tabindex，Tab 一次进入。右栏与面板的落点是 `role="tabpanel"`，`aria-labelledby` 指向选中的标签，标签的 `aria-controls` 指回它（id 规则在 `switcher-ids.ts`，面板的标签带在面板框架的导航槽里，按同一规则求）。
- 动作区由宿主经 `actions` 插槽放（产品里是“移动到”菜单）。

## 数据

```ts
import type {ContainerPresentation, PartPresentation} from "../views/presentation";

type Props = {
    part: "sidebar" | "auxiliarybar" | "panel";
    /** 呈现模型里这个区域的一份（标签带条目与选中项）；受控。 */
    presentation: PartPresentation;
    /** 选中的容器；区域里没有容器为 null。 */
    selected: ContainerPresentation | null;
    /** 区域的可访问名称（已按当前语言取好）。 */
    label: string;
    /** 区域里没有容器时的说明。 */
    emptyText: string;
    /** 标签与内容面板关联用的 id 前缀；外壳用 `useId()` 取一次，面板框架里的标签带用同一个前缀。 */
    idPrefix: string;
};

type Emits = {
    (event: "select", containerId: string): void;
    /** 选中容器的落点挂上（元素）或卸下（null）。 */
    (event: "target", element: HTMLElement | null): void;
};

type Slots = {
    /** single 时上提的动作（视图动作、容器管理），放在 Sidebar 的容器标题行或 AuxiliaryBar 的标签带右侧。 */
    actions?(props: {container: ContainerPresentation}): unknown;
};
```

没有 expose；attrs 落在根上。根带 `data-tool-part`（区域）；落点带 `data-container-target`；右栏的标签带带 `data-switcher-band`，标签带 `data-switcher-entry` 与 `data-drag-container`，Sidebar 的容器标题行带 `data-drag-container`（标题文字是 `data-drag-handle` 把手），动作区带 `data-no-drag`，空正文带 `data-empty-part`（拖放会话按这些标记找拖动源与落点）。

## 隐藏通道理由

- `state:inject`：经 `useText()` 取宿主注入的翻译端口，标签的拖动把手名称与 `aria-description`、“更多”按钮名称等界面文字都在本插件的目录（命名空间 `nbook.workbench`，`../../locales/`）；语言随端口响应式切换，组件没有语言属性。没有宿主注入时得到 nb-ui 的缺省端口，那里没有本插件的目录，只显示键名，所以测试与 Lab 场景要注入登记了本插件目录的宿主引擎端口。

## 不支持

不登记拖放（由外壳的拖放会话按上面的标记登记），不读写状态；Panel 的标签带与框架按钮不在这里。
