#!/usr/bin/env node
/**
 * w00030 t02 的临时工具，Task 完成后删除。
 *
 * 改前改后各截一套，逐张比较，列出有差异的画面：
 *
 *   node scripts/nb-ui/tailwind-migration/shoot-all.ts lab   --url <开发服务> --out <目录> [--components A,B]
 *   node scripts/nb-ui/tailwind-migration/shoot-all.ts pages --url <开发服务> --out <目录>
 *   node scripts/nb-ui/tailwind-migration/shoot-all.ts diff  <改前目录> <改后目录> --out <差异图目录>
 *
 * - lab：Lab 里全部组件的全部场景，nbook 与 macos 两个主题、明暗各一，画布 900x620。截图用 neuro-book 的 lab:shot
 *   （同一套打开与就绪判断），一个组件、一个主题开一次浏览器。
 * - pages：应用的四个页面（书架、绑定作品的工作台与资源管理器、设置窗口、未绑定的工作台），用 page:shot 的就绪判断。
 *   开发服务要先登记好名为 `book` 的作品（见 Task 记录里的启动方式）。
 * - diff：同名文件用 `magick compare -metric AE` 数不同的像素，写出差异图，按像素数从大到小列出；只在一边有的也列出。
 *
 * 由 Node 运行：Bun 下 Playwright 连接浏览器的握手会超时（同 lab:shot）。
 */
