/**
 * `nbook.editor` 对其它插件公开的合同（docs/specs/workbench/editor.md 的“输入与前置条件”）：文档协调服务，资源管理器
 * 在复制、移动、改名与删除前经它结算未保存的修改；页面贡献点 `editor.pages`（输出 33），欢迎页这类不对应文件的标签；编辑区标题的
 * 菜单位置 `editor.title`（输出 34）。其它插件在运行时只引用本文件。
 */

import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

import type {Ref} from "@vue/reactivity";
import type {Component} from "vue";

import type {ContributionDescriptor} from "@notnotype/nb-runtime/plugins";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import {MENU_BUTTON, MENU_EXTENSIONS, menuItemValidator, menuLocation} from "nbook/plugins/commands/shared/contracts";
import type {MenuItemDeclaration} from "nbook/plugins/commands/shared/contracts";
import {LocalizedTextSchema} from "nbook/shared/localized-text";
import type {LocalizedText} from "nbook/shared/localized-text";

/** 需要结算的文档此刻的状态：dirty、在保存、有未裁决输入、磁盘冲突。 */
export type SettleState = "dirty" | "saving" | "unresolved" | "conflict";

export interface AffectedDocument {
    readonly address: string;
    readonly state: SettleState;
}

/** 文件操作期间挡住受影响文档的新保存（保存排队、输入照常）。 */
export interface DocumentLease {
    /**
     * 操作结束：`done` 时成功移动的项按实际目标改地址，租约释放；`unknown`（结果未知）时租约保持，资源管理器核对或
     * 放弃后再以 `done` 结束。重复结束无效。
     */
    end(result: {readonly kind: "done"; readonly moved?: ReadonlyArray<{readonly from: string; readonly to: string}>} | {readonly kind: "unknown"}): void;
}

export type LeaseResult =
    | {readonly ok: true; readonly lease: DocumentLease}
    | {readonly ok: false; readonly reason: "blocked"; readonly documents: ReadonlyArray<AffectedDocument>};

export interface DocumentCoordinator {
    /** 地址本身或其后代里需要结算的文档。 */
    affected(addresses: ReadonlyArray<string>): ReadonlyArray<AffectedDocument>;
    /** 结算这些文档的视图输入、等在途保存，再挡住它们的新保存；有未裁决输入或磁盘冲突时为 blocked，不取租约。 */
    begin(addresses: ReadonlyArray<string>): Promise<LeaseResult>;
    /** 保存这些地址下的 dirty 文档，逐项结果；有未裁决输入或磁盘冲突的项不保存、为失败。 */
    save(addresses: ReadonlyArray<string>): Promise<ReadonlyArray<{readonly address: string; readonly ok: boolean; readonly code?: string}>>;
    /** 本窗口的保存形成了从 `token` 起的目录项身份链时返回链尾的令牌，否则原样返回。 */
    translate(address: string, token: string): string;
    /** 用户确认删除并删除成功后：关闭这些地址及其后代的文档与标签、丢弃正文。 */
    close(addresses: ReadonlyArray<string>): void;
}

export const documentCoordinatorKey: ServiceKey<DocumentCoordinator> = defineServiceKey<DocumentCoordinator>("nbook.editor/documents");

export const EDITOR_PAGES_POINT = "editor.pages";

/**
 * 编辑区标题的菜单位置（docs/specs/workbench/editor.md 输出 34，菜单项的共同规则见 docs/specs/workbench/menus.md）：活动编辑组
 * 标签条右侧的按钮与“⋯”。当前文件是活动组的活动标签（是文件时），`context: "resource"` 的项执行时收到 `{address}`。
 */
export const EDITOR_TITLE_POINT = "editor.title";

export type EditorTitleItemDeclaration = MenuItemDeclaration;

export const editorTitleLocation = menuLocation(EDITOR_TITLE_POINT, {...MENU_BUTTON, ...MENU_EXTENSIONS}, {contexts: ["resource"], buttons: true});

export const validateEditorTitleItem = menuItemValidator(editorTitleLocation);

/** 按 id 打开一个页面（同一页面在窗口里只开一个，已开就切过去）。 */
export const OPEN_PAGE_COMMAND = "nbook.editor.open-page";

