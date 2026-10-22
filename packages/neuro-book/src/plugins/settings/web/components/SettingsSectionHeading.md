---
标签: [state:inject]
别名: ["设置分区标题", "Settings Section Heading"]
验证入口: SettingsWindow
---

# SettingsSectionHeading

设置窗口里分区的标题区（[`settings/settings-window.md`](../../../../../../../docs/specs/settings/settings-window.md) 输出 3、13、19）：左边标题与跟在后面的说明，右边是层的警告与页面级操作。column 与 fill 两种画法共用一份：column 里随内容列滚动，fill 里固定在页面上方。

## 布局

一行：左边标题（品牌展示字体 `--font-display`，26px 字、32px 行高，整数像素；token 最大一档只有 20px，放不下，所以两个数是组件里的局部变量），标题后同一行是说明（`--text-sm`、弱化色，基线对齐）；说明放不下时以省略号截断，悬停（nb-ui `Tooltip`）显示全文；说明收到没有之后标题再收，同样以省略号结尾（被替换的标题是用户给的名字，可能很长）。右边从右往左是页面级操作的挂载点与层的警告，它们不缩；没有页面级操作时挂载点不占位。与下面的内容隔 `--space-7`。关闭按钮在对话框自己的标题行里，不进标题区，与右侧不重叠。

标题被页面替换（`replacement`，见 `SettingsPageList` 打开一项）时：标题上方一行“‹ 分区标题”（强调色文字的返回按钮），标题换成页面给的标题，说明不显示（说明属于分区）。

层的警告（`notice`）三种：

- `invalid`：一个按钮，左边警告图标与“设置文件格式有误”，右边一小块“打开 →”，警告色的淡底与描边；悬停（`Tooltip`）逐行写“第 N 行第 M 列：原因”（快照没有位置时只写原因）、“修复前，这一层的设置无法保存”与文件路径（有路径时）。
- `unavailable`：不可点的文字“暂时无法连接，无法保存”，同样的警告色外观。
- `fixing`：设置文件视图里要用户照着改的文字，不可点：层无效时的“第 N 行第 M 列：原因，改好后保存”；保存被拒后视图经通道登记的“未保存：第 N 行第 M 列：原因”（后者盖过前者，改了文本就撤掉）。

## 交互

- 点 `invalid` 的按钮发 `open-file`，由窗口切到“设置文件”并定位；按钮可以键盘聚焦，焦点环同其它按钮。
- 点“‹ 分区标题”发 `back`。
- `unavailable`、`fixing` 是 `role="status"` 的文字。

## 数据

```ts
type SettingsSectionNotice =
    | {kind: "invalid"; text: string; action: string; lines: ReadonlyArray<string>}
    | {kind: "unavailable" | "fixing"; text: string};

interface SettingsSectionReplacement {
    title: string;
    /** “‹”后面的字：分区标题。 */
    backLabel: string;
    /** 返回按钮的可访问名称：“返回 {分区标题}”。 */
    backName: string;
}

type Props = {
    title: string;
    description: string | null;
    notice: SettingsSectionNotice | null;
    replacement: SettingsSectionReplacement | null;
};

type Emits = {
    (event: "open-file"): void;
    (event: "back"): void;
};
```

没有 slots、expose；attrs 落在根上。右侧有一个空的挂载点（`data-settings-heading-actions`），挂载后经窗口通道（`ui/settings/page-chrome.ts`）登记给页面级操作（`SettingsPageActions`）Teleport，卸载时注销。所有文字由窗口按显示语言算好传入。

## 隐藏通道理由

- `state:inject`：把右侧挂载点登记到窗口的通道里；标题区不知道页面在哪，页面也不该为此接线。
