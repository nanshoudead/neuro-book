---
标签: [state:local, state:inject, env:portal, io:read]
验证入口: AgentConversationView
---

# OriginalImagePreviewDialog

共享原图预览对话框：按受控的开合状态加载并显示完整图片，提供关闭、失败重试与下载原件入口。它把缩略图列表里的原图读取延后到用户打开预览时，避免缩略图浏览提前加载原图。

## 布局与交互

对话框是一张贴着图片的卡片，不是固定尺寸的大框：

- **头部**一行：标题是 `alt`（过长截断，悬停看全文），右侧是“下载原图”与“关闭”两个图标按钮。没有页脚。
- **图片**按原始尺寸显示，不放大；超出可用空间时等比缩小，整张收进卡片，不留上下或左右的空边。可用空间是浮层宿主扣掉四周 16px 与卡片自身的头部、留白，宿主大小变化（窗口缩放、Lab 画布拖动）时重新计算。图片圆角，底下垫一层浅底，透明图片的空白处看得出边界。
- **加载中**：图片尺寸未知时卡片先占 320×200（放不下时收窄），中间转圈；加载完成后换成图片的尺寸。
- **失败**：同样大小的区域里显示图标、“原图加载失败”与“重试”按钮。重试会给同一 `src` 增加 `previewRetry` 查询参数以绕开浏览器缓存。
- 下载链接始终指向原始 `src`。关闭（按钮、Escape、点击遮罩）只请求父级把 `modelValue` 设为 `false`；底层 nb-ui `Dialog` 管理模态焦点、Escape、遮罩关闭与焦点归还。
- `390×844` 下卡片收窄到宿主宽度减去两侧 16px，图片随之缩小。

本文不承诺 nb-ui Dialog 之外的浏览器图片加载时序。

## 数据

```ts
interface OriginalImagePreviewDialogProps {
    /** 是否打开；必填、受控。 */
    modelValue: boolean;
    /** 图片读取地址；必填。打开时由浏览器读取该资源。 */
    src: string;
    /** 图片替代文字，同时是对话框标题。必填。 */
    alt: string;
    /** 下载保存名称；可选，默认不指定名称。 */
    downloadName?: string;
    /** 浮层传送到的目标；默认 "body"，传 false 就地渲染。对话视图传自己的 teleportTarget。 */
    teleportTarget?: string | false;
}

interface OriginalImagePreviewDialogEmits {
    /** Dialog 请求开合状态变化时发出；父级负责回写受控值。 */
    (e: "update:modelValue", value: boolean): void;
}

type OriginalImagePreviewDialogSlots = {};
```

组件不向调用方透出插槽；Dialog 内部默认 body slot 未被本组件接线。组件不 expose 方法或属性；不承诺未声明 attrs 的稳定透传位置。

## 状态与边界

- 默认：`modelValue` 为 `false` 时不挂载图片，不发起图片读取。
- 加载中、成功、失败：状态保存在组件实例内；`modelValue` 或 `src` 改变时重置为加载中。
- 禁用、只读、空数据：没有统一 disabled/readonly 状态；空 `src` 不渲染图片，但对话框仍可打开并显示其加载状态。`alt` 是必填输入。
- 错误：错误态保留到重试、`src` 或开合状态变化；重试不会改写父级的 `src`。

不支持缩放、平移、裁剪、图片编辑或为调用方发起下载请求；下载通过原生链接交给浏览器。`src` 是资源地址而非预取结果，打开对话框和点击下载都会由浏览器读取该地址。

## 上游边界

nb-ui `Dialog` 提供模态语义、Portal、焦点陷阱、Escape/遮罩关闭和生命周期；本组件承诺图片预览区域、加载错误与重试、原图下载链接以及上述 props/emits。其余 Dialog 行为按 nb-ui 契约，未在此重复承诺。

## 隐藏通道理由

- `io:read`：打开时渲染带 `src` 的 `<img>`，由浏览器直接读取图片资源；下载链接也指向同一资源。预览读取与该组件的职责绑定，调用方只提供地址，不替代浏览器的图像解码与预览行为。
- `env:portal`：nb-ui Dialog 把模态层传送到 `teleportTarget`（默认 `body`），使预览脱离消息流的裁剪上下文；目标不存在时 Dialog 按自身实现回退到 `body`。
- `state:inject`：经 `useAgentText()` 取宿主交出的语言，关闭、下载、加载中、加载失败与重试的文案跟随它；这些文案不逐项作为 props 暴露。
- `state:local`：持有图片加载状态、重试计数与按可用空间算出的显示尺寸，关闭或卸载后不保留。显示尺寸要读浮层宿主（`Dialog` 面板的父元素）的大小，并用 `ResizeObserver` 跟随它变化；纯 CSS 做不到既按宿主高度等比缩小、又让卡片贴着图片。

