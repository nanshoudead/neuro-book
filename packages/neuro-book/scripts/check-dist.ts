/**
 * 生产产物检查（ui.component-lab 场景 10）：`dist/` 里不能有开发插件（Lab）的代码，也不能带本机的绝对路径。
 * 同时要求产品自己的标记在场，证明扫描读到的是这次构建的真实产物，而不是空目录或换了位置的输出。首屏（入口脚本与它预加载的
 * chunk）里不能有 Markdown 的编辑内核与解析器（workspace.markdown-syntaxes 输出 2）。
 *
 *   bun run check:dist        # `bun run build` 的最后一步
 */

import {readdir, readFile} from "node:fs/promises";
import {join, relative, resolve} from "node:path";

import postcss from "postcss";
import type {AtRule, Rule} from "postcss";
import selectorParser from "postcss-selector-parser";

/**
 * 只出现在 Lab 代码里的字符串：插件 id、调试接口、偏好键前缀、外壳组件名、源码目录、DOM 标记与 Lab 自己的 CSS 变量名（`--lab-*`，样式入口没排除 Lab 目录时会经原子类进产物），以及组件文档的
 * frontmatter（`标签: [`）——Lab 经 `@notnotype/nb-ui/lab-sources` 把组件文档原文打进包，产品代码误引它时由这一项拦下。
 */
export const DEVELOPMENT_MARKERS = ["nbook.lab", "__nbLab", "nb-lab:", "LabShell", "plugins/lab/", "data-lab-", "--lab-", "标签: ["];

/** 产品代码一定有的字符串，按产物目录分。 */
export const PRODUCT_MARKERS: Readonly<Record<"web" | "server", ReadonlyArray<string>>> = {
    web: ["nbook.workbench", "data-workbench-root"],
    server: ["nbook.http", "Listening on"],
};

/**
 * 只出现在 ProseMirror 与 `marked` 里的字符串（压缩后字符串字面量还在）：它们进了首屏，说明有人在插件定义或首屏代码里
 * 静态引了 Markdown 的语法模块或编辑内核。
 */
export const FIRST_SCREEN_FORBIDDEN = ["Invalid content for node", "marked(): input parameter"];

/** 样式层的先后（ADR 0028）：调用方的原子类在 utilities 层，要排在 nb-ui 的 base 与 components 之后。 */
export const LAYER_ORDER = ["theme", "base", "components", "utilities"];

export interface DistReport {
    /** `<相对 dist 的文件>: <命中的字符串>`。 */
    readonly forbidden: string[];
    /** `<产物目录>: <缺少的产品标记>`。 */
    readonly missing: string[];
}

async function filesUnder(directory: string): Promise<string[]> {
    const entries = await readdir(directory, {withFileTypes: true, recursive: true});
    return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
}

/** `localPaths` 是不能出现在产物里的本机路径（仓库根等）。 */
export async function scanDist(distRoot: string, localPaths: ReadonlyArray<string>): Promise<DistReport> {
    const forbidden: string[] = [];
    const missing: string[] = [];
    for (const [part, markers] of Object.entries(PRODUCT_MARKERS)) {
        const texts = await Promise.all((await filesUnder(join(distRoot, part))).map(async (file) => ({file, text: await readFile(file, "utf8")})));
        for (const {file, text} of texts) {
            for (const marker of [...DEVELOPMENT_MARKERS, ...localPaths]) {
                if (text.includes(marker)) forbidden.push(`${relative(distRoot, file)}: ${marker}`);
            }
        }
        for (const marker of markers) {
            if (!texts.some(({text}) => text.includes(marker))) missing.push(`${part}: ${marker}`);
        }
    }
    const page = await readFile(join(distRoot, "web", "index.html"), "utf8").catch(() => "");
    const firstScreen = [...page.matchAll(/<script[^>]*\ssrc="\/?([^"]+\.js)"|<link[^>]*rel="modulepreload"[^>]*href="\/?([^"]+\.js)"/gu)].map((match) => match[1] ?? match[2] ?? "");
    for (const file of firstScreen) {
        const text = await readFile(join(distRoot, "web", file), "utf8").catch(() => "");
        for (const marker of FIRST_SCREEN_FORBIDDEN) {
            if (text.includes(marker)) forbidden.push(`web/${file}（首屏）: ${marker}`);
        }
    }
    for (const file of (await filesUnder(join(distRoot, "web"))).filter((path) => path.endsWith(".css"))) {
        for (const problem of layeringProblems(await readFile(file, "utf8"))) forbidden.push(`${relative(distRoot, file)}: ${problem}`);
    }
    return {forbidden, missing};
}

