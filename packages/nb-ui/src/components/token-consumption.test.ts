import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vitest";

import {nbColorwayVarKeys} from "../colorway/colorway-contract";
import {nbTypographyTokens} from "../theme/tokens";

/**
 * 组件 token 消费静态扫描（Task 150）。
 *
 * 守的是 design-language.md / ui-development-spec.md 里「可被机械检查」的那几条：
 * 1. 控件外框圆角只消费 token，不写 Tailwind 常量档（坑 #44：写死 rounded-md 会让
 *    --radius-control 成为死变量）。
 * 2. 动效只消费 --motion-* / --ease-standard，不写死时长或缓动（design-language.md 动效节）。
 * 3. 组件不写字面颜色（ui-development-spec §2.2；颜色来自配色变量或 token）。
 * 4. 禁 transition-all / transition: all（属性列表必须显式，动效节禁条）。
 * 5. 排版 token 写进 `text-` 时带 `length:` 类型提示：Tailwind v4 与 UnoCSS 都把方括号里不带提示的 `var()`
 *    当成颜色，`text-[var(--text-xs)]` 编译成 `color: var(--text-xs)`，字号没设上，颜色也作废。
 * 6. 排版 token 不写进 `font-[…]`：Tailwind v4 把 `font-[var(--weight-medium)]` 当字重，UnoCSS 当字体族
 *    （`font-family: var(--weight-medium)`），带类型提示也一样；用任意属性 `[font-weight:var(--weight-*)]`。
 * 7. 组件与 `styles.css` 里 `var(--x)` 的 x 必须有声明：`theme.css`、`tokens.css`、`styles.css`、配色契约，或组件自己（样式、
 *    Tailwind 任意属性、`:style` 的键、`style.setProperty`）。没有声明的变量在计算值阶段无效，整条声明退回初始值，不报任何错
 *    （`--overlay-scrim` 曾让 AlertDialog 与 Drawer 的遮罩完全没有压暗）。宿主可选的覆盖点登记在 HOST_HOOK_VARS。
 *
 * 凡是「扫源码找有没有出现 X」的断言都必须先剥注释——本仓同一形状的坑已经踩过两次
 * （见 theme-packages.test.ts 里 readVarsDeclarations 的注释），扫的是代码不是散文。
 *
 * 每条规则合入前做过红翻转：临时把真违规塞回组件，确认对应规则报错后再还原。
 */

const COMPONENTS_DIR = import.meta.dirname;

/** 规则 1 的豁免清单。只收坑 #44 判断里明确「保留各自圆角」的表面，每个都必须有理由。 */
const LITERAL_RADIUS_ALLOWLIST = new Map<string, string>([
    ["display/Skeleton.vue", "坑 #44：Skeleton 保留各自圆角，不纳入控件圆角判据"],
    ["feedback/Notification.vue", "坑 #44：Notification 保留各自圆角，不纳入控件圆角判据"],
]);

const LITERAL_COLOR_ALLOWLIST = new Map<string, string>([
    ["form/ColorPickerPanel.vue", "取色面板读不懂传入的颜色时要落回一个具体颜色，是取色器本身的需要"],
]);

const LITERAL_COLOR_VALUE_ALLOWLIST = new Map<string, ReadonlySet<string>>([
    ["form/Checkbox.vue", new Set(["#000000"])],
]);

/** 规则 7 的豁免：组件读、库里不声明、由宿主按需设置的变量。每个都带缺省值（`var(--x, 缺省)`），没设时组件照常工作。 */
const HOST_HOOK_VARS = new Map<string, string>([
    ["--nb-splitter-seam", "Splitter 接缝颜色，工作台外壳按卡片或平铺设置（Splitter.vue 的注释）"],
    ["--nb-splitter-seam-inset", "Splitter 接缝两端的缩进，缺省铺满"],
    ["--nb-popover-scroll-fade", "弹出列表顶底渐隐的高度，缺省 22px"],
]);

/** 规则 7 不管的前缀：reka 在运行时写到元素上的尺寸、Tailwind 自己的内部变量。 */
const RUNTIME_VAR_PREFIXES = ["--reka-", "--tw-"];

function collectVueFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...collectVueFiles(path));
        } else if (entry.name.endsWith(".vue")) {
            out.push(path);
        }
    }
    return out;
}

