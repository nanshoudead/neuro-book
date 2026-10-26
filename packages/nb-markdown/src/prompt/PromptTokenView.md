---
标签: [state:inject]
验证入口: PromptEditor
别名: ["提示词小块", "Prompt Token"]
---

# PromptTokenView

`PromptEditor` 正文里一枚行内小块的样子：引用、技能、选区、命令、图片 `#N`、文件 `#N`、粘贴位置标记 `#N`，以及还没上传完的图片或文件（转圈或失败）。它是 ProseMirror 节点视图，props 由编辑器内核给出（节点属性与编辑器扩展选项里的状态），离开 `PromptEditor` 没有可验证的状态，所以在 `PromptEditor` 的 Lab 场景里看。

外观由纯展示零件 [`InlineChip`](../chip/InlineChip.md) 画，已发送消息的静态显示用的是同一个零件；本组件只把节点属性与编辑器状态换成它的输入，并把点击、悬停交回编辑器。

## 布局与交互

- 与正文同一行高的行内块，名称过长时截断，悬停提示与可访问名称给出全称。引用按目标类型取图标与色调（与引用小块共用一套），图片、文件、位置标记只显示图标加 `#N`。
- 上传中的附件显示转圈；失败的用危险色，悬停提示带失败原因。
- 点击发出编辑器的 `token-activate`；还没上传完的附件 `target` 为 null。
- 悬停时与附件条里同号的卡片互相高亮。

## 数据

节点属性见 `prompt-text.ts` 的 `PromptTokenAttrs`（小块）与 `PromptPendingAttrs`（未就绪附件）；编辑器状态见 `prompt-editor-extensions.ts` 的 `PromptNodeContext`，经扩展选项 `context` 传入。没有 slot、emit 与 expose。
