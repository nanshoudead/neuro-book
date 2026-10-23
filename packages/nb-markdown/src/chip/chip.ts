/**
 * 小块长什么样（`InlineChip.md` 是外观合同）：哪种小块用什么图标、色调、文字与悬停提示。`InlineChip.vue`、编辑器里链接的装饰与
 * 展示器的静态视图都从这里取，所以三处的小块一样。引用的目标怎样归类、文件取什么图标由宿主给（`ChipEnv`）。
 */

import {say} from "../locale";
import type {MarkdownLocale, MarkdownText} from "../locale";
import {schemeTargets} from "../targets";
import type {MarkdownTargets, TargetKind} from "../targets";
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
    readonly locale: MarkdownLocale;
}

/** 图标：图标类（Tailwind 的 lucide 图标类），或宿主画的元素（例如按文件名取的文件图标）。 */
export type ChipIcon = {readonly className: string} | {readonly render: (document: Document) => Element};

/** 宿主给小块的两样东西：引用的目标分类，与文件的图标。 */
export interface ChipEnv {
    readonly targets: MarkdownTargets;
    fileIcon(name: string): ChipIcon;
}

/** 不认任何文件方案的宿主：只分外部链接与其它，文件图标是通用的文件图标。 */
export const defaultChipEnv: ChipEnv = {targets: schemeTargets, fileIcon: () => ({className: "i-lucide-file"})};

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
} satisfies Record<string, MarkdownText>;

/** 引用按目标分类取图标（输出 27）：文件的图标由宿主按文件名取。 */
const REFERENCE_ICONS: Readonly<Record<Exclude<TargetKind, "file">, string>> = {
    attachment: "i-lucide-paperclip",
    external: "i-lucide-globe",
    other: "i-lucide-link",
};

export function chipView(input: ChipInput, env: ChipEnv = defaultChipEnv): ChipView {
    const words = (key: keyof typeof TEXT, values: Readonly<Record<string, string>>): string => say(TEXT[key], input.locale, values);
    const number = String(input.number ?? 0);
    const attachment = (className: string, label: string): ChipView => {
        const text = `#${number}`;
        if (input.state === "failed") return {icon: {className: "i-lucide-triangle-alert"}, text, title: words("failed", {label, error: input.error}), tone: "nb-chip--failed", busy: false};
        if (input.state === "uploading") return {icon: {className}, text, title: words("uploading", {label}), tone: "nb-chip--attachment", busy: true};
        return {icon: {className}, text, title: label, tone: "nb-chip--attachment", busy: false};
    };
    switch (input.kind) {
        case "reference": {
            const target = env.targets.classify(input.target, input.base);
            const icon: ChipIcon = target.kind === "file" ? env.fileIcon(target.name) : {className: REFERENCE_ICONS[target.kind]};
            const label = input.target === "" ? input.label : `${input.label} · ${input.target}`;
            return {icon, text: input.label, title: words("reference", {label}), tone: `nb-chip--reference nb-chip--${target.variant ?? target.kind}`, busy: false};
        }
        case "selection":
            return {icon: {className: "i-lucide-text-select"}, text: input.label, title: words("selection", {label: input.label}), tone: "nb-chip--selection", busy: false};
        case "skill":
            return {icon: {className: "i-lucide-sparkles"}, text: input.label, title: words("skill", {name: input.label}), tone: "nb-chip--skill", busy: false};
        case "command":
            return {icon: {className: "i-lucide-square-slash"}, text: input.label, title: words("command", {name: input.label}), tone: "nb-chip--command", busy: false};
        case "image":
            return attachment("i-lucide-image", words("image", {number}));
        case "file":
            return attachment("i-lucide-file-text", words("file", {number, name: input.label}));
        case "paste":
            return {icon: {className: "i-lucide-clipboard-paste"}, text: `#${number}`, title: words("paste", {number}), tone: "nb-chip--paste", busy: false};
    }
}

/** 普通 DOM 的图标（编辑器的装饰、展示器的静态视图）：与 `InlineChip.vue` 画出的相同。 */
export function renderChipIcon(document: Document, icon: ChipIcon, busy = false): Element {
    if ("render" in icon && !busy) {
        const element = icon.render(document);
        element.classList.add("nb-chip__icon");
        return element;
    }
    const span = document.createElement("span");
    span.className = `nb-chip__icon ${busy ? "nb-chip__spinner i-lucide-loader-circle" : (icon as {className: string}).className}`;
    span.setAttribute("aria-hidden", "true");
    return span;
}
