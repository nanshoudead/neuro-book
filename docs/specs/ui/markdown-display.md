---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: ui.markdown-display
owners:
  - nbook.markdown
---

# Markdown 展示器

## 目标与非目标

把一段 Markdown 显示成只读的排版结果，按 NeuroBook 的方言读，外观与 Markdown 编辑器一致；给 Agent 的流式输出用，长对话里也要快。组件是 `MarkdownDisplay`，经 `nbook.markdown` 的服务 `markdownKey` 交出（[workspace.markdown-syntaxes](../workspace/markdown-syntaxes.md)）。

不承诺：

- 编辑、选区菜单、复制按钮、代码高亮、目录。
- 打开引用、预览图片这类动作本身：展示器只发出 `activate`，宿主决定做什么（输出 5）。
- 对话列表的虚拟滚动与消息的分组，归使用它的对话视图。

## 术语与参与者

- **宿主**：挂上展示器的界面（以后的 Agent 对话视图；本轮是 Lab 场景）。
- **块**：顶层块，含义同 [workspace.markdown-dialect](../workspace/markdown-dialect.md) 的“块”。
- **静态视图**：内置方言里需要专门样子的节点（提示块、可渲染 HTML、图片）在展示器里的样子，由 `nbook.markdown` 自己持有，与编辑器里的节点视图共用同一套外观函数（输出 2）。外来方言没有静态视图，节点按 schema 的 `renderHTML` 显示。

## 输入与前置条件

```ts
interface MarkdownDisplayProps {
    /** 必填：Markdown 原文。 */
    text: string;
    /** 正在流式生成；为真时在末尾显示光标。默认 false。 */
    streaming?: boolean;
    /** 界面语言，决定按钮与说明的文字。必填。 */
    locale: DisplayLocale;
    /** 图片地址到可显示地址的换算；省略时图片显示说明文字。 */
    resolveAsset?: (address: string, signal: AbortSignal) => Promise<{url: string; release(): void} | null>;
}

type MarkdownDisplayActivation =
    | {kind: "reference"; target: string}
    | {kind: "link"; href: string}
    | {kind: "image"; address: string};

interface MarkdownDisplayEmits {
    (e: "activate", activation: MarkdownDisplayActivation): void;
}
```

图片地址的解析规则见 [workspace.markdown-dialect](../workspace/markdown-dialect.md) 输出 18；展示器没有“当前文件”，相对地址交给 `resolveAsset` 时原样传出，由宿主决定按什么解析。

## 输出与可观察行为

1. **语言**：挂上时取当时的语言（[workspace.markdown-syntaxes](../workspace/markdown-syntaxes.md) 输出 7），直到卸载都用这一份。读法与编辑器相同：不认识的写法原样显示源码，读不出的块不会让整条消息失败。
2. **外观与编辑器一致**：同一份 Markdown，展示器与 Markdown 编辑器生成的方言元素结构与类名相同（不计编辑器自带的可编辑属性、`ProseMirror-*` 类名与占位元素），共用同一份样式。提示块、可渲染 HTML、图片的样子由与编辑器同一套外观函数画出；外来方言的节点按 schema 的 `renderHTML` 显示，与编辑器里没有节点视图时相同。
3. **引用小块**：除外部链接以外的链接都显示为引用小块（[`InlineChip`](../../../packages/neuro-book/src/plugins/markdown/web/components/InlineChip.md)），按目标分类取图标（[workspace.markdown-dialect](../workspace/markdown-dialect.md) 输出 27：作品里的文件与用户资产按扩展名取，其它不带文件图标）；一个链接只显示一个小块，被批注盖住一部分时也是；外部链接显示为普通链接。展示器没有所在文件，相对地址归为“其它”。
4. **图片**：按 [`MarkdownImage`](../../../packages/neuro-book/src/plugins/markdown/web/components/MarkdownImage.md) 显示：`resolveAsset` 返回 null 或省略时显示说明文字；读取中显示占位。
5. **交互**：点击引用小块发出 `{kind: "reference"}`（`target` 是链接原文的地址），点击外部链接发出 `{kind: "link"}`（不由展示器自己跳转），点击图片发出 `{kind: "image"}`。文字可以选中复制。提示块的标题点了折叠或展开，状态只在这次显示里记，不写回原文。可渲染 HTML 默认是源码卡片，点“渲染”后在沙箱里显示，规则同编辑器（[workspace.markdown-dialect](../workspace/markdown-dialect.md) 输出 16）。
6. **流式更新**：`text` 变了，下一帧重新读入并比较块：头尾相同的块保留原来的页面元素与交互状态（折叠、已渲染的 HTML），只替换中间变了的块；比较时不看每次读入都重新生成的内存身份（例如批注的 `key`）。后面的内容改变了前面块的含义时（例如新出现的引用定义），前面那块也替换。同一帧里多次改变 `text` 只读入最后一次；一次读入超过 8 毫秒时（长回复），下一次读入至少隔同样长，流式时不占满主线程。
7. **流式光标**：`streaming` 为真时，最后一块的末尾显示一个闪烁的光标；用户要求减少动效时不闪。
8. **释放**：块被替换或展示器卸载时，释放它的监听、沙箱与图片（调用 `resolveAsset` 返回的 `release`）；读取中的图片取消读取，迟到的结果丢弃。
9. **长对话的性能**：根元素带 `content-visibility: auto` 与按上次显示高度的 `contain-intrinsic-size`，看不见的消息不参与排版。

