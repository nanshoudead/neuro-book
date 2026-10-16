/**
 * 选区引用的写法（docs/specs/ui/prompt-editor.md 的文字写法）：`[[路径]]`、`[[路径#L起-L止]]`，以及不带方括号的短写法
 * `目录/文件#起-止`。规则照旧应用的 `app/utils/inline-editor-selection.ts`（分支 `archive/legacy-ui-tuning`，`865c9f593`）：
 * 行号前的 `L` 不分大小写、可以省略；路径去掉开头的 `./`、反斜杠换成 `/`；绝对路径、`..` 段与带方案的路径不算；行号 0
 * 不算范围。旧草稿里的选区因此读出同样的路径与行号。
 *
 * 和旧版不同的只有查找方式：旧版从每个位置截出余下全文再匹配，长草稿是平方级；这里一次扫描。
 */

export interface SelectionChip {
    /** 原文。 */
    readonly raw: string;
    readonly start: number;
    readonly end: number;
    readonly path: string;
    readonly startLine: number | null;
    readonly endLine: number | null;
    /** 显示名：文件名，有范围时加 `:起-止`。 */
    readonly label: string;
}

const SHORT_PATTERN = /^((?:\.?[\w@~.-][\w@~./\\-]*\/)?[\w@~.-][\w@~./\\-]*(?:\.[\w-]+)?#(?:L)?\d+(?:-(?:L)?\d+)?)(?=$|[\s,.;，。；、)）\]])/u;
const INNER_PATTERN = /^(.+?)(?:#(?:L)?(\d+)(?:-(?:L)?(\d+))?)?$/iu;
const SHORT_START_BOUNDARY = /[\s([{"'“‘，。；、,;]/u;
/** 短写法可能用到的字符：路径、`#`、行号前的 `L`。一段连续的这些字符里没有 `#` 就不必再试正则。 */
const SHORT_CHAR = /[\w@~./\\#-]/u;
const URL_AUTHORITY_SEGMENT = /^[a-z0-9-]+\.[a-z0-9.-]+$/iu;

const normalizePath = (path: string): string => path.trim().replace(/\\/gu, "/").replace(/^\.\//u, "");

const isSafePath = (path: string): boolean => Boolean(path) && !path.startsWith("/") && !path.includes("..") && !/\s/u.test(path) && !/^[a-z][a-z0-9+.-]*:/iu.test(path);

/** 方括号里的部分（或短写法本身）→ 路径与范围；不是选区为 null。 */
function parseInner(inner: string, raw: string, start: number): SelectionChip | null {
    const matched = INNER_PATTERN.exec(inner.trim());
    if (!matched?.[1]) return null;
    const path = normalizePath(matched[1]);
    if (!isSafePath(path)) return null;
    const first = matched[2] ? Number(matched[2]) : null;
    const last = matched[3] ? Number(matched[3]) : first;
    // 行号 0 不算范围（旧版的判断是“非零”）。
    const startLine = first && last ? Math.max(1, Math.floor(first)) : null;
    const endLine = first && last && startLine !== null ? Math.max(startLine, Math.floor(last)) : null;
    const name = path.split("/").filter(Boolean).at(-1) ?? path;
    return {raw, start, end: start + raw.length, path, startLine, endLine, label: startLine === null ? name : `${name}:${String(startLine)}-${String(endLine)}`};
}

/** 短写法要带目录，第一段不能像网址的主机名（`example.com/a#1`）。 */
function parseShort(text: string, start: number): SelectionChip | null {
    const matched = SHORT_PATTERN.exec(text);
    if (!matched?.[1]) return null;
    const chip = parseInner(matched[1], matched[1], start);
    if (chip === null || !chip.path.includes("/")) return null;
    return URL_AUTHORITY_SEGMENT.test(chip.path.split("/").find(Boolean) ?? "") ? null : chip;
}

/** 一段文字里所有不重叠的选区引用，从左往右。 */
export function findSelections(text: string): SelectionChip[] {
    // 每个位置往后第一个 `]` 或换行：方括号写法 `[[…]]` 在这里收尾。
    const stop = new Array<number>(text.length + 1);
    stop[text.length] = text.length;
    for (let index = text.length - 1; index >= 0; index -= 1) stop[index] = text[index] === "]" || text[index] === "\n" ? index : (stop[index + 1] as number);
    const found: SelectionChip[] = [];
    for (let index = 0; index < text.length; index += 1) {
        if (text.startsWith("[[", index)) {
            const close = stop[index + 2] as number;
            if (close > index + 2 && text.startsWith("]]", close)) {
                const chip = parseInner(text.slice(index + 2, close), text.slice(index, close + 2), index);
                if (chip !== null) {
                    found.push(chip);
                    index = chip.end - 1;
                    continue;
                }
            }
        }
        const boundary = index === 0 || (SHORT_START_BOUNDARY.test(text[index - 1] as string) && text.slice(Math.max(0, index - 3), index) !== "://");
        if (!boundary || !SHORT_CHAR.test(text[index] as string)) continue;
        let end = index;
        while (end < text.length && SHORT_CHAR.test(text[end] as string)) end += 1;
        const span = text.slice(index, end);
        const chip = span.includes("#") ? parseShort(text.slice(index, end + 1), index) : null;
        if (chip !== null) found.push(chip);
        // 这一段里别的位置都不是短写法的开头（前一个字不是边界字符）。
        index = (chip?.end ?? end) - 1;
    }
    return found;
}

/** 原文（方括号写法或短写法）→ 路径与范围。 */
export function parseSelectionText(raw: string): SelectionChip | null {
    return findSelections(raw).find((chip) => chip.start === 0 && chip.end === raw.length) ?? null;
}
