/**
 * 从页面、样式与脚本的文字里取出引用的地址，供发布时算产物的文件集（docs/file-formats.md 的“发布记录”）。
 * 只做词法上的提取，不解析路径：归一化（去掉 `?`、`#`，判断是否在产物目录里）在 artifacts.ts，与引用检查共用。
 * 本模块被前端经 questions.ts 间接导入，不能有 `node:` 依赖。
 *
 * 样式与脚本各用一遍从头到尾的词法扫描：注释、字符串与模板字符串的正文在扫描里自然跳过，不先用正则删注释
 * （`content: "/*"` 这样的字符串会让正则删掉后面真的规则）。行号在扫描时顺带累计，整个过程对文字长度是线性的：
 * 发布在全仓记录的锁里同步算文件集，面板每次也要重算，异常的大文件不能把锁占住。
 *
 * 只认字面量：脚本里拼出来的地址追踪不到，漏掉的未跟踪文件会出现在 `unreferenced_files_not_committed` 里，
 * 由会话用 `--include` 补上。
 */

/** 一处引用；`lineOffset` 是它在所给文字里的第几行（从 0 起），调用方加上文字本身的起始行。 */
export type TextReference = {target: string; lineOffset: number};

function isAsciiWhitespace(char: string): boolean {
    return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
}

/**
 * `srcset` 里各候选的地址，按 HTML 的候选语法：地址是一段不含空白的字符，后面是描述符，候选之间用逗号分隔。
 * 不能按逗号切：`assets/a,b.png 1x` 的地址本身含逗号，`data:` 地址里也有逗号。
 */
export function srcsetUrls(value: string): string[] {
    const urls: string[] = [];
    let index = 0;
    while (index < value.length) {
        while (index < value.length && (isAsciiWhitespace(value[index]!) || value[index] === ",")) index += 1;
        if (index >= value.length) break;
        const start = index;
        while (index < value.length && !isAsciiWhitespace(value[index]!)) index += 1;
        const url = value.slice(start, index);
        // 地址以逗号结尾时，这个候选没有描述符，逗号就是分隔符。
        if (url.endsWith(",")) {
            urls.push(url.replace(/,+$/u, ""));
            continue;
        }
        urls.push(url);
        // 描述符一直到下一个不在括号里的逗号。
        let inParens = false;
        while (index < value.length) {
            const char = value[index]!;
            index += 1;
            if (char === "(") inParens = true;
            else if (char === ")") inParens = false;
            else if (char === "," && !inParens) break;
        }
    }
    return urls.filter((url) => url !== "");
}

/** 扫描位置；只往前走，经过换行时累计行号，所以每一处引用的行号不用再从头数。 */
class Cursor {
    index = 0;
    line = 0;

    constructor(readonly text: string) {}

    get done(): boolean {
        return this.index >= this.text.length;
    }

    /** 往后第 `offset` 个字符；越过末尾时是空串。 */
    peek(offset = 0): string {
        return this.text[this.index + offset] ?? "";
    }

    /** 取一个字符并前进；已到末尾时返回空串、不动。 */
    next(): string {
        const char = this.text[this.index] ?? "";
        if (char === "") return char;
        this.index += 1;
        if (char === "\n") this.line += 1;
        return char;
    }

    save(): {index: number; line: number} {
        return {index: this.index, line: this.line};
    }

    restore(point: {index: number; line: number}): void {
        this.index = point.index;
        this.line = point.line;
    }
}

function isHexDigit(char: string): boolean {
    return char !== "" && /^[0-9a-f]$/iu.test(char);
}

// ---------- 样式表 ----------
// 按 CSS Syntax Level 3 的分词规则，只实现找引用要用到的部分：注释、字符串、`url(` 记号与 `@import`。

const REPLACEMENT_CHARACTER = "�";

function isCssNewline(char: string): boolean {
    return char === "\n" || char === "\r" || char === "\f";
}

function isCssWhitespace(char: string): boolean {
    return char === " " || char === "\t" || isCssNewline(char);
}

/** 名字里的字符（标识符与 at 规则名）；非 ASCII 字符都算。 */
function isCssNameChar(char: string): boolean {
    return char !== "" && (/^[A-Za-z0-9_-]$/u.test(char) || char.charCodeAt(0) >= 0x80);
}

/** 反斜杠后面不是换行就是一个转义（CSS 的 valid escape）；`offset` 指向反斜杠。 */
function startsCssEscape(cursor: Cursor, offset: number): boolean {
    return cursor.peek(offset) === "\\" && !isCssNewline(cursor.peek(offset + 1));
}

