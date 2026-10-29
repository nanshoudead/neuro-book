/** nb-markdown 自带的英文目录；键与中文目录（源语言）一一对应，写法见同目录的 `index.ts` 与 `zh-CN.ts`。 */

import type {Catalog} from "@notnotype/nb-ui/text";

export default {
    chip: {
        reference: "Reference: {{label}}",
        skill: "Skill: {{name}}",
        selection: "Selection: {{label}}",
        command: "Command: /{{name}}",
        image: "Image #{{number}}",
        file: "File #{{number}}: {{name}}",
        paste: "Pasted text #{{number}}",
        uploading: "{{label}}, uploading",
        failed: "{{label}}, upload failed: {{error}}",
    },
    image: {
        image: "Image",
        none: "{{name}} (not shown)",
        failed: "Cannot read {{name}}",
    },
    htmlEmbed: {
        render: "Render",
        viewSource: "View Source",
        caption: "HTML",
    },
    prompt: {
        menuLoading: "Loading",
        menuEmpty: "No matches",
        historyTitle: "Input history",
        historySearch: "Search sent messages",
        historyEmpty: "Nothing sent yet",
        historyNoMatch: "No matching messages",
        tokenImage: "Image #{{number}}",
        tokenFile: "File #{{number}}: {{name}}",
        pasteTitle: "Pasted text",
        lines: "{{count}} lines",
        pasteExpand: "Expand",
        pasteCollapse: "Collapse",
        pasteToText: "Convert to text",
        pasteRemove: "Delete",
        pasteEdit: "Edit pasted text #{{number}}",
        pasteInvalidClose: "A line can't be exactly {{tag}}; this change wasn't applied",
        attachmentLabel: "Attachments",
        attachmentRemove: "Remove",
        attachmentRetry: "Retry",
        attachmentUploading: "Uploading",
        attachmentFailed: "Upload failed: {{error}}",
    },
} satisfies Catalog;
