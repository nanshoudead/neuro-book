#!/usr/bin/env bun
/**
 * w00030 t02 的临时工具，Task 完成后删除（见 .agents/works/w00030-nb-ui-library-structure/tasks/t02-tailwind-unify/plan.md）。
 *
 * 用迁移前 neuro-book 的 UnoCSS 配置（presetWind3 + presetIcons，`.vue` 与 `.ts` 都抽类名）和 Tailwind v4 分别编译同一批
 * 源码，按类名对比，写出三份清单：
 * - missing.txt：UnoCSS 产出、Tailwind 没产出的类；
 * - changed.txt：两边都有、但会改观感的属性（字号、行高、字体、圆角、阴影、轮廓、滤镜）声明不同的类；
 * - tw-only.txt：只有 Tailwind 产出的类。
 *
 *   bun scripts/nb-ui/tailwind-migration/compare-classes.ts --out <目录> [--src packages/neuro-book/src] [--tw-entry <css>]
 *
 * `--tw-entry` 缺省时用 Tailwind 自带的 theme 与 utilities 加 nb-ui 的图标插件（迁移前的情形）；宿主改用 Tailwind 之后传
 * 宿主的入口（例如 packages/neuro-book/src/web/tailwind.css），这样 `text-sm` 等取到 nb-ui 的 token。两边只看 `--src`
 * 下的非测试源码，入口里的 `@source` 不参与，所以清单只反映应用自己写的类。UnoCSS 在 neuro-book 删掉依赖后仍可从旧应用
 * 的依赖里加载，迁移后照样能跑。
 */
import {mkdir, writeFile} from "node:fs/promises";
import {dirname, extname, join, resolve} from "node:path";

import presetIcons from "@unocss/preset-icons";
import presetWind3 from "@unocss/preset-wind3";
import {createGenerator} from "@unocss/core";
import {compile} from "@tailwindcss/node";
import {Scanner} from "@tailwindcss/oxide";
import postcss from "postcss";

const repoRoot = resolve(import.meta.dir, "../../..");

type Options = {src: string; twEntry: string | null; out: string};

function parseArgs(args: readonly string[]): Options {
    const options: Options = {src: join(repoRoot, "packages/neuro-book/src"), twEntry: null, out: ""};
    for (let index = 0; index < args.length; index += 2) {
        const value = args[index + 1];
        if (value === undefined) throw new Error(`${args[index]} 缺少取值`);
        switch (args[index]) {
            case "--src": options.src = resolve(value); break;
            case "--tw-entry": options.twEntry = resolve(value); break;
            case "--out": options.out = resolve(value); break;
            default: throw new Error(`未知参数：${args[index]}`);
        }
    }
    if (options.out === "") throw new Error("缺少 --out");
    return options;
}

/** 应用源码：Vite 只编译页面导入到的模块，测试文件不在其中，所以排除。 */
async function sourceFiles(src: string): Promise<Array<{file: string; content: string}>> {
    const files: Array<{file: string; content: string}> = [];
    for await (const path of new Bun.Glob("**/*.{vue,ts}").scan({cwd: src, absolute: true})) {
        if (/\.(?:test|e2e)\.ts$/u.test(path)) continue;
        files.push({file: path, content: await Bun.file(path).text()});
    }
    return files.sort((a, b) => a.file.localeCompare(b.file));
}

async function unoCss(files: ReadonlyArray<{file: string; content: string}>): Promise<string> {
    const uno = await createGenerator({presets: [presetWind3(), presetIcons()]});
    const tokens = new Set<string>();
    for (const {file, content} of files) await uno.applyExtractors(content, file, tokens);
    return (await uno.generate(tokens, {preflights: false})).css;
}

/** 迁移前的 Tailwind 入口：没有宿主入口时，取 Tailwind 的缺省主题与 nb-ui 同样的图标插件写法。 */
const DEFAULT_ENTRY = `@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
@plugin "@iconify/tailwind4" { prefixes: lucide; iconSelector: ".i-{prefix}-{name}"; prefix: false; }
`;

