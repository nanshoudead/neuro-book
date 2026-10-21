/**
 * 小块长什么样（`../components/InlineChip.md` 是外观合同）：哪种小块用什么图标、色调、文字与悬停提示。`InlineChip.vue`、编辑器里链接的装饰与
 * 展示器的静态视图都从这里取，所以三处的小块一样。
 */

import {fileIconForName} from "nbook/ui/file-icons/file-icons";
import type {CatppuccinIcon} from "nbook/ui/file-icons/catppuccin";
import {renderFileIcon} from "nbook/ui/file-icons/render";
import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import {classifyTarget} from "../../shared/targets";
import type {TargetKind} from "../../shared/targets";
import "./chip.css";

export type InlineChipKind = "reference" | "skill" | "selection" | "command" | "image" | "file" | "paste";

export interface ChipInput {
    readonly kind: InlineChipKind;
    readonly label: string;
    readonly target: string;
    /** 目标所在文件的地址（编辑器里的文档）；没有时为 null。 */
    readonly base: string | null;
    readonly number: number | null;
    readonly state: "ready" | "uploading" | "failed";
    readonly error: string;
    readonly locale: DisplayLocale;
}

/** 图标：文件图标（catppuccin，按文件名取）或图标类（Tailwind 的 lucide 图标类）。 */
export type ChipIcon = {readonly file: CatppuccinIcon} | {readonly className: string};

export interface ChipView {
    readonly icon: ChipIcon;
    readonly text: string;
    readonly title: string;
    /** 色调类名，加在 `nb-chip` 上。 */
    readonly tone: string;
    readonly busy: boolean;
}

const TEXT = {
    reference: {"zh-CN": "引用：{label}", "en-US": "Reference: {label}"},
    skill: {"zh-CN": "技能：{name}", "en-US": "Skill: {name}"},
    selection: {"zh-CN": "选区：{label}", "en-US": "Selection: {label}"},
    command: {"zh-CN": "命令：/{name}", "en-US": "Command: /{name}"},
    image: {"zh-CN": "图片 #{number}", "en-US": "Image #{number}"},
    file: {"zh-CN": "文件 #{number}：{name}", "en-US": "File #{number}: {name}"},
    paste: {"zh-CN": "粘贴的文本 #{number}", "en-US": "Pasted text #{number}"},
    uploading: {"zh-CN": "{label}，正在上传", "en-US": "{label}, uploading"},
    failed: {"zh-CN": "{label}，上传失败：{error}", "en-US": "{label}, upload failed: {error}"},
} satisfies Record<string, LocalizedText>;

/** 引用按目标分类取图标（输出 27）：作品里的文件与用户资产按扩展名取文件图标。 */
const REFERENCE_ICONS: Readonly<Record<Exclude<TargetKind, "work" | "user">, string>> = {
    attachment: "i-lucide-paperclip",
    external: "i-lucide-globe",
    other: "i-lucide-link",
};

export function chipView(input: ChipInput): ChipView {
    const say = (key: keyof typeof TEXT, values: Readonly<Record<string, string>>): string => localize(formatText(TEXT[key], values), input.locale);
    const number = String(input.number ?? 0);
    const attachment = (className: string, label: string): ChipView => {
        const text = `#${number}`;
        if (input.state === "failed") return {icon: {className: "i-lucide-triangle-alert"}, text, title: say("failed", {label, error: input.error}), tone: "nb-chip--failed", busy: false};
        if (input.state === "uploading") return {icon: {className}, text, title: say("uploading", {label}), tone: "nb-chip--attachment", busy: true};
        return {icon: {className}, text, title: label, tone: "nb-chip--attachment", busy: false};
    };
    switch (input.kind) {
        case "reference": {
            const target = classifyTarget(input.target, input.base);
            const icon: ChipIcon = target.kind === "work" || target.kind === "user" ? {file: fileIconForName(target.name)} : {className: REFERENCE_ICONS[target.kind]};
            const label = input.target === "" ? input.label : `${input.label} · ${input.target}`;
            return {icon, text: input.label, title: say("reference", {label}), tone: `nb-chip--reference nb-chip--${target.kind}`, busy: false};
        }
        case "selection":
            return {icon: {className: "i-lucide-text-select"}, text: input.label, title: say("selection", {label: input.label}), tone: "nb-chip--selection", busy: false};
        case "skill":
            return {icon: {className: "i-lucide-sparkles"}, text: input.label, title: say("skill", {name: input.label}), tone: "nb-chip--skill", busy: false};
        case "command":
            return {icon: {className: "i-lucide-square-slash"}, text: input.label, title: say("command", {name: input.label}), tone: "nb-chip--command", busy: false};
        case "image":
            return attachment("i-lucide-image", say("image", {number}));
        case "file":
            return attachment("i-lucide-file-text", say("file", {number, name: input.label}));
        case "paste":
            return {icon: {className: "i-lucide-clipboard-paste"}, text: `#${number}`, title: say("paste", {number}), tone: "nb-chip--paste", busy: false};
    }
}

/** 普通 DOM 的图标（编辑器的装饰、展示器的静态视图）：与 `InlineChip.vue` 画出的相同。 */
export function renderChipIcon(document: Document, icon: ChipIcon, busy = false): Element {
    if ("file" in icon && !busy) {
        const svg = renderFileIcon(document, icon.file);
        svg.classList.add("nb-chip__icon");
        return svg;
    }
    const span = document.createElement("span");
    span.className = `nb-chip__icon ${busy ? "nb-chip__spinner i-lucide-loader-circle" : (icon as {className: string}).className}`;
    span.setAttribute("aria-hidden", "true");
    return span;
}
