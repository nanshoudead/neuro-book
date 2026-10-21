#!/usr/bin/env bun
/**
 * w00030 t02 的临时工具，Task 完成后删除。
 *
 * 样式分层以后，谁赢不再看特异性与先后，而是先看层：unlayered > utilities > components > base。本工具列出结果会因此翻转的
 * 三类地方，供逐处核对：
 *
 * A. nb-ui 里同一元素（或同一个类名字符串）上，语义类（styles.css，将进 components 层）与原子类（utilities 层）设了同一属性：
 *    以前语义类靠排在后面或特异性更高赢，分层后原子类赢。
 * B. 不分层的样式里，特异性低于一个类的规则（只有元素、通配、`:where()`）：以前输给原子类，分层后赢过所有原子类。
 *    扫描 neuro-book、nb-story、dev-panel、nb-ui 的 `.css` 与 `.vue` 里不带 scoped 的 `<style>`；nb-ui 将进层的
 *    styles.css、tokens.css、tailwind.css 不算。
 * C. styles.css 里与 Tailwind 原子类同名的类（例如 `.animate-pulse`）：分层后原子类那份赢。
 *
 *   bun scripts/nb-ui/tailwind-migration/scan-layer-conflicts.ts
 */
import {readFile} from "node:fs/promises";
import {join, relative} from "node:path";

import {__unstable__loadDesignSystem} from "@tailwindcss/node";
import {Scanner} from "@tailwindcss/oxide";
import {parse as parseSfc} from "@vue/compiler-sfc";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

const repoRoot = join(import.meta.dir, "../../..");
const nbUiSrc = join(repoRoot, "packages/nb-ui/src");
/** 将进层的 nb-ui 样式，不算 B 类。 */
const LAYERED = new Set(["styles.css", "tokens.css", "tailwind.css"].map((name) => join(nbUiSrc, name)));

// ---------- 属性归一：简写展开成逐边、逐角的长写，两边写法不同也能对上 ----------

const SIDES = ["top", "right", "bottom", "left"];
const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"];

function longhands(prop: string): string[] {
    if (prop.startsWith("--")) return [];
    const boxed = /^(padding|margin)(?:-(top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end))?$/u.exec(prop);
    if (boxed !== null) return sidesOf(boxed[2]).map((side) => `${boxed[1]}-${side}`);
    if (prop === "inset") return SIDES;
    if (prop === "inset-inline") return ["left", "right"];
    if (prop === "inset-block") return ["top", "bottom"];
    const border = /^border(?:-(top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end))?(?:-(width|style|color))?$/u.exec(prop);
    if (border !== null) {
        const parts = border[2] === undefined ? ["width", "style", "color"] : [border[2]];
        return sidesOf(border[1]).flatMap((side) => parts.map((part) => `border-${side}-${part}`));
    }
    if (prop === "border-radius") return CORNERS.map((corner) => `border-${corner}-radius`);
    if (prop === "outline") return ["outline-width", "outline-style", "outline-color"];
    if (prop === "gap") return ["row-gap", "column-gap"];
    if (prop === "background") return ["background-color", "background-image"];
    if (prop === "overflow") return ["overflow-x", "overflow-y"];
    if (prop === "transition") return ["transition-property", "transition-duration", "transition-timing-function"];
    return [prop];
}

function sidesOf(side: string | undefined): string[] {
    switch (side) {
        case undefined: return SIDES;
        case "inline": return ["left", "right"];
        case "block": return ["top", "bottom"];
        case "inline-start": return ["left"];
        case "inline-end": return ["right"];
        case "block-start": return ["top"];
        case "block-end": return ["bottom"];
        default: return [side];
    }
}

// ---------- 语义类：styles.css 里每个类作为选择器主体时设了哪些属性 ----------

type SemanticRule = {selector: string; props: Set<string>};

async function semanticClasses(): Promise<Map<string, SemanticRule[]>> {
    const css = await readFile(join(nbUiSrc, "styles.css"), "utf8");
    const map = new Map<string, SemanticRule[]>();
    postcss.parse(css).walkRules((rule) => {
        if (rule.parent?.type === "atrule" && /keyframes$/u.test((rule.parent as postcss.AtRule).name)) return;
        const props = new Set<string>();
        rule.each((node) => {
            if (node.type === "decl") longhands(node.prop).forEach((prop) => props.add(prop));
        });
        if (props.size === 0) return;
        for (const selector of rule.selectors) {
            // 只取选择器最后一段（主体）上的类：`.a > .b` 设的是 `.b` 那个元素。
            const subject = selector.split(/\s*[>+~\s]\s*/u).at(-1) ?? "";
            for (const match of subject.matchAll(/\.([\w-]+)/gu)) {
                const name = match[1]!;
                map.set(name, [...map.get(name) ?? [], {selector, props}]);
            }
        }
    });
    return map;
}