/**
 * 分层的两条不变量（ADR 0028）：层按 `LAYER_ORDER` 的先后出现；不分层的规则里没有特异性低于一个类的选择器。
 * 后者压过所有分层的声明，`* { margin: 0 }` 会让每个 `m-*` 失效，构建与单测都不报错，所以在产物上查。
 */
export function layeringProblems(css: string): string[] {
    const problems: string[] = [];
    const root = postcss.parse(css);
    const seen: string[] = [];
    root.walkAtRules("layer", (rule) => {
        for (const name of rule.params.split(",").map((part) => part.trim())) {
            if (LAYER_ORDER.includes(name) && !seen.includes(name)) seen.push(name);
        }
    });
    const expected = LAYER_ORDER.filter((name) => seen.includes(name));
    if (seen.join(",") !== expected.join(",")) problems.push(`样式层的先后是 ${seen.join(", ")}，应为 ${expected.join(", ")}`);
    root.walkRules((rule) => {
        if (insideLayerOrKeyframes(rule)) return;
        for (const selector of rule.selectors.filter(belowOneClass)) problems.push(`不分层的低特异性规则 ${selector}（放进 @layer base）`);
    });
    return problems;
}

function insideLayerOrKeyframes(rule: Rule): boolean {
    for (let parent = rule.parent; parent !== undefined && parent.type !== "root"; parent = parent.parent) {
        if (parent.type === "atrule" && ((parent as AtRule).name === "layer" || /keyframes$/u.test((parent as AtRule).name))) return true;
    }
    return false;
}

/**
 * 没有 id、类、属性与伪类（`:where()` 里的不算）：元素、通配与伪元素选择器。带浏览器私有前缀的伪元素（第三方样式里的
 * `::-ms-clear`、`::-webkit-scrollbar` 这类）只给浏览器自己画的部件上样式，原子类作用不到那里，不算。
 */
function belowOneClass(selector: string): boolean {
    let weight = 0;
    let vendorPart = false;
    selectorParser((selectors) => {
        selectors.walk((node) => {
            if (node.type === "pseudo" && node.value === ":where") {
                node.nodes.length = 0;
                return;
            }
            if (node.type === "pseudo" && /^::-(?:webkit|moz|ms)-/u.test(node.value)) vendorPart = true;
            if (node.type === "id" || node.type === "class" || node.type === "attribute") weight += 1;
            if (node.type === "pseudo" && !node.value.startsWith("::") && !/^:(?:is|not|has)$/u.test(node.value)) weight += 1;
        });
    }).processSync(selector);
    return weight === 0 && !vendorPart;
}

if (import.meta.main) {
    const packageRoot = resolve(import.meta.dir, "..");
    const report = await scanDist(join(packageRoot, "dist"), [resolve(packageRoot, "../..")]);
    for (const line of report.forbidden) console.error(`[check:dist] 产物里有不该出现的内容：${line}`);
    for (const line of report.missing) console.error(`[check:dist] 产物缺少产品标记，扫描的可能不是这次构建：${line}`);
    if (report.forbidden.length > 0 || report.missing.length > 0) process.exit(1);
    console.log("[check:dist] 产物不含开发插件与本机路径");
}