## 状态与转换

- **挂上**：读入 `text` 显示；语言还在加载时显示空白占位，加载完成后显示。
- **流式中**：按输出 6 更新；`streaming` 由真变假时去掉光标，不重新读入。
- **卸载**：按输出 8 释放。

时序与寿命：

- `activate` 只在挂上期间发出；卸载后不再发出。
- `resolveAsset` 对同一块的同一图片只调用一次，块被保留时不重新调用；返回的 `release` 在块被替换、地址改变或卸载时各调用一次。

## 副作用与数据

不写任何数据。折叠与渲染状态只在内存里，随卸载消失。

## 失败与恢复

| 情形 | 表现 |
|---|---|
| 组件代码加载失败、组不成语言 | 按纯文字显示原文，记诊断（`markdown.component.load-failed`、`markdown.display.failed`） |
| 某一块画不出来（外来方言的 `renderHTML` 出错） | 这一块按它的文字显示，记诊断（`markdown.display.block-failed`），别的块与之后的更新照常 |
| 图片读取失败 | 显示说明文字与失败的样子 |
| 可渲染 HTML 的沙箱出错 | 只影响那一块 |

## 边界与兼容

- 公开接口：`MarkdownDisplay` 的属性与事件。
- 原文是不可信内容：可渲染 HTML 只在沙箱里运行，其余 HTML 原样显示为源码，不插入页面。

## 验收与 Smoke

1. Given 一条开头有批注与一个折叠提示块的回复，When 每 50 毫秒追加一段文字直到结束，Then 批注与提示块的元素始终是同一个、提示块保持折叠，结束后去掉光标。
2. Given Lab 里 100 条回复的长对话，When 在本机 Chrome 拖动改变宽度，Then 每次改宽度的布局耗时中位数在 5 毫秒以内（宽度在两个值之间来回改 40 次，每次改完强制布局计时）。
3. Given 同一份含全部方言的语料，When 分别用展示器与编辑器显示，Then 方言元素的结构与类名按输出 2 的规则一致。
4. Given 一条含已渲染 `<html>` 块的回复，When 流式更新替换掉它、再卸载展示器，Then 页面上不再有它的监听与沙箱，图片的地址都已释放。

Smoke：`packages/neuro-book/src/plugins/markdown/web/components/MarkdownDisplay.dom.test.ts` 运行场景 1、3、4 与输出 5、6；场景 1、2 在本机 Chrome 上由 `packages/neuro-book/e2e/lab-markdown.e2e.ts` 运行（Lab 场景 `MarkdownDisplay` 的 `streaming`、`conversation`）。

## 实现合同

- 公开入口：服务 `markdownKey` 交出的 `components.MarkdownDisplay`；属性、事件与布局见组件文档 [`MarkdownDisplay.md`](../../../packages/neuro-book/src/plugins/markdown/web/components/MarkdownDisplay.md)。
- owner 与依赖方向：`nbook.markdown` 拥有。展示器用与编辑器同一份语言、编解码器与外观（提示块、可渲染 HTML、引用小块的构建函数与 `.nb-markdown` 样式）；静态视图由插件持有，不经语法模块交出；诊断经插件交给组件的报告函数记录。不依赖编辑器区与 Tiptap 的编辑器实例。
- 不变量：
  - 流式更新按块比较，键是去掉批注身份属性后的节点内容；头尾相同的块保留原来的元素与折叠状态（`MarkdownDisplay.dom.test.ts` 的场景 1）；
  - 一次更新先生成全部新块再换下旧块；某一块画不出来时只这一块按文字显示，之后的更新照常（“失败与恢复”两例）；
  - 被换下的块与卸载时释放图片地址与 `<html>` 块的沙箱（场景 4）；
  - 每条消息 `content-visibility: auto`，看不见的消息不参与排版（`lab-markdown.e2e.ts` 的场景 2；去掉时中位数约 10 毫秒、失败）。

## 证据

- 批准依据：开发者 2026-10-16 的决定，记录在主工作区 master 的 `.agents/works/w00025-editor/tasks/t07-markdown-plugins/README.md`（“开发者的决定”1、3、4）与同目录的 `plan.md`、`evidences/display-perf.md`。
- 实现入口：[`MarkdownDisplay.vue`](../../../packages/neuro-book/src/plugins/markdown/web/components/MarkdownDisplay.vue)、[`display/renderer.ts`](../../../packages/neuro-book/src/plugins/markdown/web/display/renderer.ts)（按块生成与更新）、[`display/static-views.ts`](../../../packages/neuro-book/src/plugins/markdown/web/display/static-views.ts)（提示块、可渲染 HTML 与图片的静态视图）
- 合同测试：[`MarkdownDisplay.dom.test.ts`](../../../packages/neuro-book/src/plugins/markdown/web/components/MarkdownDisplay.dom.test.ts)（场景 1、3、4，输出 2、3、5–8 与“失败与恢复”）
- Smoke：[`lab-markdown.e2e.ts`](../../../packages/neuro-book/e2e/lab-markdown.e2e.ts)（场景 1、2，本机 Chrome）