/**
 * 页面的声明。页面标签不进会话记录，刷新后不恢复；`openOnFirstVisit` 的页面在这部作品第一次在本窗口打开（还没有编辑器
 * 会话记录）时自动打开。实现（`load()`）与页面组件收到的上下文在 `web/pages.ts`。
 */
export const EditorPageDeclarationSchema = Type.Object({
    title: LocalizedTextSchema,
    icon: Type.String({pattern: "\\S"}),
    openOnFirstVisit: Type.Optional(Type.Boolean()),
}, {additionalProperties: false});

export type EditorPageDeclaration = Static<typeof EditorPageDeclarationSchema>;

const PAGE_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;

/** 页面 id 的规则与视图相同：内置插件写 `nbook.` 开头，其它插件以自己的插件 id 加 `.` 开头。 */
export function validateEditorPageContribution(descriptor: ContributionDescriptor): string | null {
    if (descriptor.location !== "browser") return `${EDITOR_PAGES_POINT} 只接受浏览器入口的贡献`;
    const prefix = descriptor.plugin.startsWith("nbook.") ? "nbook." : `${descriptor.plugin}.`;
    if (!PAGE_ID.test(descriptor.id) || !descriptor.id.startsWith(prefix)) return `插件 ${descriptor.plugin} 的页面 id 必须是点分的小写段、以 ${prefix} 开头：${descriptor.id}`;
    if (!Value.Check(EditorPageDeclarationSchema, descriptor.declaration)) {
        const first = [...Value.Errors(EditorPageDeclarationSchema, descriptor.declaration)][0];
        return `页面 ${descriptor.id} 的声明不合格：${first === undefined ? "" : `${first.instancePath === "" ? "/" : first.instancePath}：${first.message}`}`;
    }
    return null;
}

/**
 * 编辑器贡献点（docs/specs/workbench/editor.md 输出 36–42）：一种打开文件的方式。贡献 id 就是编辑器 id，记在标签上；
 * 规则与页面 id 相同。实现（`load()`）与控件合同在下面。
 */
export const EDITOR_EDITORS_POINT = "editor.editors";

/** 内置的两个编辑器：Markdown 富文本，与源码编辑器（也是默认的文本编辑器，没有 selector）。 */
export const MARKDOWN_EDITOR = "nbook.editor.markdown";
export const CODE_EDITOR = "nbook.editor.code";

const EXTENSION = Type.String({pattern: "^[a-z0-9]+(?:\\.[a-z0-9]+)*$"});

export const EditorDeclarationSchema = Type.Object({
    title: LocalizedTextSchema,
    selector: Type.Optional(Type.Object({
        /** 不带点的小写后缀，可以多段（`d.ts`）。 */
        extensions: Type.Optional(Type.Array(EXTENSION, {minItems: 1})),
        /** 完整文件名，不区分大小写。 */
        filenames: Type.Optional(Type.Array(Type.String({minLength: 1, pattern: "^[^/\\\\]+$"}), {minItems: 1})),
    }, {additionalProperties: false})),
    priority: Type.Union([Type.Literal("default"), Type.Literal("option")]),
    /** `text` 收到文档的绑定；`bytes` 只收到读字节的地址，不读正文。 */
    input: Type.Union([Type.Literal("text"), Type.Literal("bytes")]),
    /** 预览编辑器：从“打开预览”打开，不被不指定编辑器的打开当成这个文件的标签（输出 1、46）。 */
    role: Type.Optional(Type.Literal("preview")),
    /** 这种编辑器记光标的写法（输出 30）；没有就不记。 */
    cursor: Type.Optional(Type.Union([Type.Literal("offset"), Type.Literal("line")])),
}, {additionalProperties: false});

export type EditorDeclaration = Static<typeof EditorDeclarationSchema>;