/** 光标在反斜杠之后：至多 6 位十六进制数（后面可跟一个空白），或者原样的一个字符。 */
function consumeCssEscape(cursor: Cursor): string {
    if (cursor.done) return REPLACEMENT_CHARACTER;
    if (!isHexDigit(cursor.peek())) return cursor.next();
    let hex = "";
    while (hex.length < 6 && isHexDigit(cursor.peek())) hex += cursor.next();
    if (cursor.peek() === "\r" && cursor.peek(1) === "\n") {
        cursor.next();
        cursor.next();
    } else if (isCssWhitespace(cursor.peek())) cursor.next();
    const codePoint = Number.parseInt(hex, 16);
    return codePoint === 0 || (codePoint >= 0xd800 && codePoint <= 0xdfff) || codePoint > 0x10ffff ? REPLACEMENT_CHARACTER : String.fromCodePoint(codePoint);
}

/** 名字（标识符、at 规则名或数字后的单位），按转义解码；`url` 写成 `u\72l` 也认得出。 */
function consumeCssName(cursor: Cursor): string {
    let name = "";
    for (;;) {
        if (isCssNameChar(cursor.peek())) name += cursor.next();
        else if (startsCssEscape(cursor, 0)) {
            cursor.next();
            name += consumeCssEscape(cursor);
        } else return name;
    }
}

/** 光标在开引号之后，读到配对的引号。没转义的换行让它成为坏字符串（返回 null，换行留给外层），反斜杠加换行是续行。 */
function consumeCssString(cursor: Cursor, quote: string): string | null {
    let value = "";
    while (!cursor.done) {
        const char = cursor.peek();
        if (char === quote) {
            cursor.next();
            return value;
        }
        if (isCssNewline(char)) return null;
        cursor.next();
        if (char !== "\\") {
            value += char;
            continue;
        }
        if (cursor.done) continue;
        if (isCssNewline(cursor.peek())) {
            if (cursor.next() === "\r" && cursor.peek() === "\n") cursor.next();
            continue;
        }
        value += consumeCssEscape(cursor);
    }
    return value;
}

/** 坏的 `url(`：吞到右括号或末尾，括号前的转义照样跳过。 */
function consumeBadUrlRemnants(cursor: Cursor): void {
    while (!cursor.done) {
        const char = cursor.next();
        if (char === ")") return;
        if (char === "\\" && !isCssNewline(cursor.peek())) consumeCssEscape(cursor);
    }
}

function isCssNonPrintable(char: string): boolean {
    const code = char.charCodeAt(0);
    return code <= 0x08 || code === 0x0b || (code >= 0x0e && code <= 0x1f) || code === 0x7f;
}

/**
 * 不带引号的 `url(...)`，光标在左括号与它后面的空白之后。地址里出现空白后只能接右括号；
 * 出现引号、左括号、控制字符或不合法的转义都是坏地址（返回 null），不算引用。
 */
function consumeCssUrl(cursor: Cursor): string | null {
    let value = "";
    while (!cursor.done) {
        const char = cursor.next();
        if (char === ")") return value;
        if (isCssWhitespace(char)) {
            while (isCssWhitespace(cursor.peek())) cursor.next();
            if (cursor.done) return value;
            if (cursor.peek() === ")") {
                cursor.next();
                return value;
            }
            consumeBadUrlRemnants(cursor);
            return null;
        }
        if (char === '"' || char === "'" || char === "(" || isCssNonPrintable(char)) {
            consumeBadUrlRemnants(cursor);
            return null;
        }
        if (char !== "\\") {
            value += char;
            continue;
        }
        if (isCssNewline(cursor.peek())) {
            consumeBadUrlRemnants(cursor);
            return null;
        }
        value += consumeCssEscape(cursor);
    }
    return value;
}

/** 光标在 `/*` 上：跳到 `*\/` 之后；没有结尾时到末尾。 */
function skipBlockComment(cursor: Cursor): void {
    cursor.next();
    cursor.next();
    while (!cursor.done && !(cursor.peek() === "*" && cursor.peek(1) === "/")) cursor.next();
    cursor.next();
    cursor.next();
}

function skipCssWhitespaceAndComments(cursor: Cursor): void {
    for (;;) {
        if (isCssWhitespace(cursor.peek())) cursor.next();
        else if (cursor.peek() === "/" && cursor.peek(1) === "*") skipBlockComment(cursor);
        else return;
    }
}

