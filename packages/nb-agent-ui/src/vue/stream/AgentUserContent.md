---
标签: [state:inject]
别名: ["用户消息正文", "User Content"]
---

# Agent 用户消息正文

一条用户消息的内容：按原顺序显示文字块与附件，正文只公开了预览时在末尾注明“仅显示预览”。用在分轮视图的用户气泡、steer 补充说明与原始视图里；外面的气泡、边框和投递状态由调用方负责。

文字块按输入框的“文字写法”显示（见 [`ui/prompt-editor.md`](../../../../../docs/specs/ui/prompt-editor.md)），与用户在输入框里看到的一致：引用、技能、选区是标签，图片与文件进文字块上方的附件条、正文留 `#N`，粘贴块默认折叠。显示由宿主注入的已发送文字显示组件完成（形状见核心的 `ports.ts`，neuro-book 注入 `nbook.markdown` 的 `PromptTextView`），不挂编辑器；没有注入时按纯文字显示原文。

## 布局

- 每个文字块是一段注入的文字显示：附件条（有图片或文件标签时）在上，正文保留换行，长词可断开。多个文字块之间留一点间距。开头的 `/名称` 按普通文字显示：命令在发送时就已执行，不会作为消息出现。
- 文字之外的附件块（旧消息把图片与文件放在文字外面）沿用原来的显示，连续的排成一行，放不下时换行：
  - 图片（`mimeType` 以 `image/` 开头）是固定尺寸的缩略图，加载前后高度不变；地址为空时显示同尺寸的“不可用”占位，不发请求。
  - 其他附件是文件小标签：图标、文件名（过长截断，完整名称在悬停提示里）与大小。
- 正文只公开了预览（`contentOmitted`）时，末尾一行淡色“仅显示预览”。预览可能截在写法中间，截断的部分按普通文字显示。

## 交互

点击文字里的标签或附件条的卡片，以及文字外面的附件：

| 点击 | 结果 |
|---|---|
| 引用 | `action`：`reference.open {target}` |
| 选区 | `action`：`reference.open {target}`，`target` 为 `路径#L起-L止`，没有行号时只有路径 |
| 技能 | `action`：`skill.open {name}` |
| 文件 | `action`：`attachment.open {target}` |
| 图片 | `preview-image`，由对话视图打开原图预览 |
| 粘贴位置标记 | 不发事件，悬停时同号的粘贴块高亮 |

## 数据

```ts
import type {AgentViewAction, UserMessageView} from "@notnotype/nb-agent-ui";
import type {PreviewImageRequest} from "@notnotype/nb-agent-ui/vue";

type AgentUserContentProps = {
    /** 用户消息，必填；只读 blocks 与 contentOmitted。 */
    message: UserMessageView;
    /** 附件地址；返回 null 表示不可用。必填，对话视图传入 services.resolveAttachmentUrl。 */
    resolveAttachmentUrl: (locator: string, variant: "thumbnail" | "original") => string | null;
};

type AgentUserContentEmits = {
    (e: "action", action: AgentViewAction): void;
    /** 请对话视图打开图片原图；locator 是附件目标或附件块的 locator。 */
    (e: "preview-image", image: Extract<PreviewImageRequest, {locator: string}>): void;
};
```

没有插槽和 expose。未声明的 attribute、`class` 与 `style` 落到根节点。