export function validateEditorContribution(descriptor: ContributionDescriptor): string | null {
    if (descriptor.location !== "browser") return `${EDITOR_EDITORS_POINT} 只接受浏览器入口的贡献`;
    const prefix = descriptor.plugin.startsWith("nbook.") ? "nbook." : `${descriptor.plugin}.`;
    if (!PAGE_ID.test(descriptor.id) || !descriptor.id.startsWith(prefix)) return `插件 ${descriptor.plugin} 的编辑器 id 必须是点分的小写段、以 ${prefix} 开头：${descriptor.id}`;
    if (!Value.Check(EditorDeclarationSchema, descriptor.declaration)) {
        const first = [...Value.Errors(EditorDeclarationSchema, descriptor.declaration)][0];
        return `编辑器 ${descriptor.id} 的声明不合格：${first === undefined ? "" : `${first.instancePath === "" ? "/" : first.instancePath}：${first.message}`}`;
    }
    const declaration = descriptor.declaration as EditorDeclaration;
    if (declaration.input === "bytes" && declaration.selector === undefined) return `编辑器 ${descriptor.id} 按字节显示，必须声明它认领哪些文件（selector）`;
    return null;
}

/** 编辑器的实现：只取得组件定义；组件按下面的控件合同接收绑定。 */
export interface EditorImplementation {
    load(): Promise<Component>;
}

/** 视图状态的槽：控件放自己的状态（模型、编辑状态、滚动位置）；淘汰时编辑器区调 `dispose`。 */
export interface ViewStateSlot {
    state: unknown;
    dispose: (() => void) | null;
}

export type TabCursor = {readonly offset: number} | {readonly line: number; readonly column: number};

/**
 * 文本编辑器（`input: "text"`）收到的绑定：文档的只读视图加输入回执。换文档、换编辑器、换标签都是新的绑定（新的
 * `token`）；换下的绑定之后的调用一律当作过时（`commit` 为 `stale`）。
 */
export interface TextEditorBinding {
    readonly kind: "text";
    readonly token: string;
    readonly tabId: string;
    readonly editor: string;
    /** 文件的地址；改名后随之变化。 */
    readonly address: Readonly<Ref<string>>;
    readonly text: Readonly<Ref<string>>;
    /** 正文修订：每次接受输入或换成磁盘内容加一。 */
    readonly revision: Readonly<Ref<number>>;
    readonly slot: ViewStateSlot;
    /** 输入回执：`baseRevision` 是视图看到的修订。 */
    commit(baseRevision: number, text: string): {readonly status: "accepted" | "conflict"; readonly revision: number} | {readonly status: "stale"};
    /** 登记结算函数（交出还没交出的输入）；切换、保存与资源管理器的操作之前同步调用。 */
    attach(flush: () => void): () => void;
    /** 这个绑定有没有未裁决输入。 */
    unresolved(): boolean;
    /** 标签记下的光标：第一次为这份文档建视图状态时放回去。 */
    readonly cursor: TabCursor | null;
    remember(cursor: TabCursor): void;
    /** 标签记下的语言（输出 45）；没有为 null。 */
    readonly language: string | null;
}

/** 控件交出的句柄：命令（聚焦、撤销、重做、跳转到行）作用于活动组的活动控件。 */
export interface EditorControlHandle {
    focus(): void;
    undo?(): void;
    redo?(): void;
    /** 把还没交出的输入交给文档。 */
    flushPendingChange(): void;
    /** 马上把当前光标交给标签，不等光标停下（拆分要带着拆分这一刻的光标，输出 30）。 */
    rememberCursor?(): void;
    /** 光标位置：选区活动端的行号与列号，都从 1 起（输出 28）；只有能给出源文件行列的控件提供。 */
    readonly position?: Readonly<Ref<{readonly line: number; readonly column: number} | null>>;
    navigation?: {
        getLineCount(): number | null;
        revealLine(line: number): {ok: true; value: {line: number}} | {ok: false; reason: string};
    };
    /** 把光标放到文档末尾并聚焦（继续写作，输出 29）。 */
    revealEnd?(): void;
    /** 状态栏的编辑器状态条目显示的一行（输出 42）；没有为 null。 */
    readonly status?: Readonly<Ref<LocalizedText | string | null>>;
}

/** 控件的属性与事件（`binding` 的类型按编辑器的 `input`）。 */
export interface EditorControlProps<B> {
    readonly binding: B | null;
    /** 组 × 编辑器的实例槽：重挂时接着用存在这里的编辑器实例。 */
    readonly host: ViewStateSlot;
    readonly readonly: boolean;
    readonly visible: boolean;
    readonly label: string;
}
