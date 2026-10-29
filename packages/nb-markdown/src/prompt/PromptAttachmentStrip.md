---
标签: [state:inject]
别名: ["附件条", "Attachment Strip"]
---

# PromptAttachmentStrip

`PromptEditor` 上方的附件条：正文里每个图片与文件附件一张卡片，按在正文里出现的顺序排成一行，放不下时横向滚动。卡片角上的 `#N` 与正文里的小块对应，悬停或聚焦卡片时与同号的小块互相高亮。它只负责画与发出操作，卡片从哪来、删除后正文怎么变由编辑器决定；已发送消息的静态显示 [`PromptTextView`](PromptTextView.md) 也用它（只读）。

## 布局与交互

- 卡片高 48px。图片卡片是方形缩略图，取不到缩略图时显示占位图标；文件卡片是图标、文件名与大小；大段粘贴转成的文件卡片显示前两行文字（等宽字）与行数。
- 每张卡片角上标 `#N`。上传中的卡片盖一层转圈；失败的卡片用危险色描边，可访问描述给出失败原因，带“重试”。
- 描边画在缩略图之上，缩略图铺满卡片并按圆角裁切；悬停、键盘聚焦或与正文小块联动时，描边换成一层 2px 的强调色（失败的卡片是危险色）。
- “移除”“重试”在卡片右上角内，不伸出卡片；悬停、键盘聚焦与失败时显示，触屏上常显。只读时没有这两个按钮。
- 点击卡片发出 `activate`（预览）；“移除”“重试”各自发出事件，不触发 `activate`。

## 数据

```ts
type PromptAttachmentCard = {
    /** 列表内唯一。 */
    id: string;
    /** 与正文小块联动的键，同号的小块与卡片共用。 */
    hoverKey: string;
    kind: "image" | "file";
    number: number;
    name: string;
    state: "uploading" | "failed" | "ready";
    /** state 为 failed 时的原因。 */
    error?: string;
    /** 图片缩略图地址；缺省或 null 时显示占位图标。 */
    thumbnail?: string | null;
    /** 文件大小（字节）；未知时不显示。 */
    size?: number | null;
    /** 大段粘贴转成的文件：前两行与总行数。 */
    excerpt?: {preview: string; lines: number} | null;
};

interface PromptAttachmentStripProps {
    /** 必填；为空时不渲染任何内容。 */
    cards: readonly PromptAttachmentCard[];
    /** 需要高亮的联动键；默认 null。 */
    highlighted?: string | null;
    /** 默认 false。 */
    readonly?: boolean;
}

interface PromptAttachmentStripEmits {
    (e: "activate", id: string): void;
    (e: "remove", id: string): void;
    (e: "retry", id: string): void;
    /** 悬停或聚焦卡片时发出它的联动键，离开时发出 null。 */
    (e: "hover", key: string | null): void;
}
```

没有 slot 与 expose。未声明的 attribute 落到附件条根元素上。

## 隐藏通道理由

- `state:inject`：界面文字读注入的翻译端口（nb-ui 的 `TEXT_PORT_KEY`）：在根组件（`PromptEditor`）里拿到根提供的同一个端口；单独挂载、上面也没有注入时用缺省端口，语言 zh-CN（[README](../../README.md#界面文字)）。这条通道属于组件本身：文字是零件自己画的，翻译端口是整棵子树共用的环境，经属性逐层传语言会让每个调用方（包括 `render()` 挂到普通 DOM 上的位置）各传一份。
