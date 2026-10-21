---
标签: [state:local]
别名: ["设置行", "Settings Row"]
---

# SettingsRow

设置窗口里一项配置的一行（[`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md) 输出 9–13、18）：左边标题与说明，右边放调用方给的控件。“这一层写没写过”“本作品有没有单独设置”“这一层能不能保存”这些规则都由它按配置项的声明、配置服务与当前标签自己算，页面只管控件本身。设置窗口的通用列表与插件自己画的 page 分区用的是同一个组件，两边看起来一样、规则一样。

它不认识具体的控件：开关、单选组、输入框都放在插槽里，它把这一层该显示的值与是否停用交给插槽。它自己只做三种写入：“恢复默认”（删掉这一层的键）、“在本作品里单独设置”（把当前有效值写进本作品层）与“移除本作品的设置”，都经传入的配置服务；控件改值由调用方自己写。

## 布局

两种排法，由 `wide` 决定：

- **标签列加控件列**（缺省）：标签列 200px，放标题（带生效时机的标注）与说明；控件紧跟其后、左对齐，宽度由控件自己定；已修改时控件后面是“恢复默认”图标按钮。开关、横排单选组、下拉、数字与单行输入用这一种。
- **宽排法**（`wide`）：标题与说明在左上，“恢复默认”在标题那一行的右端，控件另起一行、占满这一行的宽度。多行文本、竖排单选组、复选组、列表、对象与 JSON 这类宽控件用这一种。本作品标签沿用时，“沿用用户设置：X”与“在本作品里单独设置”在标题那一行的右端，控件照样画在下面、停用，显示沿用的值：列表这类值一句摘要说不清沿用的是什么。

已修改时标题左侧一条强调色竖线：标签列加控件列时只贴着标题与说明，宽排法时贴着整项。本作品覆盖的提示在整行下面另起一行，信息色、带图标。

宽度不够放下标签列加控件（窄于约 450px）时，控件换到标签下面；单行输入、下拉这类控件不超过行宽。整行不设 `overflow`，控件的焦点环不被裁。

## 交互

- 已修改（当前标签这一层写了这个键）：点“恢复默认”经 `settings.update(setting, undefined, {layer})` 删掉这一层的键，控件回到下一层的值。
- 本作品标签、项目层没写：显示“沿用用户设置：X”与“在本作品里单独设置”，不画控件（宽排法画出停用的控件，见“布局”）；点后者把此刻的值（用户层的值，用户层没写时是默认值）写进本作品层，之后控件可用。
- 本作品标签、项目层写了：控件后面是“移除本作品的设置”，点了删掉项目层的键，回到沿用。
- 用户标签、本作品层写了：行下一行提示“本作品单独设为了 X，这里的改动在《书名》里不生效”。
- 这一层文件无效、连不上或本窗口没有这一层：插槽拿到 `disabled: true`，三种动作按钮停用；层恢复后自动解除。
- 一次写入在进行中时，同一个按钮停用，不发起第二次。写入没有成功（含结果未知）时发 `write-failed`，界面上的值以配置服务里这一层的实际值为准。

## 数据

```ts
import type {DisplayLocale} from "nbook/shared/localized-text";
import type {SettingDefinition, SettingLayer, SettingsFailure, SettingsService} from "nbook/shared/settings";

type Props = {
    /** 配置服务：读这一项（`inspect`，响应式），写三种动作。页面传自己插件的；设置窗口的通用列表传自己的用户编辑路径。必填。 */
    settings: SettingsService;
    /** 这一项的定义。必填。 */
    setting: SettingDefinition<unknown>;
    /** 当前标签，即编辑哪一层。必填、受控。 */
    layer: SettingLayer;
    /** 显示语言。必填。 */
    locale: DisplayLocale;
    /** 窗口绑定的作品的书名；覆盖提示里用它，缺省 null 时写“本作品”。 */
    projectTitle?: string | null;
    /** 宽排法；缺省 false。 */
    wide?: boolean;
};

type Emits = {
    /** 行自己发起的写入没有成功（含 `unknown-outcome`）；调用方决定怎么告诉用户（设置窗口发工作台通知）。 */
    (event: "write-failed", failure: {action: "reset" | "override" | "remove"; code: SettingsFailure; detail: string}): void;
};

type Slots = {
    /**
     * 控件。`value` 是这一层显示的值：这一层写了取这一层（层无效时是上一份有效内容里的），没写取下一层；`disabled` 为真时控件
     * 应停用；`id` 给能与标签关联的控件（输入框、下拉的触发器、开关）作 id，行的 `<label for>` 指向它；组合控件（单选组、
     * 复选组）拿不到 `<label for>` 的名字，用 `labelId`（行标题的 id）作 `aria-labelledby`，或用 `label` 文字作
     * `aria-label`；`describedby` 是行里说明的 id（没有说明时为 undefined），接进控件的 `aria-describedby`。
     * 不允许这一层时不渲染；沿用时只有宽排法渲染，`value` 是沿用的值、`disabled` 为真。
     */
    default(props: {value: unknown; disabled: boolean; id: string; label: string; labelId: string; describedby: string | undefined}): unknown;
};
```

没有 expose；attrs 落在根上。根带 `data-settings-row`（键）、`data-settings-row-state`（`edit`、`inherit` 或 `not-allowed`），已修改时带 `data-settings-row-modified`，停用时带 `data-settings-row-blocked`；宽排法里控件那一行带 `data-settings-row-wide`、标题行右端的动作带 `data-settings-row-head`。

## 状态

- **可编辑**：标题、说明、控件；已修改时竖线与“恢复默认”（本作品标签是“移除本作品的设置”）。
- **沿用**：本作品标签、项目层没写，见“交互”。层不可用时“在本作品里单独设置”停用。
- **不允许这一层**：声明不允许当前标签的层时不画控件，写“只能在用户设置里改”或“只能在本作品里设置”。设置窗口的通用列表不列这样的项，页面作者让分区的 `layers` 与页面里的项一致时也不会出现。
- **停用**：见“交互”最后两条。
- 加载、空数据：没有；配置服务的读取是同步的。

## 不支持

- 不选控件：控件由调用方放进插槽，通用列表的选法在设置窗口里。
- 不发通知、不弹确认：写入失败交给调用方。
- 不显示层无效的原因与文件路径：那是设置窗口在分区顶部的一行说明。

## 注意事项

- 已修改竖线画在行左边 `--space-5` 处、行盒子之外：放行的容器左边要留出不少于这么多的内边距，否则竖线越界或被裁。设置窗口的内容列留了；`fill` 页面自己分栏时注意。
- 写入经 `settings` 发出，`settings` 是调用方经属性传入、可替换的入口，不是组件自己伸出去的通道；页面传自己插件的配置服务时，它只能写自己插件声明的项（[`settings.configuration`](../../../../../docs/specs/settings/configuration.md) 输出 11）。
- 控件改值后要写进与 `layer` 相同的层（`update(setting, value, {layer})`），否则“已修改”与控件显示的值对不上。
