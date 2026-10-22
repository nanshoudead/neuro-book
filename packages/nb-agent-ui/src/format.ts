/**
 * 界面上几处共用的小格式：角色行的时刻、折叠行露出的第一行。Markdown 来源的折叠行（思考、提醒）用 `markdownPreviewLine`
 * 或宿主注入的 `markdownPreview`；`firstLine` 只取原文第一行（原始视图、排队消息）。
 */
import type {AgentLocale} from "./types";

/** 24 小时制的时:分:秒，按界面语言。 */
export function formatClock(timestamp: number, locale: AgentLocale): string {
    return new Intl.DateTimeFormat(locale, {hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false}).format(timestamp);
}

const DAY_MS = 86_400_000;

/** 本地时区的日历日序号：先取年月日再按 UTC 折成天数，夏令时那天的 23 或 25 小时不会把日子算错。 */
function localDayIndex(timestamp: number): number {
    const date = new Date(timestamp);
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

/**
 * 会话列表的时间（Spec“会话列表”）：与 `now` 同一天写时刻，前一天写“昨天”，同一年写月日，否则加上年。按本地时区的
 * 日历日比较；`timestamp` 晚于 `now`（多机时钟差）时按同一天写。
 */
export function formatListTime(timestamp: number, now: number, locale: AgentLocale): string {
    const days = localDayIndex(now) - localDayIndex(timestamp);
    if (days <= 0) return new Intl.DateTimeFormat(locale, {hour: "2-digit", minute: "2-digit", hour12: false}).format(timestamp);
    if (days === 1) return new Intl.RelativeTimeFormat(locale, {numeric: "auto"}).format(-1, "day");
    const sameYear = new Date(timestamp).getFullYear() === new Date(now).getFullYear();
    return new Intl.DateTimeFormat(locale, sameYear ? {month: "short", day: "numeric"} : {year: "numeric", month: "short", day: "numeric"}).format(timestamp);
}

/** 去掉首尾空白后的第一行，原样；原始视图与排队消息（用户的纯文字）只露出它。 */
export function firstLine(text: string): string {
    return text.trim().split("\n", 1)[0] ?? "";
}

// ─── Markdown 预览行 ─────────────────────────────────────────────────────

const FENCE = /^\s*(```|~~~)/u;
const THEMATIC_BREAK = /^\s*([-*_])(\s*\1){2,}\s*$/u;
const TABLE_ROW = /^\s*\|.*\|\s*$/u;
/** 行首的块标记，后面必须跟空白：`#伏笔`、`*注：`、`-5℃` 不算。可以叠着写，例如 `> - [x] 完成`。 */
const BLOCK_MARKER = /^\s*(?:#{1,6}|>|[-*+]|\d{1,9}[.)]|\[[ xX]\])\s+/u;
const HEADING_CLOSE = /\s+#+\s*$/u;
/** 反斜杠转义的 Markdown 符号；先换成私用区占位，最后还原，免得被当成标记。 */
const ESCAPE = /\\([\\`*_{}[\]()#+\-.!|~=<>])/gu;
const PLACEHOLDER_BASE = 0xe000;

/**
 * Markdown 文字折叠时露出的一行纯文字（Spec“分轮视图”的思考预览）：第一行非空的正文，去掉块标记与常见的行内标记。
 *
 * 不做完整解析：展开后由宿主的 Markdown 显示全文，这里只保证一行预览里不出现 `**` 之类的符号；方言写法由宿主经
 * `markdownPreview` 自己决定。几条规则的理由：
 * - 先切出行内代码，代码里的星号原样；
 * - 首尾相接的粗体小标题（`**A****B**`，真实模型的思考摘要这样写）只留第一段；
 * - 成对的 `***`、`**`、`~~`、`==` 只要求内侧紧贴文字，紧挨汉字或全角标点也算；
 * - 单个 `*`、`_` 与 `__` 要求外侧是空白、标点或行首行尾，`snake_case`、`读取_章节_摘要`、`2 * 3 * 4` 不动
 *   （不用 `\b`：它把汉字当非词字符）；
 * - 流式生成时行尾或行首落单的标记去掉。
 */
export function markdownPreviewLine(text: string): string {
    const escapes: string[] = [];
    const escaped = text.replace(ESCAPE, (_, char: string) => {
        escapes.push(char);
        return String.fromCharCode(PLACEHOLDER_BASE + escapes.length - 1);
    });
    const line = escaped.split("\n").find((candidate) => candidate.trim() !== "" && !FENCE.test(candidate) && !THEMATIC_BREAK.test(candidate) && !TABLE_ROW.test(candidate));
    if (line === undefined) return "";

    let body = line;
    if (/^\s*#{1,6}\s/u.test(body)) body = body.replace(HEADING_CLOSE, "");
    while (BLOCK_MARKER.test(body)) body = body.replace(BLOCK_MARKER, "");

    // 行内代码与正文交替：偶数下标是正文，奇数下标是代码内容。
    const parts = body.split(/(`+)([^`]*?)\1/u);
    const pieces: Array<{code: boolean; text: string}> = [];
    for (let index = 0; index < parts.length; index += 3) {
        pieces.push({code: false, text: parts[index] ?? ""});
        if (index + 2 < parts.length) pieces.push({code: true, text: parts[index + 2] ?? ""});
    }
    const cut = pieces.findIndex((piece) => !piece.code && piece.text.includes("****"));
    if (cut >= 0) {
        const piece = pieces[cut]!;
        piece.text = piece.text.slice(0, piece.text.indexOf("****") + 2);
        pieces.length = cut + 1;
    }

    const plain = pieces.map((piece) => (piece.code ? piece.text : stripInline(piece.text))).join("");
    return plain
        .replace(/[\ue000-\uf8ff]/gu, (char) => escapes[char.charCodeAt(0) - PLACEHOLDER_BASE] ?? char)
        .replace(/\s+/gu, " ")
        .trim();
}

function stripInline(text: string): string {
    return text
        .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
        .replace(/<((?:https?|mailto):[^>\s]+)>/gu, "$1")
        .replace(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?>/gu, "")
        .replace(/(\*\*\*|\*\*|~~|==)(?=\S)([^]*?\S)\1/gu, "$2")
        // 流式中只到了一半：成对的粗体去完以后开头还剩的 `**`、`__` 没有收尾，先去掉，免得被下一步当成单个强调的开头。
        .replace(/^(\*{2,3}|__)(?=\S)/u, "")
        .replace(/(^|[\s\p{P}\p{S}])(__|_|\*)(?=\S)([^]*?\S)\2(?=$|[\s\p{P}\p{S}])/gu, "$1$3")
        // 行尾落单的强调符号（流式中收尾的标记只到了一半）。
        .replace(/(?<=\S)(\*{1,3}|_{2}|~~|==)$/u, "");
}
