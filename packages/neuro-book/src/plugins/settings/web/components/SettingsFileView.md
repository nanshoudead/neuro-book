---
标签: [state:local]
别名: ["设置文件视图", "Settings File"]
验证入口: SettingsWindow
---

# SettingsFileView

设置窗口里的“设置文件”视图（[`settings/settings-window.md`](../../../../../../../docs/specs/settings/settings-window.md) 输出 23）：整份编辑当前标签那一层的设置文件，经窗口模型给的读写路（`window.file(layer)`，远程合同 `readText`、`writeText`，[`settings/configuration.md`](../../../../../../../docs/specs/settings/configuration.md) 输出 24）。窗口画标题与说明，这里从文件路径开始。

## 布局

自上而下：项目层的文件路径（等宽小字；用户层的文件在状态根下，不显示路径）、文本框的标题“设置文件（用户）”或“设置文件（本作品）”、等宽的多行文本框（18 行、不自动换行、可以纵向拖动）、提示与出错的一行、有改动时的“保存”“放弃改动”。读取中显示转圈与“正在读取设置文件”；读不了时写出原因与“重新读取”。

## 交互

- 打开或换标签时读一次这一层的文件；换标签前有改动的，窗口已经先确认过，草稿丢掉。
- 编辑：`Tab` 插入两个空格；按过 `Esc` 之后的下一个 `Tab` 照常移走焦点（键盘用户的出口）。`Mod+S` 保存。
- 保存：成功后改动的按钮消失；文本不合格时不写，框下写“没有保存：第 N 行第 M 列：…”并标出错（`aria-invalid`，原因接进 `aria-describedby`）；文件在读出之后被别处改过时写“没有保存：文件在别处改过了”，给“重新读取”（丢掉这里的改动）。其余失败写原因。
- 别处改了文件（文本的修订号变了）：没有改动时直接重读；有改动时只提示“文件在别处改过了”，给“重新读取”。
- 这一层连不上时文本框只读，写“暂时连不上，不能保存”。
- 有改动时报给窗口的未保存保护（`window.fileDirty`），卸载时报没有。

## 数据

```ts
import type {SettingLayer} from "nbook/shared/settings";
import type {SettingsWindow} from "../settings-window";

type Props = {
    /** 窗口模型：读写路、层的说明、显示语言与未保存保护。 */
    window: SettingsWindow;
    /** 编辑的那一层。 */
    layer: SettingLayer;
    /** 这一层的文件路径；用户层为 null。 */
    path: string | null;
};
```

没有 emits、slots、expose；attrs 落在根上。根带 `data-settings-file` 与 `data-settings-file-state`（`loading`、`read-failed`、`ready`），文本框带 `data-settings-file-text`，路径带 `data-settings-file-path`，出错的一行带 `data-settings-file-error`，“别处改过”的提示带 `data-settings-file-changed`，按钮行带 `data-settings-file-actions`。

## 隐藏通道理由

- `state:local`：草稿、读出的原文与修订号、出错的原因只属于这一次打开，关掉或换标签就丢；保存经窗口模型写，层的状态在模型里。
