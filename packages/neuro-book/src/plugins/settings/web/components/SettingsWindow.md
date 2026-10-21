---
标签: [state:local, env:portal]
别名: ["设置窗口", "Settings", "Preferences"]
---

# SettingsWindow

设置窗口（[`settings/settings-window.md`](../../../../../../../docs/specs/settings/settings-window.md)）：非模态的浮动窗口，左栏列出分区，右边一次显示一个分区；绑定作品的窗口在左栏上方有“用户 | 本作品”两个标签。它是窗口模型（`settings-window.ts` 的 `SettingsWindow`）的呈现：开着与否、当前分区与标签、尺寸、左栏、当前分区的视图、层的说明都从模型读，用户的操作交回模型的方法。list 分区交给 [`SettingsListSection`](SettingsListSection.md)，page 分区交给 [`SettingsPageFrame`](SettingsPageFrame.md)，左栏最后固定的“设置文件”交给 [`SettingsFileView`](SettingsFileView.md)。模型由 `nbook.settings` 的窗口入口持有，组件挂在页面根上（工作台的页面浮层），每个浏览器页面一份。

## 布局

- **外框**：nb-ui `Dialog`（`modal=false`），标题“设置”，右上角关闭按钮，没有页脚；尺寸取模型（缺省 960×640，不超过容器），可拖右、下两边与四角调整，下限 600×400；切换分区不改变尺寸；每次打开居中。
- **标签**：绑定作品时，正文最上面左对齐一个分段控件“用户 | 本作品”，两段等宽、与左栏的搜索框同宽同左边缘（t80 定稿）；没有绑定不画。
- **左栏**：宽 180px，最上面一个搜索框（小尺寸、放大镜图标、可清空，名字“搜索设置”），下面是分区，不随内容滚动（条目多时分区列表自己滚），三组分区自上而下：应用、AI、插件，组间一条分隔线，没有组标题；每项图标加标题，当前项是中性灰底的按钮，其余是透明按钮；当前标签下不可用的项停用，以原因作提示（当前项不可用时仍可聚焦，右边显示原因）。左栏与右边之间一条竖分隔线。
- **右边**：分区标题（`--text-lg`）与一行说明，下面是层的说明（层有问题时），这三样由 [`SettingsSectionHeading`](SettingsSectionHeading.md) 画，column 与 fill 共用；再下面是分区内容。list 分区与 `column` 页面放在内容列里：左右内边距相同、宽度封顶约 768px，内容列整体滚动；`fill` 页面拿到标题下面的整块区域，外边距同内容列、不封顶，自己分栏、自己滚动。当前分区在这个标签下不可用时，右边在标题下原位写原因。
- **搜索结果**：有搜索词时右边标题是“搜索结果”，下面按分区分组列出命中的设置项（同 list 分区的画法），再下面一组“页面”列出命中的 page 分区（标题、说明与“打开”按钮）；都没有时一句“没有找到设置”。左栏照旧，但不标当前项。
- **窄容器**：窗口窄于约 600px（例如手机宽度的画布）时左栏移到右边上方，条目换行排列，右边不再封顶；设置窗口只做桌面宽度，这一档只保证不横向溢出。

## 交互

- 关闭：关闭按钮与 `Esc` 经 `request-close` 交给模型的 `close()`；焦点回到打开窗口之前的元素（Dialog 归还）。
- 搜索：输入即搜（模型的 `search`），结果数（“N 个设置、M 个页面”）经隐藏的状态行播报；焦点在窗口面板里时 `Mod+F` 聚焦搜索框（监听挂在 Dialog 面板上；按平台与物理键判断；输入法组字时、焦点在设置文件的文本框里时不拦）；框里有字时 `Esc` 只清空、窗口不关（先 `preventDefault`，Dialog 见到已处理就不关）；点清除按钮后焦点回到输入框。“打开”切到那个分区并把焦点放到左栏的当前项。
- 未保存保护：模型的 `leaving` 不为空时弹 nb-ui `AlertDialog`“放弃未保存的改动？”（“放弃”“继续编辑”，`warning` 色调）。确认框里按 `Esc` 等于“继续编辑”（它是受控的，`update:open(false)` 交回 `cancelLeave()`）。“继续编辑”关闭完成（`closed`）后焦点回到弹出之前的元素；“放弃”交回 `confirmLeave()`，窗口还开着时焦点按动作去：从搜索框起手的回搜索框，切标签的回标签，其余到左栏的当前项。
- 打开时焦点在左栏的当前项；窗口已开着时再执行打开命令（模型的 `focusRequest` 加一），焦点回到左栏的当前项。
- 左栏：点一项切换分区；焦点在左栏时上下键切到上一个、下一个可用分区，Home、End 到首尾，焦点跟着走；左栏是一个 Tab 停靠点（当前项）。
- 标签：点“用户”“本作品”切换编辑哪一层；page 页面不重建，只拿到新的层。
- 拖动调整尺寸：松开时把新的宽、高交给模型记住。
- 层的说明：当前标签那一层文件无效时写“设置文件有错误，修好前这里不能保存（<第几行：原因>）”、文件路径（层快照带路径时）与“打开设置文件”（切到设置文件视图；在设置文件视图里改说“在下面改好后保存”，不给这个按钮），连不上时写“暂时连不上，不能保存”；层恢复后自动消失。

## 数据

```ts
import type {SettingsWindow} from "../settings-window";

type Props = {
    /** 窗口模型；必填。 */
    window: SettingsWindow;
};
```

没有 emits、slots、expose；attrs 落在 Dialog 的面板上。正文根带 `data-settings-window`，左栏条目带 `data-settings-nav`（分区 id），当前项另带 `data-settings-nav-current`，组间分隔线带 `data-settings-nav-separator`，搜索框带 `data-settings-search`，搜索结果里的页面一组带 `data-settings-page-hits`、每条带 `data-settings-page-hit`（分区 id），没有命中的一句带 `data-settings-no-results`，层的说明里“打开设置文件”带 `data-settings-open-file`，标签分段带 `data-settings-tabs`，层的说明带 `data-settings-layer-notice`（`invalid` 或 `unavailable`），右边的区域带 `data-settings-section`（分区 id），分区在当前标签下不可用的原因带 `data-settings-unavailable`。

## 状态

- 关闭：不渲染面板（Dialog 关着）；模型的尺寸记录在第一次打开时才读。
- 没有任何分区：右边一句“没有可以显示的设置”。
- 加载、失败：page 分区的交付与加载见 `SettingsPageFrame`；list 分区总是可用。

## 隐藏通道理由

- `env:portal`：Dialog 把面板传送到 `body`（产品）或宿主提供的传送目标（Lab 的画布），脱离页面根的裁剪与层叠；目标找不到时 Dialog 回退到 `body`。
- `state:local`：只有左栏的焦点移动、面板根元素的引用与确认框弹出前的焦点，窗口的状态都在模型里。