/** 样式表（`.css`、内联 `<style>`、`style` 属性）里 `url(...)` 与 `@import "…"` 的地址，按转义解码；注释与其它字符串里的不算。 */
export function cssReferences(text: string): TextReference[] {
    const cursor = new Cursor(text);
    const found: TextReference[] = [];
    const record = (target: string | null, lineOffset: number) => {
        const trimmed = target?.trim() ?? "";
        if (trimmed !== "") found.push({target: trimmed, lineOffset});
    };
    /** `url(` 或 `@import` 之后的带引号地址。 */
    const quoted = (lineOffset: number) => {
        const quote = cursor.peek();
        if (quote !== '"' && quote !== "'") return false;
        cursor.next();
        record(consumeCssString(cursor, quote), lineOffset);
        return true;
    };
    while (!cursor.done) {
        const char = cursor.peek();
        const line = cursor.line;
        if (char === "/" && cursor.peek(1) === "*") {
            skipBlockComment(cursor);
        } else if (char === '"' || char === "'") {
            cursor.next();
            consumeCssString(cursor, char);
        } else if (char === "@" && (isCssNameChar(cursor.peek(1)) || startsCssEscape(cursor, 1))) {
            cursor.next();
            if (consumeCssName(cursor).toLowerCase() !== "import") continue;
            // `@import url(...)` 的地址由下一轮当作 `url(` 记号收。
            skipCssWhitespaceAndComments(cursor);
            quoted(line);
        } else if (isCssNameChar(char) || startsCssEscape(cursor, 0)) {
            // 整个名字一起读：`my-url(` 不是 `url(`。
            if (consumeCssName(cursor).toLowerCase() !== "url" || cursor.peek() !== "(") continue;
            cursor.next();
            while (isCssWhitespace(cursor.peek())) cursor.next();
            if (!quoted(line)) record(consumeCssUrl(cursor), line);
        } else {
            cursor.next();
        }
    }
    return found;
}

// ---------- 脚本 ----------
// 把脚本切成记号（词、字符串、模板字符串、正则、单个标点），注释与空白不出记号；再在记号上认 import 与再导出。

type JsToken =
    | {kind: "word"; value: string; line: number}
    | {kind: "punct"; value: string; line: number}
    /** `value` 是解码后的内容；没闭合的字符串为 null。 */
    | {kind: "string"; value: string | null; line: number}
    /** 不带 `${` 的模板字符串给出内容；带插值的开头一段与插值之后的每一段都是 null。 */
    | {kind: "template"; value: string | null; line: number}
    | {kind: "regex"; line: number};

function isJsLineTerminator(char: string): boolean {
    return char === "\n" || char === "\r" || char === " " || char === " ";
}

function isJsSpace(char: string): boolean {
    if (char === "") return false;
    const code = char.charCodeAt(0);
    return code <= 0x20 || code === 0xa0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff;
}

/** 标识符、关键字与数字里的字符；非 ASCII 的除空白外都算（中文变量名）。 */
function isJsWordChar(char: string): boolean {
    return char !== "" && (/^[A-Za-z0-9_$]$/u.test(char) || (char.charCodeAt(0) >= 0x80 && !isJsSpace(char)));
}

/** 这些关键字之后的 `/` 是正则的开头，不是除号。 */
const REGEX_AFTER_WORDS = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);