// ---------- 原子类：逐个候选编译，取它设的属性 ----------

/** 只要 Tailwind 的主题与原子类加图标插件：`candidatesToCss` 每次只编一个候选，不像 `build` 那样累积前面编过的。 */
const UTILITY_ENTRY = `@import "tailwindcss/theme.css";
@import "tailwindcss/utilities.css";
@plugin "@iconify/tailwind4" { prefixes: lucide; iconSelector: ".i-{prefix}-{name}"; prefix: false; }
`;

async function utilityCompiler(): Promise<(candidate: string) => Set<string>> {
    const design = await __unstable__loadDesignSystem(UTILITY_ENTRY, {base: nbUiSrc});
    const cache = new Map<string, Set<string>>();
    return (candidate) => {
        const cached = cache.get(candidate);
        if (cached !== undefined) return cached;
        const props = new Set<string>();
        const css = design.candidatesToCss([candidate])[0];
        if (css !== null && css !== undefined) postcss.parse(css).walkDecls((decl) => longhands(decl.prop).forEach((prop) => props.add(prop)));
        cache.set(candidate, props);
        return props;
    };
}

// ---------- A：模板与脚本里的类名组 ----------

type ClassGroup = {file: string; line: number; tokens: string[]};

/** 模板里每个元素的静态 class 与 :class 里的字符串字面量算一组；脚本与 .ts 里每个含 `nb-ui-` 的字符串字面量算一组。 */
async function classGroups(): Promise<ClassGroup[]> {
    const groups: ClassGroup[] = [];
    const scanner = new Scanner({});
    const tokensOf = (text: string): string[] => scanner.scanFiles([{content: text, extension: "html"}]);
    for await (const file of new Bun.Glob("{components,composables}/**/*.{vue,ts}").scan({cwd: nbUiSrc, absolute: true})) {
        if (/\.test\.ts$/u.test(file)) continue;
        const source = await readFile(file, "utf8");
        const lineOf = (offset: number): number => source.slice(0, offset).split("\n").length;
        if (file.endsWith(".vue")) {
            const {descriptor} = parseSfc(source, {filename: file});
            const template = descriptor.template;
            if (template !== null) {
                const offset = template.loc.start.offset;
                // 一个元素的开始标签：从 `<名字` 到 `>`，跨行；属性值里的 `>` 只会出现在 :class 的表达式里，按引号跳过。
                for (const tag of template.content.matchAll(/<[A-Za-z][\w.-]*(?:\s+(?:[^"'>]|"[^"]*"|'[^']*')*)?\/?>/gu)) {
                    const text = tag[0];
                    const parts: string[] = [];
                    for (const attr of text.matchAll(/(?:^|\s)(:class|v-bind:class|class)="([^"]*)"/gu)) {
                        parts.push(attr[1] === "class" ? attr[2]! : [...attr[2]!.matchAll(/['`]([^'`]*)['`]/gu)].map((literal) => literal[1]).join(" "));
                    }
                    if (parts.length === 0) continue;
                    groups.push({file, line: lineOf(offset + tag.index!), tokens: tokensOf(parts.join(" "))});
                }
            }
            for (const block of [descriptor.script, descriptor.scriptSetup]) {
                if (block === null) continue;
                literalGroups(block.content, (index) => lineOf(block.loc.start.offset + index), file, tokensOf, groups);
            }
        } else {
            literalGroups(source, lineOf, file, tokensOf, groups);
        }
    }
    return groups;
}

function literalGroups(code: string, lineOf: (index: number) => number, file: string, tokensOf: (text: string) => string[], groups: ClassGroup[]): void {
    for (const literal of code.matchAll(/(["'`])((?:(?!\1)[^\\]|\\.)*?nb-ui-(?:(?!\1)[^\\]|\\.)*)\1/gu)) {
        groups.push({file, line: lineOf(literal.index!), tokens: tokensOf(literal[2]!)});
    }
}

// ---------- B：不分层样式里特异性低于一个类的规则 ----------

type LowRule = {file: string; line: number; selector: string; props: string[]};

function belowOneClass(selector: string): boolean {
    let ids = 0;
    let classes = 0;
    selectorParser((root) => {
        root.walk((node) => {
            // :where() 里的一切都不计特异性；:is()/:not()/:has() 取参数，这里按参数里出现的类近似。
            if (node.type === "pseudo" && node.value === ":where") {
                node.nodes.length = 0;
                return;
            }
            if (node.type === "id") ids += 1;
            if (node.type === "class" || node.type === "attribute") classes += 1;
            if (node.type === "pseudo" && !node.value.startsWith("::") && !/^:(?:is|not|has)$/u.test(node.value)) classes += 1;
        });
    }).processSync(selector);
    return ids === 0 && classes === 0;
}

async function lowSpecificityRules(): Promise<LowRule[]> {
    const found: LowRule[] = [];
    const packages = ["neuro-book/src", "nb-story/src", "dev-panel/src", "nb-ui/src", "nb-ui/playground"].map((path) => join(repoRoot, "packages", path));
    for (const root of packages) {
        for await (const file of new Bun.Glob("**/*.{css,vue}").scan({cwd: root, absolute: true})) {
            if (LAYERED.has(file) || file.includes("/node_modules/") || file.includes("/.nuxt/") || file.includes("/.output/")) continue;
            const source = await readFile(file, "utf8");
            const blocks: Array<{css: string; offset: number}> = [];
            if (file.endsWith(".css")) {
                blocks.push({css: source, offset: 0});
            } else {
                for (const style of parseSfc(source, {filename: file}).descriptor.styles) {
                    if (!style.scoped && style.module === undefined) blocks.push({css: style.content, offset: style.loc.start.offset});
                }
            }
            for (const block of blocks) {
                const lineBase = source.slice(0, block.offset).split("\n").length - 1;
                postcss.parse(block.css).walkRules((rule) => {
                    if (rule.parent?.type === "atrule" && /keyframes$/u.test((rule.parent as postcss.AtRule).name)) return;
                    // 已经写在某个层里的规则不算。
                    for (let parent = rule.parent; parent !== undefined && parent.type !== "root"; parent = parent.parent) {
                        if (parent.type === "atrule" && (parent as postcss.AtRule).name === "layer") return;
                    }
                    const props = rule.nodes.filter((node): node is postcss.Declaration => node.type === "decl" && !node.prop.startsWith("--")).map((node) => node.prop);
                    if (props.length === 0) return;
                    const low = rule.selectors.filter(belowOneClass);
                    if (low.length === 0) return;
                    found.push({file, line: lineBase + (rule.source?.start?.line ?? 1), selector: low.join(", "), props});
                });
            }
        }
    }
    return found;
}

// ---------- 输出 ----------

const rel = (file: string): string => relative(repoRoot, file);
const semantic = await semanticClasses();
const utilityProps = await utilityCompiler();

console.log("## A. 同一元素上语义类与原子类设同一属性（分层后原子类赢）\n");
let countA = 0;
for (const group of await classGroups()) {
    const semantics = group.tokens.filter((token) => semantic.has(token.split(":").at(-1)!));
    if (semantics.length === 0) continue;
    const utilities = group.tokens.filter((token) => !semantic.has(token.split(":").at(-1)!) && !token.startsWith("nb-") && !token.startsWith("i-"));
    for (const name of semantics) {
        for (const rule of semantic.get(name.split(":").at(-1)!)!) {
            for (const utility of utilities) {
                const overlap = [...utilityProps(utility)].filter((prop) => rule.props.has(prop));
                if (overlap.length === 0) continue;
                countA += 1;
                console.log(`- ${rel(group.file)}:${group.line}  \`${utility}\` × \`${rule.selector}\`：${[...new Set(overlap.map((prop) => prop.replace(/-(?:top|right|bottom|left)(?=-|$)|-(?:top|bottom)-(?:left|right)(?=-)/gu, "")))].join("、")}`);
            }
        }
    }
}

console.log(`\n## B. 不分层、特异性低于一个类的规则（分层后赢过原子类）\n`);
const low = await lowSpecificityRules();
for (const rule of low) console.log(`- ${rel(rule.file)}:${rule.line}  \`${rule.selector}\`：${rule.props.join("、")}`);

console.log(`\n## C. styles.css 里与 Tailwind 原子类同名的类（分层后原子类那份赢）\n`);
let countC = 0;
for (const name of semantic.keys()) {
    if (utilityProps(name).size === 0) continue;
    countC += 1;
    console.log(`- \`.${name}\``);
}

console.log(`\nA ${countA} 条，B ${low.length} 条，C ${countC} 条`);
