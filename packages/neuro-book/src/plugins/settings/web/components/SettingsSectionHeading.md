---
标签: []
别名: ["设置分区标题", "Settings Section Heading"]
验证入口: SettingsWindow
---

# SettingsSectionHeading

设置窗口里分区的标题、说明与层的提示（[`settings/settings-window.md`](../../../../../../../docs/specs/settings/settings-window.md) 输出 3、13）。column 与 fill 两种画法共用一份：column 里随内容列滚动，fill 里固定在页面上方。

## 布局

标题（`--text-lg` 粗体）下面一行说明（`--text-xs`、弱化色），与下面的内容隔 `--space-6`。层有问题时说明下面一行警告色的提示：图标、原因，项目层带文件路径，文件有错误时跟一个“打开设置文件”。

## 数据

```ts
interface SettingsSectionNotice {
    readonly kind: "invalid" | "unavailable";
    readonly text: string;
    /** 项目层的设置文件路径；用户层不给（状态根不发给浏览器）。 */
    readonly path: string | null;
}

type Props = {
    title: string;
    description: string | null;
    notice: SettingsSectionNotice | null;
    /** 文件有错误时“打开设置文件”的文字；在设置文件视图里不给（null）。 */
    openFileLabel: string | null;
};

type Emits = {(event: "open-file"): void};
```

## 交互

点“打开设置文件”发 `open-file`，由窗口切到“设置文件”。提示是 `role="status"`。