const SIMPLE_ESCAPES: Record<string, string> = {n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0"};

/** 光标在反斜杠之后，解码字符串与模板字符串里的一个转义；反斜杠加换行是续行，得到空串。 */
function consumeJsEscape(cursor: Cursor): string {
    const char = cursor.next();
    if (char === "\r") {
        if (cursor.peek() === "\n") cursor.next();
        return "";
    }
    if (isJsLineTerminator(char)) return "";
    if (char === "x" && isHexDigit(cursor.peek()) && isHexDigit(cursor.peek(1))) return String.fromCharCode(Number.parseInt(cursor.next() + cursor.next(), 16));
    if (char === "u" && cursor.peek() === "{") {
        let length = 0;
        while (length < 6 && isHexDigit(cursor.peek(1 + length))) length += 1;
        if (length === 0 || cursor.peek(1 + length) !== "}") return char;
        cursor.next();
        let hex = "";
        for (let index = 0; index < length; index += 1) hex += cursor.next();
        cursor.next();
        const codePoint = Number.parseInt(hex, 16);
        return codePoint > 0x10ffff ? char : String.fromCodePoint(codePoint);
    }
    if (char === "u" && [0, 1, 2, 3].every((offset) => isHexDigit(cursor.peek(offset)))) {
        return String.fromCharCode(Number.parseInt(cursor.next() + cursor.next() + cursor.next() + cursor.next(), 16));
    }
    return SIMPLE_ESCAPES[char] ?? char;
}

/**
 * 脚本的分词器。正则与除号按前一个记号区分（`)`、`]`、词与字面量之后是除号，其余是正则）：这是不做完整语法分析时的通常做法，
 * `a++ /re/` 这样的少见写法会认错。
 */
class JsLexer {
    private readonly cursor: Cursor;
    private last: JsToken | null = null;
    /** 还没闭合的 `{`：普通花括号，或模板字符串的 `${`；遇到 `}` 时据此决定回到模板字符串里。 */
    private readonly braces: Array<"brace" | "template"> = [];
    /**
     * 上一次没闭合的正则一直扫到了哪里。从它之前开始的 `/` 不再按正则扫：同一行里每个 `/` 都往行尾扫一遍会变成平方级。
     * 少数先认错、再认对的写法会因此当成除号，最多让正则里的引号被当作字符串的开头。
     */
    private regexScannedUntil = -1;

    constructor(text: string) {
        this.cursor = new Cursor(text);
        if (text.startsWith("#!")) this.skipLine();
    }

    next(): JsToken | null {
        const cursor = this.cursor;
        for (;;) {
            if (cursor.done) return null;
            const char = cursor.peek();
            if (isJsSpace(char)) {
                cursor.next();
                continue;
            }
            if (char === "/" && cursor.peek(1) === "/") {
                this.skipLine();
                continue;
            }
            if (char === "/" && cursor.peek(1) === "*") {
                skipBlockComment(cursor);
                continue;
            }
            const line = cursor.line;
            if (char === '"' || char === "'") {
                cursor.next();
                return this.emit({kind: "string", value: this.readString(char), line});
            }
            if (char === "`") {
                cursor.next();
                const part = this.readTemplatePart();
                return this.emit({kind: "template", value: part.closed ? part.cooked : null, line});
            }
            if (char === "}" && this.braces.at(-1) === "template") {
                this.braces.pop();
                cursor.next();
                this.readTemplatePart();
                return this.emit({kind: "template", value: null, line});
            }
            if (char === "/" && this.regexAllowed() && this.readRegex()) return this.emit({kind: "regex", line});
            if (isJsWordChar(char)) {
                let value = "";
                while (isJsWordChar(cursor.peek())) value += cursor.next();
                return this.emit({kind: "word", value, line});
            }
            cursor.next();
            if (char === "{") this.braces.push("brace");
            else if (char === "}") this.braces.pop();
            return this.emit({kind: "punct", value: char, line});
        }
    }

    private emit(token: JsToken): JsToken {
        this.last = token;
        return token;
    }

    private skipLine(): void {
        while (!this.cursor.done && !isJsLineTerminator(this.cursor.peek())) this.cursor.next();
    }

    private regexAllowed(): boolean {
        const last = this.last;
        if (last === null) return true;
        if (last.kind === "punct") return last.value !== ")" && last.value !== "]";
        if (last.kind === "word") return REGEX_AFTER_WORDS.has(last.value);
        return false;
    }

    /** 光标在 `/` 上；读完正则与标志返回 true。行内没闭合时退回 `/`、返回 false，由调用方当作除号。 */
    private readRegex(): boolean {
        const cursor = this.cursor;
        if (cursor.index < this.regexScannedUntil) return false;
        const start = cursor.save();
        cursor.next();
        let inClass = false;
        while (!cursor.done && !isJsLineTerminator(cursor.peek())) {
            const char = cursor.next();
            if (char === "\\") {
                if (!isJsLineTerminator(cursor.peek())) cursor.next();
            } else if (char === "[") inClass = true;
            else if (char === "]") inClass = false;
            else if (char === "/" && !inClass) {
                while (isJsWordChar(cursor.peek())) cursor.next();
                return true;
            }
        }
        this.regexScannedUntil = cursor.index;
        cursor.restore(start);
        return false;
    }

    /** 光标在开引号之后。字符串里不能有没转义的换行：遇到换行就当它没闭合（null），换行之后照常分词。 */
    private readString(quote: string): string | null {
        const cursor = this.cursor;
        let value = "";
        while (!cursor.done) {
            const char = cursor.peek();
            if (char === "\n" || char === "\r") return null;
            cursor.next();
            if (char === quote) return value;
            value += char === "\\" ? consumeJsEscape(cursor) : char;
        }
        return null;
    }

    /** 光标在反引号或插值的 `}` 之后，读到反引号（`closed`）或下一个 `${` 为止；遇到 `${` 记下要回到模板字符串。 */
    private readTemplatePart(): {cooked: string; closed: boolean} {
        const cursor = this.cursor;
        let cooked = "";
        while (!cursor.done) {
            const char = cursor.next();
            if (char === "`") return {cooked, closed: true};
            if (char === "$" && cursor.peek() === "{") {
                cursor.next();
                this.braces.push("template");
                return {cooked, closed: false};
            }
            cooked += char === "\\" ? consumeJsEscape(cursor) : char;
        }
        return {cooked, closed: true};
    }
}

/** 记号流：看下一个、取下一个，并记住上一个取走的记号（判断 `foo.import` 这样的成员访问）。 */
class TokenStream {
    previous: JsToken | null = null;
    private ahead: JsToken | null | undefined;

    constructor(private readonly lexer: JsLexer) {}

    peek(): JsToken | null {
        if (this.ahead === undefined) this.ahead = this.lexer.next();
        return this.ahead;
    }

    take(): JsToken | null {
        const token = this.peek();
        this.ahead = undefined;
        this.previous = token;
        return token;
    }
}

function isPunct(token: JsToken | null, value: string): boolean {
    return token?.kind === "punct" && token.value === value;
}

/**
 * import 或 export 之后的子句（`x`、`* as ns`、`{a, b as c, "d-e" as f}` 与它们用逗号连起来）一直到 `from "…"`，返回地址。
 * 遇到不属于子句的记号就放弃且不取走它，外层从这个记号接着找：每个记号只看一次。`import`、`export` 总是放弃，
 * 不写分号时 `export {a}` 后面紧跟的下一条 import 不会被吞掉。
 */
function clauseSource(stream: TokenStream): string | null {
    let inBraces = false;
    let afterBraces = false;
    for (;;) {
        const token = stream.peek();
        if (token === null) return null;
        if (token.kind === "word" && (token.value === "import" || token.value === "export")) return null;
        if (afterBraces && !(token.kind === "word" && token.value === "from")) return null;
        if (token.kind === "word") {
            stream.take();
            const source = stream.peek();
            if (token.value === "from" && !inBraces && source?.kind === "string") {
                stream.take();
                return source.value;
            }
        } else if (token.kind === "string" && inBraces) {
            stream.take();
        } else if (isPunct(token, "*") || isPunct(token, ",")) {
            stream.take();
        } else if (isPunct(token, "{") && !inBraces) {
            inBraces = true;
            stream.take();
        } else if (isPunct(token, "}") && inBraces) {
            inBraces = false;
            afterBraces = true;
            stream.take();
        } else {
            return null;
        }
    }
}

/** `import` 之后：`import("…")`（字面量参数，可以有第二个参数）、`import "…"` 或带子句的静态 import。`import.meta` 不算。 */
function importSource(stream: TokenStream): string | null {
    const next = stream.peek();
    if (next?.kind === "string") {
        stream.take();
        return next.value;
    }
    if (!isPunct(next, "(")) return clauseSource(stream);
    stream.take();
    const argument = stream.peek();
    if ((argument?.kind !== "string" && argument?.kind !== "template") || argument.value === null) return null;
    stream.take();
    const after = stream.peek();
    return isPunct(after, ")") || isPunct(after, ",") ? argument.value : null;
}

/** `export` 之后只有 `export * from`、`export {…} from` 是再导出。 */
function reexportSource(stream: TokenStream): string | null {
    const next = stream.peek();
    return isPunct(next, "*") || isPunct(next, "{") ? clauseSource(stream) : null;
}

/**
 * 脚本（`.js`、`.mjs`、内联的 `<script type="module">`）里字面量的 import 地址；注释、字符串与模板字符串里写的不算，
 * 记号之间可以夹注释（`import /* x *\/ "./lib.js"`）。
 * 只留浏览器会按路径或地址解析的：`./`、`../`、`/` 开头的与带协议的；裸模块名（`vue`）要靠 import map，不是产物里的文件。
 */
export function scriptImports(text: string): TextReference[] {
    const stream = new TokenStream(new JsLexer(text));
    const found: TextReference[] = [];
    while (stream.peek() !== null) {
        const before = stream.previous;
        const token = stream.take()!;
        if (token.kind !== "word" || isPunct(before, ".")) continue;
        const source = token.value === "import" ? importSource(stream) : token.value === "export" ? reexportSource(stream) : null;
        if (source !== null && /^(?:\.{1,2}\/|\/|[a-z][a-z0-9+.-]*:)/iu.test(source)) found.push({target: source, lineOffset: token.line});
    }
    return found;
}