/** 剥掉 HTML 注释、块注释和整行 // 注释；用空白回填保持行号不漂移。 */
function stripComments(source: string): string {
    const blank = (text: string) => text.replace(/[^\n]/g, " ");
    return source
        .replace(/<!--[\s\S]*?-->/g, blank)
        .replace(/\/\*[\s\S]*?\*\//g, blank)
        .replace(/^[ \t]*\/\/.*$/gm, blank);
}

/**
 * 规则 5 的匹配式：`text-[var(--<排版 token>…)]` 与 v4 简写 `text-(--<排版 token>)`。名单取自 nbTypographyTokens，
 * 新增字号档不用改这里；配色变量（`--text-main` 这类）不在名单里，写成 `text-[var(--text-main)]` 当颜色是对的。
 */
const UNTYPED_TYPOGRAPHY_TEXT = new RegExp(String.raw`\btext-(?:\[var\(|\()(?:${nbTypographyTokens.join("|")})(?=[,)])`);

/** 规则 6 的匹配式：`font-[var(--<排版 token>…)]`、`font-(--<排版 token>)`，以及它们带类型提示的写法。 */
const TYPOGRAPHY_IN_FONT_UTILITY = new RegExp(String.raw`\bfont-(?:\[(?:[a-z-]+:)?var\(|\((?:[a-z-]+:)?)(?:${nbTypographyTokens.join("|")})(?=[,)])`);

interface Rule {
    name: string;
    pattern: RegExp;
    reason: string;
    allowlist?: Map<string, string>;
}

const RULES: Rule[] = [
    {
        name: "控件圆角只消费 token",
        pattern: /\brounded-(?:sm|md|lg|xl|2xl|3xl)\b/,
        reason: "写死的圆角常量档不随主题（坑 #44）；控件外框用 rounded-[var(--radius-control)]",
        allowlist: LITERAL_RADIUS_ALLOWLIST,
    },
    {
        name: "动效时长只消费 --motion-*",
        pattern: /\bduration-\[?\d|\b\d+(?:\.\d+)?m?s\b/,
        reason: "写死的时长不随主题（design-language.md 动效节）；用 var(--motion-fast/base/enter)",
    },
    {
        name: "缓动只消费 --ease-standard",
        pattern: /cubic-bezier\(/,
        reason: "组件不得写 cubic-bezier 字面量（design-language.md 动效节）",
    },
    {
        name: "组件不写字面颜色",
        pattern: /#[0-9a-fA-F]{3,8}\b|\brgba?\(/,
        reason: "颜色来自配色变量或 token（ui-development-spec §2.2）",
        allowlist: LITERAL_COLOR_ALLOWLIST,
    },
    {
        name: "禁 transition-all",
        pattern: /\btransition-all\b|transition\s*:\s*all\b/,
        reason: "transition 属性列表必须显式（design-language.md 动效节）",
    },
    {
        name: "浮层材质统一走 token 与 composable，禁内联写死 backdropFilter/boxShadow/surface",
        pattern: /\b(?:backdropFilter|WebkitBackdropFilter)\s*:|\bbackgroundColor\s*:\s*['"]color-mix\(in srgb, var\(--bg-panel\)/,
        reason: "浮层材质必须统一消费 --overlay-surface / --overlay-blur / --elevation-popover ，或 usePopoverLayer.ts 里登记的内联材质（ui-development-spec §9）",
    },
    {
        name: "字号类带 length: 类型提示",
        pattern: UNTYPED_TYPOGRAPHY_TEXT,
        reason: "不带类型提示的 var() 被当成颜色，编译出 color: var(--text-xs)、字号没设上；写 text-[length:var(--text-xs)]",
    },
    {
        name: "字重与字体族用任意属性写",
        pattern: TYPOGRAPHY_IN_FONT_UTILITY,
        reason: "font-[var(--weight-*)] 在 UnoCSS 里编译成 font-family；写 [font-weight:var(--weight-*)] 或 [font-family:var(--font-*)]",
    },
];

function violationsFor(rule: Rule, files: string[]): string[] {
    const violations: string[] = [];
    for (const path of files) {
        const rel = join(path).slice(COMPONENTS_DIR.length + 1).replaceAll("\\", "/");
        if (rule.allowlist?.has(rel)) {
            continue;
        }
        const allowedValues = rule.name === "组件不写字面颜色" ? LITERAL_COLOR_VALUE_ALLOWLIST.get(rel) : undefined;
        const lines = stripComments(readFileSync(path, "utf-8")).split("\n");
        lines.forEach((line, index) => {
            const match = line.match(rule.pattern);
            if (match && !allowedValues?.has(match[0])) {
                violations.push(`${rel}:${index + 1} 命中「${match[0]}」——${rule.reason}`);
            }
        });
    }
    return violations;
}

describe("组件 token 消费静态扫描", () => {
    const files = collectVueFiles(COMPONENTS_DIR);
    // 本文件也是 .test.ts 不是 .vue，不在扫描面内；规则样例都写在上面的注释里，不会被自己绊倒

    for (const rule of RULES) {
        it(rule.name, () => {
            expect(violationsFor(rule, files)).toEqual([]);
        });
    }

    it("字号类的检查认得出不带类型提示的写法，放过带提示的与配色变量", () => {
        const untyped = ["text-[var(--text-xs)]", "hover:text-[var(--text-sm)]", "text-[var(--text-2xs,11px)]", "text-(--text-md)"];
        const typed = ["text-[length:var(--text-xs)]", "text-(length:--text-xs)", "text-[var(--text-main)]", "text-[var(--text-muted)]", "text-[var(--text-secondary)]"];
        expect(untyped.filter((sample) => !UNTYPED_TYPOGRAPHY_TEXT.test(sample))).toEqual([]);
        expect(typed.filter((sample) => UNTYPED_TYPOGRAPHY_TEXT.test(sample))).toEqual([]);
    });

    it("字重类的检查认得出 font-[…] 里的排版 token，放过任意属性写法与常量档", () => {
        const flagged = ["font-[var(--weight-medium)]", "data-[selected]:font-[var(--weight-medium)]", "font-[number:var(--weight-strong)]", "font-(--weight-strong)", "font-[var(--font-mono)]"];
        const allowed = ["[font-weight:var(--weight-medium)]", "data-[selected]:[font-weight:var(--weight-medium)]", "[font-family:var(--font-mono)]", "font-medium", "font-mono"];
        expect(flagged.filter((sample) => !TYPOGRAPHY_IN_FONT_UTILITY.test(sample))).toEqual([]);
        expect(allowed.filter((sample) => TYPOGRAPHY_IN_FONT_UTILITY.test(sample))).toEqual([]);
    });

    it("用到的 CSS 变量都有声明", () => {
        const stylesheets = ["../theme.css", "../tokens.css", "../styles.css"].map((rel) => join(COMPONENTS_DIR, rel));
        const sources = [...stylesheets, ...files].map((path) => ({path, text: stripComments(readFileSync(path, "utf-8"))}));
        // 声明：样式里的 `--x:`、Tailwind 任意属性 `[--x:…]`、`:style` 对象的键 `"--x":`、`style.setProperty("--x", …)`
        const declared = new Set<string>(nbColorwayVarKeys);
        for (const {text} of sources) {
            for (const match of text.matchAll(/["']?(--[a-z0-9-]+)["']?\s*:|setProperty\(\s*["'](--[a-z0-9-]+)["']/g)) declared.add((match[1] ?? match[2])!);
        }
        const undeclared: string[] = [];
        for (const {path, text} of sources) {
            const rel = path.slice(COMPONENTS_DIR.length + 1).replaceAll("\\", "/");
            for (const match of text.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
                const name = match[1]!;
                if (declared.has(name) || HOST_HOOK_VARS.has(name) || RUNTIME_VAR_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
                undeclared.push(`${rel} 用了没有声明的 ${name}`);
            }
        }
        expect(undeclared).toEqual([]);
    });

    it("宿主覆盖点仍有组件在读（防止豁免变成死条目）", () => {
        const text = [join(COMPONENTS_DIR, "../styles.css"), ...files].map((path) => readFileSync(path, "utf-8")).join("\n");
        for (const name of HOST_HOOK_VARS.keys()) {
            expect(text.includes(`var(${name}`), `${name} 已没有组件读取，应从 HOST_HOOK_VARS 移除`).toBe(true);
        }
    });

    it("豁免清单里的文件仍然存在（防止豁免变成死条目）", () => {
        const existing = new Set(files.map((path) => join(path).slice(COMPONENTS_DIR.length + 1).replaceAll("\\", "/")));
        for (const rel of [...LITERAL_RADIUS_ALLOWLIST.keys(), ...LITERAL_COLOR_ALLOWLIST.keys(), ...LITERAL_COLOR_VALUE_ALLOWLIST.keys()]) {
            expect(existing.has(rel), `${rel} 已不存在，应从豁免清单移除`).toBe(true);
        }
    });
});
