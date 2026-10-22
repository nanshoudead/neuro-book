---
标签: [state:local]
别名: ["设置文件视图", "Settings File"]
验证入口: SettingsWindow
---

# SettingsFileView

设置窗口里的“设置文件”视图（[`settings/settings-window.md`](../../../../../../../docs/specs/settings/settings-window.md) 输出 23）：整份编辑当前标签那一层的设置文件，经窗口模型给的读写路（`window.file(layer)`，远程合同 `readText`、`writeText`，[`settings/configuration.md`](../../../../../../../docs/specs/settings/configuration.md) 输出 24）。窗口画标题与说明，这里从文件路径开始。

## 布局

自上而下：项目层的文件路径（等宽小字；用户层的文件在状态根下，不显示路径）；操作行（文本框的标题“设置文件（用户）”或“设置文件（本作品）”、有改动时“有没保存的改动”、右端“放弃改动”“保存”（主按钮在最右，与 page 页面的草稿操作行同一顺序），没有改动时两个按钮停用）；别处改过、保存失败的提示；等宽的多行文本框（18 行、不自动换行、可以纵向拖动）；一行键盘提示。操作行放在文本框上面：文本框很长，放在下面时有改动也看不到按钮。第一次读取中显示转圈与“正在读取设置文件”；读不了时写出原因与“重新读取”。

## 交互

- 打开或换标签时读一次这一层的文件；换标签前有改动的，窗口已经先确认过，草稿丢掉。
- 编辑：`Tab` 插入两个空格（经浏览器的编辑插入，撤销栈留着；选中了一段时不插，照常移焦点）。第一次 `Esc` 只“放开 Tab”、窗口不关，紧接着的 `Tab` 移走焦点；再按一次 `Esc` 才交给窗口。焦点在视图里时 `Mod+S` 保存（macOS 是 Command，其它平台是 Ctrl，按物理键判断）；文本框里的 `Mod+F` 不拦，留给浏览器的页内查找。文本框下面一行写着这几个键。
- 换行：读到 CRLF 的文件时文本框里是归一后的换行，保存时换回 CRLF，一次保存不改动整个文件的换行。
- 保存：成功后按钮停用、焦点回到文本框；文本不合格时不写，写“没有保存：第 N 行第 M 列：<中文原因>”、标出错（`aria-invalid`，原因接进 `aria-describedby`），光标放到出错的地方，再改文本时出错的标记去掉；文件在读出之后被别处改过时写明“重新读取”会丢掉这里的改动、“仍然保存”会盖掉别处的改动，给这两个按钮（“仍然保存”拿当前的修订号再写一次）。其余失败写原因（与设置窗口的通知同一套文案）。
- 别处改了文件（文本的修订号变了）：没有改动时原地重读（文本框不卸载，滚动位置留着）；有改动时只提示，同样给“重新读取”“仍然保存”。
- 这一层连不上时文本框只读，写“暂时连不上，不能保存”。
- 从层警告进来时（输出 13）：窗口模型留着一个待定位的位置，第一次读完文件后取走、光标放到那里、那一行落在文本框中间，只用一次（取走后模型里没有了，之后重读、换标签不再跳）；视图已经在显示时位置后挂上，就地定位。没有位置（层快照没给）时只打开文件。
- 有改动时报给窗口的未保存保护（`window.fileDirty`），卸载时报没有。

## 数据

```ts
import type {SettingLayer} from "nbook/shared/settings";
import type {SettingsWindow} from "../settings-window";

type Props = {
    /** 窗口模型：读写路、层的说明、待定位的位置、显示语言与未保存保护。 */
    window: SettingsWindow;
    /** 编辑的那一层。 */
    layer: SettingLayer;
    /** 这一层的文件路径；用户层为 null。 */
    path: string | null;
};
```

没有 emits、slots、expose；attrs 落在根上。根带 `data-settings-file` 与 `data-settings-file-state`（`loading`、`read-failed`、`ready`），文本框带 `data-settings-file-text`，路径带 `data-settings-file-path`，出错的一行带 `data-settings-file-error`，“别处改过”的提示带 `data-settings-file-changed`，操作行带 `data-settings-file-actions`，“有没保存的改动”带 `data-settings-file-unsaved`。

## 隐藏通道理由

- `state:local`：草稿、读出的原文与修订号、文件原来的换行、出错的原因只属于这一次打开，关掉或换标签就丢；保存经窗口模型写，层的状态在模型里。
