---
标签: [state:inject]
别名: ["粘贴块外框", "Paste Frame"]
---

# PromptPasteFrame

粘贴块的样子：头部一行加等宽字的内容，超过 3 行时默认只露出前 3 行。`PromptEditor` 的节点视图 [`PromptPasteBlockView`](PromptPasteBlockView.md) 与已发送消息的静态显示 [`PromptTextView`](PromptTextView.md) 共用它；编辑器往里放可编辑的文本框和“转为文字”“删除”按钮，静态显示只用它自带的预览。

## 布局与交互

- 独占一段、与外层同宽，圆角描边、浅底。头部一行：图标、`#N`、“粘贴的文本 · 42 行”，右端是“展开/收起”与调用方放进来的按钮。
- 内容超过 3 行时可折叠：收起时只显示前 3 行，底部渐隐，点击这段预览或“展开”展开；不超过 3 行的没有“展开”。展开与否是受控值，由调用方保存。
- 完整显示时（展开，或本来不超过 3 行），调用方可以用 `body` 插槽换掉自带的预览，例如编辑器的文本框；插槽里带 `prompt-paste__body` 类的元素与预览同样的字体与间距，看上去仍是同一块。
- 焦点在块内时描边换成强调色；`highlighted` 时加一圈光晕（与同号的位置标记联动）；`selected` 时画成选中样子；`invalid` 时描边换成危险色。
- 整块文字不可选中，插槽里的文本框除外。鼠标进出发出 `hover`。

## 数据

```ts
interface PromptPasteFrameProps {
    /** 必填。 */
    number: number;
    /** 必填：粘贴的内容，按 `\n` 计行数并生成预览。 */
    content: string;
    /** 受控，默认 false；没有超过 3 行时不起作用。 */
    expanded?: boolean;
    /** 默认 false。 */
    highlighted?: boolean;
    /** 默认 false。 */
    selected?: boolean;
    /** 默认 false。 */
    invalid?: boolean;
}

interface PromptPasteFrameEmits {
    (e: "update:expanded", expanded: boolean): void;
    (e: "hover", active: boolean): void;
}

interface PromptPasteFrameSlots {
    /** 头部“展开”之后的按钮。 */
    actions(): unknown;
    /** 内容完整显示时替换自带的预览；收起时不渲染。 */
    body(): unknown;
}
```

没有 expose。未声明的 attribute 落到根元素上。“展开”按钮带 `data-prompt-paste-action="expand"`。

## 隐藏通道理由

- `state:inject`：界面文字读注入的翻译端口（nb-ui 的 `TEXT_PORT_KEY`）：在根组件（`PromptEditor`、`PromptTextView`）里拿到根提供的同一个端口；单独挂载、上面也没有注入时用包内的缺省端口，语言 zh-CN（[README](../../README.md#界面文字)）。这条通道属于组件本身：文字是零件自己画的，翻译端口是整棵子树共用的环境，经属性逐层传语言会让每个调用方（包括 `render()` 挂到普通 DOM 上的位置）各传一份。
