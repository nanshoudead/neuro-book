---
标签: [state:local, state:inject]
别名: ["设置文件视图", "Settings File"]
验证入口: SettingsWindow
---

# SettingsFileView

设置窗口里的“设置文件”视图（[`settings/settings-window.md`](../../../../../../../docs/specs/settings/settings-window.md) 输出 23）：整份编辑当前标签那一层的设置文件，经窗口模型给的读写路（`window.file(layer)`，远程合同 `readText`、`writeText`，[`settings/configuration.md`](../../../../../../../docs/specs/settings/configuration.md) 输出 24）。窗口画标题与说明，这里从文件路径开始。

## 布局

自上而下：项目层的文件路径（等宽小字；用户层的文件在状态根下，不显示路径）；别处改过、保存失败（冲突、写不进去）的提示，带“重新读取”“仍然保存”；带行号的等宽多行文本框；一行键盘提示；底部的保存栏（视图占满窗口给的整块区域，文本框吃掉剩下的高度，保存栏钉在最下面、不随内容滚走；[`SettingsSaveBar`](../../../../ui/settings/SettingsSaveBar.md)，“放弃更改”“保存”一直在，没有改动时停用并且不写字，有改动时写“有未保存的更改”）。文本框的标题（“设置文件（用户）”或“设置文件（本作品）”）只给读屏，不画出来：窗口的左栏与标签已经说明是哪一层。第一次读取中显示转圈与“正在读取设置文件”；读不了时写出原因与“重新读取”。

文本框与行号合在一个外框里：外框带描边与底色，聚焦、只读、出错的外观由 nb-ui 的控件基座按外框给；文本框透明，不自动换行，不能拖动大小：高度随窗口伸缩，窗口很矮时至少留 6 行。行号列在文本框左边，一行文字对一行行号，右对齐、弱化色，位数随行数增加；行号与出错行的底是垫在文本框底下的另一层（`aria-hidden`，不接收指针），跟着文本框的 `scroll` 事件平移，两边用同一个整数像素的行高。没有用同一个滚动容器：文本框要保持原生的 `textarea`（光标、选区、撤销栈、输入法都靠它），外面套不了容器；同步用 `transform` 而不是行号列的 `scrollTop`，因为横向滚动条占掉的高度会让两边的最大滚动距离差一截。

出错行：保存被拒（`invalid-text`）与从层警告进来时，那一行在行号列与文本行上都垫一条危险色的淡底、行号变危险色，外框描边也变危险色；改了文本就去掉。

键盘提示一行，用 nb-ui 的 `Kbd`：`Tab` 插入缩进、`Esc` 后 `Tab` 移出编辑区、`Ctrl`（macOS 是 `⌘`）`S` 保存（两种语言）。

## 交互

- 打开或换标签时读一次这一层的文件；换标签前有改动的，窗口已经先确认过，草稿丢掉。
- 编辑：`Tab` 插入两个空格（经浏览器的编辑插入，撤销栈留着；选中了一段时不插，照常移焦点）。第一次 `Esc` 只“放开 Tab”、窗口不关，紧接着的 `Tab` 移走焦点；再按一次 `Esc` 才交给窗口。焦点在视图里时 `Mod+S` 保存（macOS 是 Command，其它平台是 Ctrl，按物理键判断）；文本框里的 `Mod+F` 不拦，留给浏览器的页内查找。文本框下面一行写着这几个键。
- 换行：读到 CRLF 的文件时文本框里是归一后的换行，保存时换回 CRLF，一次保存不改动整个文件的换行。
- 保存：成功后按钮停用、焦点回到文本框；文本不合格时不写，窗口标题区右侧写“未保存：第 N 行第 M 列：<中文原因>”（经 `page-chrome` 的 `claimNote` 交给窗口，盖过层警告里的“改好后保存”；框里另留一份只给读屏的同样文字，接进 `aria-describedby`），出错行标底色、文本框标出错（`aria-invalid`），光标放到出错的地方，再改文本时这些标记都去掉；没有窗口通道时（视图单独渲染）失败文字照常画在框上面。文件在读出之后被别处改过时，框上面写“未保存：文件已在别处被修改。‘重新读取’会放弃这里的更改，‘仍然保存’会覆盖别处的修改。”，给这两个按钮（“仍然保存”拿当前的修订号再写一次）。其余失败写“未保存：<原因>”（原因与设置窗口的通知同一套文案）。
- 别处改了文件（文本的修订号变了）：没有改动时原地重读（文本框不卸载，滚动位置留着）；有改动时只提示，同样给“重新读取”“仍然保存”。
- 这一层连不上时文本框只读，保存栏的两个按钮停用（经 `busy`），窗口标题区写“暂时无法连接，无法保存”。
- 从层警告进来时（输出 13）：窗口模型留着一个待定位的位置，第一次读完文件后取走、光标放到那里、那一行落在文本框中间并标出错底色，只用一次（取走后模型里没有了，之后重读、换标签不再跳）；视图已经在显示时位置后挂上，就地定位。没有位置（层快照没给）时只打开文件。
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

没有 emits、slots、expose；attrs 落在根上。根带 `data-settings-file` 与 `data-settings-file-state`（`loading`、`read-failed`、`ready`），外框带 `data-settings-file-editor`，文本框带 `data-settings-file-text`，行号列每一行带 `data-settings-file-line`（出错行再带 `data-error`）、整列带 `data-settings-file-lines`，键提示带 `data-settings-file-keys`，路径带 `data-settings-file-path`，失败的一行带 `data-settings-file-error`，“别处改过”的提示带 `data-settings-file-changed`，保存栏带 `data-settings-file-actions`（栏自己的标记见 `SettingsSaveBar`）。

## 隐藏通道理由

- `state:local`：草稿、读出的原文与修订号、文件原来的换行、出错的原因只属于这一次打开，关掉或换标签就丢；保存经窗口模型写，层的状态在模型里。
- `state:inject`：从窗口的通道（`ui/settings/page-chrome.ts`）取标题区右侧的提示登记，保存被拒的文字经它写到标题区；视图不知道标题区在哪，窗口也不该要求视图传 props。
- `state:inject`（续）：经 `useText()` 取宿主注入的翻译端口，键提示、读取与保存失败的文字在 `nbook.settings` 的目录里（`file.*` 键）；组件没有语言属性。没有宿主注入时只显示键名，所以测试与 Lab 场景要注入登记了这份目录的宿主引擎端口。
