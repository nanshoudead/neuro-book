---
标签: [state:inject]
别名: ["设置页内列表", "Settings Page List", "列表加下一级页面"]
---

# SettingsPageList

设置窗口里 page 分区的“一张列表加下一级页面”（[`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md) 输出 19），取代原来的左列表右详情：没打开项时是一张列表（例如模型服务页的服务商），点一行就整页换成这一项的内容；窗口标题区同时换成“‹ 页面标题”与这一项的标题，点“‹ 页面标题”回到列表。组件是受控的：打开了哪一项只由 `modelValue` 决定，点一行、点返回都只发 `update:modelValue`，值由调用方改。

## 布局

- 列表（`modelValue` 为 `null`）：每项一行，没有描边、没有底色。一行从左到右是：可选的图标（32px 见方的小方块，淡底、状态色图标）、标题（单行，放不下以省略号结尾，后面可跟一个 6px 的小圆点表示“有改动”）与其下的说明（`--text-xs`、次要色、单行截断）、状态文字（`--text-xs`，按 `tone` 着色）、右箭头。行的淡底比内容列宽一个内边距（两端各伸出 `--space-4`），文字仍与上下的内容对齐。行之间 `--space-1`。
- 详情（`modelValue` 为某项的 id）：列表整个不画，默认插槽的内容占满组件宽度，组件不给它加内边距。
- 列表自己不滚动，滚动由页面或窗口的容器负责。

## 交互

- 点一行（或聚焦后按 `Enter`、`Space`）发 `update:modelValue(id)`。每行是一个原生按钮：`Tab` 与 `Shift+Tab` 逐行移动，焦点环同其它按钮；不另做上下键，列表一般只有几项到十几项。
- 悬停：一层淡底，不换色；按下不缩放、不换色。
- 返回：窗口里点标题区的“‹ 页面标题”，没有窗口时点详情上方的“‹ 返回”，都发 `update:modelValue(null)`。调用方把值改成 `null` 之后列表画回来，焦点回到刚才那一行；调用方没改值（拒绝返回）时焦点不动。
- 切到另一项（调用方直接把 `modelValue` 改成另一个 id）时标题区换成新一项的标题；这一项的标题变了（例如页面里在改名字）时标题区跟着变。
- `modelValue` 指向 `items` 里没有的项（刚被删掉）时当作没有打开，画列表；这时不登记标题替换。
- 读屏：列表是带 `label` 作可访问名称的 `<ul>`，每行是一个按钮，按钮名称是标题、说明与状态文字；“有改动”的圆点是 `role="img"`，名称“有改动”。

## 数据

```ts
type SettingsPageListTone = "success" | "warning" | "error" | "muted";

interface SettingsPageListItem {
    readonly id: string;
    readonly title: string;
    /** 第二行的说明。 */
    readonly description?: string;
    /** 图标类名，例如 i-lucide-server。 */
    readonly icon?: string;
    /** 右端的状态文字，例如“已连接”。 */
    readonly status?: string;
    /** 状态文字的色调；缺省 muted（次要文字色）。 */
    readonly tone?: SettingsPageListTone;
    /** 标题后画“有改动”的小圆点。 */
    readonly modified?: boolean;
}

type Props = {
    /** 条目；必填。 */
    items: ReadonlyArray<SettingsPageListItem>;
    /** 打开的项的 id，`null` 是列表；受控。 */
    modelValue: string | null;
    /** 列表的可访问名称；必填。 */
    label: string;
    /** 显示语言，只管“返回”“有改动”两处固定文字；缺省简体中文。 */
    locale?: DisplayLocale;
};

type Emits = {
    /** 点一行发这一项的 id，返回发 null。 */
    (event: "update:modelValue", id: string | null): void;
};

type Slots = {
    /** 打开的这一项的内容。 */
    default?(props: {item: SettingsPageListItem}): unknown;
};
```

没有 expose；attrs 落在根上。根带 `data-state`（`list` 或 `detail`）；行带 `data-settings-page-list-item`（id），状态文字带 `data-settings-page-list-status` 与 `data-tone`，小圆点带 `data-settings-page-list-modified`；详情的容器带 `data-settings-page-list-detail`，没有窗口时自画的返回按钮带 `data-settings-page-list-back`。

## 状态

- 列表：无描边；悬停淡底；聚焦出焦点环。
- 详情：只有页面的内容；在窗口里时标题区是“‹ 页面标题”与这一项的标题，没有窗口时上方一行“‹ 返回”。
- 空：`items` 为空时列表里没有行，空态由页面自己写。

## 不支持

- 多选、拖动排序、分组小标题、停用某一行。页内列表的顺序就是 `items` 的顺序，要排序的页面自己写。
- 自己滚动或虚拟化。
- 同一个页面里两个 `SettingsPageList` 同时打开项：标题区通道只有一个槽，后登记的盖过先登记的。

## 注意事项

- 标题替换的所有权：组件打开一项时经窗口通道登记一次，换一项、返回、卸载时撤销，撤销只撤自己那一次，所以页面卸载（离开分区、开始搜索、关窗口、重试）后标题区自动恢复；切标签页面不重建，替换保留。“页面标题”由窗口给（就是分区的标题），组件不接这个属性。
- `modelValue` 为某项的 id 时才会画默认插槽；插槽里的内容随这一项一起创建与销毁，草稿之类要跨“返回”保留的状态放在页面里，不放在插槽内容里。

## 隐藏通道理由

- `state:inject`：标题区在窗口里、页面在窗口的另一个子树里，打开一项时要经窗口的通道（`page-chrome.ts`）换标题；让每个页面自己接线并把标题与返回动作逐层传出去，页面作者要重复写同一套，也容易漏掉卸载时的撤销。没有通道（Lab 单独渲染）时组件在详情上方自己画返回，列表与插槽照常工作。