async function tailwindCss(files: ReadonlyArray<{file: string; content: string}>, entry: string | null): Promise<string> {
    const css = entry === null ? DEFAULT_ENTRY : await Bun.file(entry).text();
    // 缺省入口按 nb-ui 包解析：@iconify/tailwind4 是它的依赖。
    const base = entry === null ? join(repoRoot, "packages/nb-ui/src") : dirname(entry);
    const compiler = await compile(css, {base, onDependency: () => {}});
    const scanner = new Scanner({});
    const candidates = scanner.scanFiles(files.map(({content, file}) => ({content, extension: extname(file).slice(1)})));
    return compiler.build(candidates);
}

/** 类名 → 声明（`属性:值`）。同一类出现在多条规则（例如带媒体查询）时合并。 */
function classDeclarations(css: string): Map<string, string[]> {
    const map = new Map<string, string[]>();
    postcss.parse(css).walkRules((rule) => {
        for (const selector of rule.selectors) {
            const match = /\.((?:\\.|[\w-])+)/u.exec(selector);
            if (match === null) continue;
            const name = match[1]!.replace(/\\(.)/gu, "$1");
            const declarations: string[] = [];
            rule.walkDecls((decl) => {
                declarations.push(`${decl.prop}:${decl.value.replace(/\s+/gu, " ")}`);
            });
            map.set(name, [...map.get(name) ?? [], ...declarations]);
        }
    });
    return map;
}

/** Tailwind 输出里 `:root, :host` 上的主题变量，用来把 `var(--text-sm)` 这类引用换成实际值再比。 */
function themeVariables(css: string): Map<string, string> {
    const variables = new Map<string, string>();
    postcss.parse(css).walkRules((rule) => {
        if (!rule.selectors.some((selector) => selector === ":root" || selector === ":host")) return;
        rule.walkDecls((decl) => {
            if (decl.prop.startsWith("--")) variables.set(decl.prop, decl.value.replace(/\s+/gu, " ").trim());
        });
    });
    // `--tw-outline-style` 这类分量变量不在主题里，缺省值写在 `@property` 的 initial-value。
    postcss.parse(css).walkAtRules("property", (rule) => {
        rule.walkDecls("initial-value", (decl) => {
            if (!variables.has(rule.params)) variables.set(rule.params, decl.value.trim());
        });
    });
    return variables;
}

/** 展开 `var(--x, 缺省)`：主题里有的取主题值，没有的取缺省（`--tw-leading` 这类只在用了别的类时才设）。 */
function resolveVars(value: string, variables: ReadonlyMap<string, string>, depth = 0): string {
    if (depth > 8) return value;
    let result = "";
    let index = 0;
    while (index < value.length) {
        const start = value.indexOf("var(", index);
        if (start === -1) {
            result += value.slice(index);
            break;
        }
        result += value.slice(index, start);
        let level = 0;
        let end = start + 3;
        for (; end < value.length; end += 1) {
            if (value[end] === "(") level += 1;
            if (value[end] === ")" && --level === 0) break;
        }
        const inner = value.slice(start + 4, end);
        const comma = inner.indexOf(",");
        const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
        const fallback = comma === -1 ? null : inner.slice(comma + 1).trim();
        const resolved = variables.get(name) ?? fallback;
        // 引用的不是主题变量、也没有缺省值的（例如宿主自己的 `--radius-control`），原样保留。
        result += resolved === null ? value.slice(start, end + 1) : resolveVars(resolved, variables, depth + 1);
        index = end + 1;
    }
    return result;
}

