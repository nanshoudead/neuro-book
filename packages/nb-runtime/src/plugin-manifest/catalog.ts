/**
 * 插件的消息目录（docs/specs/runtime/plugin-manifest.md 的 `l10n`）：清单 `l10n.locales` 列出的每种语言各一份
 * `locales/<语言>.json`，命名空间是插件 id。这里只有与文件系统无关的规则：SDK 构建、安装与窗口用同一份检查内容，
 * 三处各写一份时，一处放过的目录会在另一处被拒；目录端点原样返回文件，只用这里的路径规则 `catalogFile`。
 *
 * 目录内容的规则来自宿主翻译引擎的约束（docs/specs/ui/i18n.md 输出 7）：键里的 `:` 会被 i18next 当成命名空间分隔，值里的
 * `$t(` 会跨命名空间取文字，所以都拒绝。
 */

import type {ManifestProblem} from "./schema";

/** 一种语言下的目录：键到文字，值也可以是嵌套对象（键用 `.` 连起来）。与 nb-ui 的 `Catalog` 同一结构。 */
export interface MessageCatalog {
    readonly [key: string]: string | MessageCatalog;
}

/** 目录文件相对插件目录的路径。语言标签是规范写法时只含字母、数字与连字符，拼进路径不会越出 `locales/`。 */
export function catalogFile(tag: string): string {
    return `locales/${tag}.json`;
}

/**
 * 语言标签的规范写法（`Intl.getCanonicalLocales`）；不是合法的语言标签为 null。清单与文件名都要求写成规范写法：
 * `zh-cn.json` 也是合法标签，但登记进引擎的标签与界面语言 `zh-CN` 永远对不上。
 */
export function canonicalLocaleTag(tag: string): string | null {
    try {
        const [canonical] = Intl.getCanonicalLocales(tag);
        return canonical ?? null;
    } catch (error) {
        // 不合法的标签抛 RangeError：这正是“不是语言标签”的答案。别的错误不是。
        if (error instanceof RangeError) return null;
        throw error;
    }
}

/** 一个语言标签的问题：不合法，或不是规范写法；没有问题为 null。 */
export function localeTagProblem(tag: string): string | null {
    const canonical = canonicalLocaleTag(tag);
    if (canonical === null) return `不是合法的语言标签：${tag}`;
    if (canonical !== tag) return `语言标签要写成规范写法 ${canonical}：${tag}`;
    return null;
}

function describeValue(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "数组";
    return typeof value;
}

/**
 * 目录内容的问题：根要是对象；每个值是字符串或嵌套的对象；键不含 `:`；字符串不含 `$t(`。问题的 `path` 是目录里的点号键路径
 * （根为空串），调用方前面加上文件名。按对象自身的键序逐层检查，同一输入总是同一结果。
 *
 * 用显式的栈而不是递归：目录来自第三方插件与网络，嵌套极深的 JSON 照样能解析出来，递归会让调用方得到一个栈溢出。
 */
export function catalogProblems(value: unknown): ManifestProblem[] {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [{path: "", message: `目录的根必须是对象，这里是${describeValue(value)}`}];
    const problems: ManifestProblem[] = [];
    const pending: Array<{readonly path: string; readonly value: object}> = [{path: "", value}];
    while (pending.length > 0) {
        const current = pending.shift()!;
        for (const [key, item] of Object.entries(current.value)) {
            const path = current.path === "" ? key : `${current.path}.${key}`;
            if (key.includes(":")) problems.push({path, message: "键不能含 :（会被当成命名空间分隔）"});
            if (typeof item === "string") {
                if (item.includes("$t(")) problems.push({path, message: "值不能含 $t(（不支持跨键引用）"});
            } else if (typeof item === "object" && item !== null && !Array.isArray(item)) {
                pending.push({path, value: item});
            } else {
                problems.push({path, message: `值必须是字符串或嵌套的对象，这里是${describeValue(item)}`});
            }
        }
    }
    return problems;
}

export type CatalogParseResult = {readonly ok: true; readonly catalog: MessageCatalog} | {readonly ok: false; readonly problems: ReadonlyArray<ManifestProblem>};

/** 解析一份目录文件的文本并检查内容。 */
export function parseCatalog(text: string): CatalogParseResult {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        return {ok: false, problems: [{path: "", message: `不是合法的 JSON：${error.message}`}]};
    }
    const problems = catalogProblems(value);
    return problems.length === 0 ? {ok: true, catalog: value as MessageCatalog} : {ok: false, problems};
}
