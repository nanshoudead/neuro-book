/**
 * 编辑器的登记与选择（docs/specs/workbench/editor.md 输出 36–40）：贡献点 `editor.editors` 的声明决定一个文件用哪种编辑器，
 * 交付的实现只决定控件什么时候能挂上。选择只看声明，所以结果不随插件激活的先后变化。
 *
 * 这里是纯函数，组模型与测试直接用；交付的组件在 `editor-registry.ts`。
 */

import {CODE_EDITOR, MARKDOWN_EDITOR} from "../shared/contracts";
import type {EditorDeclaration} from "../shared/contracts";

/** 编辑器区自己的两个编辑器的声明：插件定义与测试里的目录用同一份。 */
export const BUILTIN_EDITORS: Readonly<Record<string, EditorDeclaration>> = {
    [MARKDOWN_EDITOR]: {title: {"zh-CN": "Markdown 编辑器", "en-US": "Markdown Editor"}, selector: {extensions: ["md", "markdown"]}, priority: "default", input: "text", cursor: "offset"},
    [CODE_EDITOR]: {title: {"zh-CN": "源码编辑器", "en-US": "Source Editor"}, priority: "option", input: "text", cursor: "line"},
};

/**
 * “不能在这里打开”的标签用的编辑器 id（输出 37 第 1 步）：不是贡献，不进目录与候选；标签记着它，内容区只给出说明，
 * 用户可以经“用其它编辑器重新打开”换成别的编辑器。
 */
export const BINARY_TAB_EDITOR = "nbook.editor.binary";

/**
 * 已知的二进制扩展名（输出 37 第 1 步）：没有编辑器认领时直接说明“不能在这里打开”，不读文件。读一遍才知道不是文本，
 * 大文件还会先撞上正文上限、报成“太大”。
 */
const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
    "pdf", "mp3", "mp4", "m4a", "mov", "webm", "wav", "flac", "ogg", "ttf", "otf", "woff", "woff2", "zip", "gz", "7z", "rar", "exe", "dll", "so", "dylib",
]);

/** 已接受的编辑器声明；按编辑器 id 的码元顺序（与内核的 `list` 相同），同级冲突时取第一个。 */
export interface EditorCatalog {
    declaration(id: string): EditorDeclaration | null;
    list(): ReadonlyArray<{readonly id: string; readonly declaration: EditorDeclaration}>;
}

export function catalogOf(declarations: ReadonlyArray<{readonly id: string; readonly declaration: EditorDeclaration}>): EditorCatalog {
    const sorted = [...declarations].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    const byId = new Map(sorted.map((item) => [item.id, item.declaration]));
    return {declaration: (id) => byId.get(id) ?? null, list: () => sorted};
}

/** 只有内置两个编辑器的目录（测试与没有贡献点的场合）。 */
export const BUILTIN_CATALOG: EditorCatalog = catalogOf(Object.entries(BUILTIN_EDITORS).map(([id, declaration]) => ({id, declaration})));

const fileName = (address: string): string => {
    const path = address.replace(/^[a-z]+:\/\//u, "");
    return path.slice(path.lastIndexOf("/") + 1).toLowerCase();
};

/**
 * 声明的 selector 对这个文件的命中程度：文件名命中最强，其次是扩展名，后缀越长越强（`d.ts` 强于 `ts`）；不命中为 0。
 * 扩展名按最后若干段比较，不区分大小写。
 */
export function selectorScore(declaration: EditorDeclaration, address: string): number {
    const name = fileName(address);
    if (declaration.selector?.filenames?.some((candidate) => candidate.toLowerCase() === name) === true) return Number.MAX_SAFE_INTEGER;
    let best = 0;
    for (const extension of declaration.selector?.extensions ?? []) {
        if (name.length > extension.length + 1 && name.endsWith(`.${extension}`)) best = Math.max(best, extension.split(".").length);
    }
    return best;
}

export type Resolution = {readonly kind: "editor"; readonly editor: string} | {readonly kind: "binary"};

/**
 * 没有指定编辑器时选哪一个（输出 37）：已知二进制且没有编辑器认领 → 不能打开；default 档里命中最强的；否则源码编辑器
 * （它读到不是文本时自己说明）。`conflict` 收到同级命中的两个以上编辑器，用于记诊断。
 */
export function resolveEditor(catalog: EditorCatalog, address: string, conflict?: (ids: ReadonlyArray<string>) => void): Resolution {
    let best = 0;
    let winners: string[] = [];
    let claimed = false;
    for (const {id, declaration} of catalog.list()) {
        const score = selectorScore(declaration, address);
        if (score === 0) continue;
        claimed = true;
        if (declaration.priority !== "default") continue;
        if (score > best) {
            best = score;
            winners = [id];
        } else if (score === best) {
            winners.push(id);
        }
    }
    if (winners.length > 1) conflict?.(winners);
    const first = winners[0];
    if (first !== undefined) return {kind: "editor", editor: first};
    const name = fileName(address);
    const extension = name.lastIndexOf(".") > 0 ? name.slice(name.lastIndexOf(".") + 1) : "";
    if (!claimed && BINARY_EXTENSIONS.has(extension)) return {kind: "binary"};
    return {kind: "editor", editor: CODE_EDITOR};
}

/**
 * “用其它编辑器重新打开”的候选（输出 39）：selector 命中的全部编辑器（含 option 档与预览编辑器），加上源码编辑器；
 * 按命中强弱排，同级按 id。
 */
export function candidatesFor(catalog: EditorCatalog, address: string): ReadonlyArray<string> {
    const hits = catalog.list().map(({id, declaration}) => ({id, score: selectorScore(declaration, address)})).filter((hit) => hit.score > 0);
    hits.sort((left, right) => right.score - left.score);
    const ids = hits.map((hit) => hit.id);
    if (!ids.includes(CODE_EDITOR) && catalog.declaration(CODE_EDITOR) !== null) ids.push(CODE_EDITOR);
    return ids;
}

/**
 * 指定的编辑器能不能打开这个文件（输出 38）：要有已接受的声明；按字节显示的编辑器只能打开它认领的文件，文本编辑器可以
 * 打开任何文本。不行时给出原因。
 */
export function editorRefusal(catalog: EditorCatalog, editor: string, address: string): string | null {
    const declaration = catalog.declaration(editor);
    if (declaration === null) return `没有编辑器 ${editor}`;
    if (declaration.input === "bytes" && selectorScore(declaration, address) === 0) return `编辑器 ${editor} 不能打开 ${fileName(address)}`;
    return null;
}