/** rem 换成 px，`calc(<长度> * <数>)` 算出来，两边的写法差异不算差异。 */
function normalizeValue(value: string): string {
    let result = value.replace(/(-?\d*\.?\d+)rem\b/gu, (_, number: string) => `${Number(number) * 16}px`);
    result = result.replace(/calc\(\s*(-?\d*\.?\d+)px\s*\*\s*(-?\d*\.?\d+)\s*\)/gu, (_, length: string, factor: string) => `${Number(length) * Number(factor)}px`);
    result = result.replace(/calc\(\s*(-?\d*\.?\d+)\s*\/\s*(-?\d*\.?\d+)\s*\)/gu, (_, a: string, b: string) => String(Number(a) / Number(b)));
    // UnoCSS 的阴影每段前面有一个缺省为空的 `--un-shadow-inset`；字体栈的引号两边写法不同。
    result = result.replace(/var\(--tw-shadow-inset\)\s*/gu, "").replace(/'/gu, "\"");
    return result.replace(/calc\(infinity \* 1px\)/gu, "9999px").replace(/\s+/gu, " ").replace(/,\s*/gu, ",").trim();
}

/**
 * 会改观感、迁移时要逐个确认的属性；位置、颜色这类同名同值，不比。阴影与滤镜两边都写成“组合属性 + 分量变量”，
 * 组合属性只是拼接分量，所以只比分量变量（UnoCSS 的 `--un-*` 对应 Tailwind 的 `--tw-*`）。
 */
const WATCHED = ["font-size", "line-height", "font-family", "border-radius", "--tw-shadow", "outline-style", "outline", "--tw-blur", "--tw-backdrop-blur"];

function watched(declarations: readonly string[], variables: ReadonlyMap<string, string>): string[] {
    const picked = new Set<string>();
    for (const declaration of declarations) {
        const colon = declaration.indexOf(":");
        const prop = declaration.slice(0, colon).replace(/^--un-/u, "--tw-");
        if (!WATCHED.includes(prop)) continue;
        const value = resolveVars(declaration.slice(colon + 1), variables).replace(/--un-/gu, "--tw-");
        picked.add(`${prop}:${normalizeValue(value)}`);
    }
    // 行高一边写像素、一边写相对字号的倍数：有字号时都折成像素再比。
    const fontSize = [...picked].find((entry) => entry.startsWith("font-size:"))?.match(/^font-size:(\d*\.?\d+)px$/u)?.[1];
    return [...picked].map((entry) => {
        const ratio = /^line-height:(\d*\.?\d+)$/u.exec(entry)?.[1];
        return fontSize !== undefined && ratio !== undefined ? `line-height:${Math.round(Number(ratio) * Number(fontSize) * 100) / 100}px` : entry;
    }).sort();
}

const options = parseArgs(process.argv.slice(2));
const files = await sourceFiles(options.src);
const uno = classDeclarations(await unoCss(files));
const twCss = await tailwindCss(files, options.twEntry);
const tw = classDeclarations(twCss);
const variables = themeVariables(twCss);

const missing = [...uno.keys()].filter((name) => !tw.has(name)).sort();
const twOnly = [...tw.keys()].filter((name) => !uno.has(name)).sort();
const changed: string[] = [];
for (const [name, declarations] of uno) {
    const other = tw.get(name);
    if (other === undefined) continue;
    const before = watched(declarations, new Map());
    const after = watched(other, variables);
    if (before.join(";") !== after.join(";")) changed.push(`${name}\n  uno: ${before.join(" ; ")}\n  tw : ${after.join(" ; ")}`);
}

await mkdir(options.out, {recursive: true});
await writeFile(join(options.out, "missing.txt"), `${missing.join("\n")}\n`);
await writeFile(join(options.out, "changed.txt"), `${changed.join("\n")}\n`);
await writeFile(join(options.out, "tw-only.txt"), `${twOnly.join("\n")}\n`);

const icons = missing.filter((name) => name.startsWith("i-"));
console.log(`源码 ${files.length} 个文件；UnoCSS ${uno.size} 个类，Tailwind ${tw.size} 个类`);
console.log(`Tailwind 没产出：${missing.length}（其中图标 ${icons.length}）；属性不同：${changed.length}；只有 Tailwind 有：${twOnly.length}`);
console.log(`清单：${options.out}`);