import {execFile} from "node:child_process";
import {mkdir, readdir, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {promisify} from "node:util";

import {chromium} from "@playwright/test";

import {runLabShot} from "../../../packages/neuro-book/scripts/lab-shot.ts";
import {runPageShot} from "../../../packages/neuro-book/scripts/page-shot.ts";
import type {PageShotStep} from "../../../packages/neuro-book/scripts/page-shot.ts";

const run = promisify(execFile);

const THEMES = ["nbook", "macos"];
const COLORWAYS = ["light", "dark"];
const CANVAS = "900x620";

function option(args: readonly string[], flag: string): string | null {
    const index = args.indexOf(flag);
    return index === -1 ? null : args[index + 1] ?? null;
}

function required(args: readonly string[], flag: string): string {
    const value = option(args, flag);
    if (value === null) throw new Error(`缺少 ${flag}`);
    return value;
}

async function labComponents(url: string): Promise<string[]> {
    const browser = await chromium.launch({channel: "chrome", headless: true});
    try {
        const page = await browser.newPage();
        await page.goto(new URL("/lab", url).href, {waitUntil: "domcontentloaded", timeout: 180_000});
        const handle = await page.waitForFunction(() => {
            const lab = (window as unknown as {__nbLab?: {components(): string[]}}).__nbLab;
            return lab === undefined ? false : lab.components();
        }, undefined, {timeout: 120_000});
        return await handle.jsonValue() as string[];
    } finally {
        await browser.close();
    }
}

async function shootLab(args: readonly string[]): Promise<void> {
    const url = required(args, "--url");
    const out = resolve(required(args, "--out"));
    const only = option(args, "--components");
    const components = only === null ? await labComponents(url) : only.split(",");
    const failures: string[] = [];
    for (const [index, component] of components.entries()) {
        for (const theme of THEMES) {
            try {
                const results = await runLabShot({
                    url, component, scenes: "all", viewports: [CANVAS], colorways: COLORWAYS, theme,
                    windowSize: {width: 1600, height: 1000}, clicks: [], waitMs: 300, scale: 1,
                    out: join(out, "lab", theme), browserExecutable: null, fail: false,
                });
                console.log(`[${index + 1}/${components.length}] ${component} · ${theme}：${results.length} 张`);
            } catch (error) {
                // 一个组件截不出来不影响其余的；失败的列在最后，改前改后都失败的不算差异。
                const message = `${component} · ${theme}：${error instanceof Error ? error.message.split("\n")[0] : String(error)}`;
                failures.push(message);
                console.log(`[${index + 1}/${components.length}] 失败 ${message}`);
            }
        }
    }
    await writeFile(join(out, "lab-failures.txt"), `${failures.join("\n")}\n`);
    console.log(`完成；失败 ${failures.length} 个，见 ${join(out, "lab-failures.txt")}`);
}

/** 四个页面，按页面合同的就绪标记等待；设置窗口经活动栏的设置项打开（同 e2e/plugins.e2e.ts）。 */
const PAGES: ReadonlyArray<{name: string; path: string; steps: PageShotStep[]}> = [
    {name: "bookshelf", path: "/", steps: []},
    {name: "workbench", path: "/workbench", steps: []},
    {name: "workbench-book", path: "/?project=book", steps: []},
    {name: "settings", path: "/?project=book", steps: [{kind: "click", selector: "[data-activity-item='nbook.settings']"}, {kind: "wait-for", selector: "[data-settings-window]"}]},
];

async function shootPages(args: readonly string[]): Promise<void> {
    const url = required(args, "--url");
    const out = resolve(required(args, "--out"));
    for (const page of PAGES) {
        for (const theme of ["light", "dark"] as const) {
            const report = await runPageShot({
                url, path: page.path, steps: page.steps, windowSize: {width: 1440, height: 900}, fullPage: false, scale: 1,
                theme, timeoutMs: 120_000, allowHostFailure: false, out: join(out, "pages", `${page.name}__${theme}`), browserExecutable: null,
            });
            console.log(`${page.name} · ${theme}：${report.error ?? "好"}`);
        }
    }
}

async function pngs(root: string): Promise<string[]> {
    const entries = await readdir(root, {recursive: true});
    return entries.filter((entry) => entry.endsWith(".png") && !entry.endsWith("failure.png")).sort();
}

async function diff(args: readonly string[]): Promise<void> {
    const [before, after] = args.slice(1, 3).map((path) => resolve(path));
    if (before === undefined || after === undefined) throw new Error("diff 需要改前、改后两个目录");
    const out = resolve(required(args, "--out"));
    const left = new Set(await pngs(before));
    const right = new Set(await pngs(after));
    const rows: Array<{file: string; pixels: number}> = [];
    const onlyOne: string[] = [];
    for (const file of [...new Set([...left, ...right])].sort()) {
        if (!left.has(file) || !right.has(file)) {
            onlyOne.push(`${left.has(file) ? "只在改前" : "只在改后"}：${file}`);
            continue;
        }
        const target = join(out, file);
        await mkdir(resolve(target, ".."), {recursive: true});
        // compare 的退出码：0 相同，1 不同，2 出错（尺寸不同也算出错）；像素数写在 stderr。
        const result = await run("magick", ["compare", "-metric", "AE", join(before, file), join(after, file), target]).then(
            ({stderr}) => stderr,
            (error: {code?: number; stderr?: string}) => error.code === 1 ? error.stderr ?? "" : `error ${error.stderr ?? ""}`,
        );
        const pixels = result.startsWith("error") ? Number.POSITIVE_INFINITY : Number.parseFloat(result);
        if (pixels !== 0) rows.push({file, pixels});
    }
    rows.sort((a, b) => b.pixels - a.pixels);
    const lines = [
        `比较 ${left.size} / ${right.size} 张，有差异 ${rows.length} 张`,
        ...rows.map((row) => `${Number.isFinite(row.pixels) ? row.pixels : "尺寸不同"}\t${row.file}`),
        ...onlyOne,
    ];
    await mkdir(out, {recursive: true});
    await writeFile(join(out, "diff.txt"), `${lines.join("\n")}\n`);
    console.log(lines.slice(0, 40).join("\n"));
    console.log(`全表：${join(out, "diff.txt")}`);
}

const args = process.argv.slice(2);
switch (args[0]) {
    case "lab": await shootLab(args); break;
    case "pages": await shootPages(args); break;
    case "diff": await diff(args); break;
    default: console.error("用法：shoot-all.ts lab|pages|diff …（见文件头）"); process.exitCode = 1;
}
