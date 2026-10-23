/**
 * PromptEditor 与 PromptTextView 界面上的文字（docs/specs/ui/prompt-editor.md 输出 12）：按宿主给的 `locale` 取，切换语言时随之
 * 换文字。小块自己的悬停提示在 `../chip/chip.ts`。
 */

import {say} from "../locale";
import type {MarkdownLocale, MarkdownText} from "../locale";

export const PROMPT_TEXT = {
    menuLoading: {"zh-CN": "正在加载", "en-US": "Loading"},
    menuEmpty: {"zh-CN": "没有匹配项", "en-US": "No matches"},
    historyTitle: {"zh-CN": "输入历史", "en-US": "Input history"},
    historySearch: {"zh-CN": "搜索已发送的内容", "en-US": "Search sent messages"},
    historyEmpty: {"zh-CN": "没有已发送的内容", "en-US": "Nothing sent yet"},
    historyNoMatch: {"zh-CN": "没有匹配的内容", "en-US": "No matching messages"},
    tokenImage: {"zh-CN": "图片 #{number}", "en-US": "Image #{number}"},
    tokenFile: {"zh-CN": "文件 #{number}：{name}", "en-US": "File #{number}: {name}"},
    pasteTitle: {"zh-CN": "粘贴的文本", "en-US": "Pasted text"},
    lines: {"zh-CN": "{count} 行", "en-US": "{count} lines"},
    pasteExpand: {"zh-CN": "展开", "en-US": "Expand"},
    pasteCollapse: {"zh-CN": "收起", "en-US": "Collapse"},
    pasteToText: {"zh-CN": "转为文字", "en-US": "Convert to text"},
    pasteRemove: {"zh-CN": "删除", "en-US": "Delete"},
    pasteEdit: {"zh-CN": "编辑粘贴的文本 #{number}", "en-US": "Edit pasted text #{number}"},
    pasteInvalidClose: {"zh-CN": "不能有恰好是 {tag} 的一行，这次修改没有生效", "en-US": "A line can't be exactly {tag}; this change wasn't applied"},
    attachmentLabel: {"zh-CN": "附件", "en-US": "Attachments"},
    attachmentRemove: {"zh-CN": "移除", "en-US": "Remove"},
    attachmentRetry: {"zh-CN": "重试", "en-US": "Retry"},
    attachmentUploading: {"zh-CN": "正在上传", "en-US": "Uploading"},
    attachmentFailed: {"zh-CN": "上传失败：{error}", "en-US": "Upload failed: {error}"},
} as const satisfies Record<string, MarkdownText>;

export type PromptTextKey = keyof typeof PROMPT_TEXT;

/** 取一条文字，代入 `{名称}` 占位。 */
export function promptText(locale: MarkdownLocale, key: PromptTextKey, params?: Readonly<Record<string, string | number>>): string {
    return say(PROMPT_TEXT[key], locale, params);
}
