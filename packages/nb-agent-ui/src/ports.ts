/**
 * 宿主注入的渲染组件要满足的形状：提示词编辑器、已发送文字的静态显示、Markdown 显示。本包不引用宿主源码，这里按结构
 * 写出本包实际用到的属性、事件与外露方法，宿主的组件与它结构兼容即可。neuro-book 由 `nbook.markdown` 注入，那边有
 * 一份类型断言对照它的 `.vue` 源组件（`src/plugins/markdown/web/prompt-ports.typecheck.ts`）。
 *
 * 属性写成组件 `$props` 的形状，事件写成 `onX` 处理函数，这样“端口属性能赋给组件的 `$props`”就同时核对了属性、事件名
 * 与参数。文字写法（标签、附件、粘贴块怎样写进文字）见 docs/specs/ui/prompt-editor.md。
 */

export type PromptLocale = "zh-CN" | "en-US";

/** 宿主给的草稿：版本号变化时正文替换为 text；同一版本内 text 的变化是编辑器自己上报的回声。 */
export type PromptDraft = {
    text: string;
    version: number;
};

export type PromptMenuContext = {
    trigger: string;
    /** 触发字符后到光标为止的文字，不含空白。 */
    query: string;
    /** 触发字符位于正文最开头。 */
    atStart: boolean;
};

export type PromptMenuItem = {
    id: string;
    label: string;
    description?: string;
    iconClass?: string;
    group?: string;
    disabled?: boolean;
    insertText: string;
    continues?: boolean;
};

export type PromptMenu = {
    title?: string;
    items: PromptMenuItem[];
    loading?: boolean;
    emptyText?: string;
};

export type PromptAttachment =
    | {localId: string; state: "uploading"}
    | {localId: string; state: "failed"; error: string}
    | {localId: string; state: "ready"; target: string};

export type PromptAttachmentKind = "image" | "file";

export type PromptPastePolicy = {
    inlineMaxLines: number;
    inlineMaxChars: number;
    attachMinLines: number;
    attachMinChars: number;
    blockPlacement: "inline" | "start";
};

/** 被点击的标签。 */
export type PromptToken =
    | {kind: "reference"; label: string; target: string}
    | {kind: "skill"; name: string}
    | {kind: "selection"; path: string; startLine: number | null; endLine: number | null}
    | {kind: "command"; name: string}
    | {kind: "image"; number: number; target: string | null}
    | {kind: "file"; number: number; name: string; target: string | null}
    | {kind: "paste"; number: number};

export type PromptEditorPortProps = {
    draft: PromptDraft;
    locale: PromptLocale;
    placeholder?: string;
    ariaLabel?: string;
    readonly?: boolean;
    enterSubmits?: boolean;
    triggers?: readonly string[];
    resolveMenu?: (context: PromptMenuContext) => PromptMenu;
    commands?: readonly string[];
    acceptImages?: boolean;
    acceptFiles?: boolean;
    attachments?: readonly PromptAttachment[];
    resolveThumbnail?: (target: string) => string | null;
    pastePolicy?: Partial<PromptPastePolicy>;
    recall?: readonly string[];
    fill?: boolean;
    bare?: boolean;
    onChange?: (text: string) => void;
    onSubmit?: (payload: {mod: boolean}) => void;
    onEscape?: () => void;
    onShiftTab?: () => void;
    onMenuOpen?: (payload: {trigger: string}) => void;
    onTokenActivate?: (token: PromptToken) => void;
    onAttachmentAdd?: (payload: {localId: string; kind: PromptAttachmentKind; file: File}) => void;
    onAttachmentRetry?: (payload: {localId: string}) => void;
    onAttachmentRemove?: (payload: {localId: string}) => void;
    onAttachmentReject?: (payload: {kind: PromptAttachmentKind; count: number}) => void;
};

export interface PromptEditorPortExpose {
    focus(at?: "start" | "end"): void;
    insertText(text: string): void;
    insertFiles(files: readonly File[]): void;
}

export type PromptTextViewPortProps = {
    text: string;
    locale: PromptLocale;
    commands?: readonly string[];
    resolveThumbnail?: (target: string) => string | null;
    onTokenActivate?: (token: PromptToken) => void;
};

/** Markdown 里被点击的东西。 */
export type MarkdownActivation =
    | {kind: "reference"; target: string}
    | {kind: "link"; href: string}
    | {kind: "image"; address: string};

/** 图片地址到可显示地址的换算；返回的 `release` 在不再显示时调用。 */
export type MarkdownAssetResolver = (src: string, signal: AbortSignal) => Promise<{url: string; release(): void} | null>;

/**
 * 根元素要接受透传的 `style`：对话视图在上面写 `color` 与 `--markdown-font-size`，用来把思考、提醒显示成淡色小字。
 * 本包的缺省实现靠继承拿到这两样。
 */
export type MarkdownDisplayPortProps = {
    text: string;
    locale: PromptLocale;
    streaming?: boolean;
    resolveAsset?: MarkdownAssetResolver;
    onActivate?: (activation: MarkdownActivation) => void;
};
