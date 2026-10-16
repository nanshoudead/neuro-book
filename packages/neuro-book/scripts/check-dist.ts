/**
 * 生产产物检查（ui.component-lab 场景 10）：`dist/` 里不能有开发插件（Lab）的代码，也不能带本机的绝对路径。
 * 同时要求产品自己的标记在场，证明扫描读到的是这次构建的真实产物，而不是空目录或换了位置的输出。首屏（入口脚本与它预加载的
 * chunk）里不能有 Markdown 的编辑内核与解析器（workspace.markdown-syntaxes 输出 2）。
 *
 *   bun run check:dist        # `bun run build` 的最后一步
 */

import {readdir, readFile} from "node:fs/promises";
import {join, relative, resolve} from "node:path";

/**
 * 只出现在 Lab 代码里的字符串：插件 id、调试接口、偏好键前缀、外壳组件名、源码目录与 DOM 标记，以及组件文档的
 * frontmatter（`标签: [`）——Lab 经 `@notnotype/nb-ui/lab-sources` 把组件文档原文打进包，产品代码误引它时由这一项拦下。
 */
export const DEVELOPMENT_MARKERS = ["nbook.lab", "__nbLab", "nb-lab:", "LabShell", "plugins/lab/", "data-lab-", "标签: ["];

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
    return {forbidden, missing};
}

if (import.meta.main) {
    const packageRoot = resolve(import.meta.dir, "..");
    const report = await scanDist(join(packageRoot, "dist"), [resolve(packageRoot, "../..")]);
    for (const line of report.forbidden) console.error(`[check:dist] 产物里有不该出现的内容：${line}`);
    for (const line of report.missing) console.error(`[check:dist] 产物缺少产品标记，扫描的可能不是这次构建：${line}`);
    if (report.forbidden.length > 0 || report.missing.length > 0) process.exit(1);
    console.log("[check:dist] 产物不含开发插件与本机路径");
}
