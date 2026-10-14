#!/usr/bin/env node
/**
 * 截产品页面（w00022 t18）：打开开发服务上的一个页面，等应用自己的就绪标记，按命令行里出现的顺序执行点击与等待，再截图，
 * 并写出 JSON 报告。对着 `bun run dev` 运行（`nbdev shot --page` 经它截图）：
 *
 *   bun run page:shot -- --url http://127.0.0.1:4217/ --path '/?project=sample'
 *
 * 就绪：先等页面根元素带 `data-window-state="ready"` 与 `data-rpc-state="online"`（src/web/PageOutlet.md）。这个标记在
 * 页面组件挂上时就有了，工作台的外壳与各视图随后才异步渲染（实测标记出现时页面还是空白），所以再等页面静下来：整个文档
 * 连续 `QUIET_MS` 没有 DOM 变化。这一步与参数无关，不给任何步骤也不会截到加载页或半成品。之后按顺序执行步骤，点击之后要等的
 * 新界面写在它后面的 `--wait-for` 里；截图前再等一次静下来与字体就绪。一直有变化的页面（动画、计时器）等到 `SETTLE_LIMIT_MS`
 * 就照常截图，报告里记一条。
 * 由 Node 运行（Node 直接执行 TypeScript）：Bun 下 Playwright 连接浏览器的握手会超时。
 */
import {mkdir, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";

import {resolveAgentScratchPath} from "@notnotype/neuro-book-test-support/paths";
import {chromium} from "@playwright/test";
import type {Browser, Page} from "@playwright/test";

const USAGE = `用法：bun run page:shot -- --url <开发服务地址> [选项]

  --url <地址>                 开发服务的页面地址，必填
  --path <路径>                同源路径，可带查询串；默认 /
  --click <选择器>             点击这个元素；可重复，与 --wait-for 按出现的顺序依次执行
  --wait-for <选择器>          等这个元素可见；可重复
  --window <宽x高>             浏览器窗口，默认 1440x900
  --full-page                  截整页，不只截窗口
  --scale <倍数>               设备像素比，默认 1
  --theme light|dark           模拟系统配色（prefers-color-scheme）；默认不模拟
  --timeout <秒>               每一步的上限，默认 120（首次打开要编译）
  --out <目录>                 输出目录；默认系统临时根下的 browser/page-shot/<时间戳>
  --browser-executable <路径>  浏览器可执行文件；默认用本机 Chrome`;

/** 应用的就绪标记：页面根元素在线（src/web/PageOutlet.md）。 */
const READY_SELECTOR = "[data-window-state=\"ready\"][data-rpc-state=\"online\"]";
/** 多久没有 DOM 变化算静下来：比视图之间一次 RPC 往返加渲染长，比人等得不耐烦短。 */
const QUIET_MS = 500;
/** 最多等多久静下来。 */
const SETTLE_LIMIT_MS = 10_000;

export type PageShotStep = {readonly kind: "click" | "wait-for"; readonly selector: string};

export type PageShotOptions = {
    readonly url: string;
    readonly path: string;
    readonly steps: readonly PageShotStep[];
    readonly windowSize: {readonly width: number; readonly height: number};
    readonly fullPage: boolean;
    readonly scale: number;
    readonly theme: "light" | "dark" | null;
    readonly timeoutMs: number;
    readonly out: string;
    readonly browserExecutable: string | null;
};

export type PageShotReport = {
    /** 截图时的地址（页面自己可能改写了地址栏）。 */
    readonly url: string | null;
    readonly window: {readonly width: number; readonly height: number};
    /** 执行完的步骤，按执行顺序；第一步之前的就绪等待不算。 */
    readonly steps: readonly PageShotStep[];
    readonly file: string | null;
    /** pageerror 与 console 的 error、warning。 */
    readonly problems: readonly string[];
    /** 失败时为原因，截图另存为 failure.png（截得出来时）。 */
    readonly error: string | null;
};

export class PageShotUsageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PageShotUsageError";
    }
}

function parseSize(value: string, flag: string): {width: number; height: number} {
    const match = /^(\d+)x(\d+)$/u.exec(value);
    if (match === null) throw new PageShotUsageError(`${flag} 需要 宽x高，收到：${value}`);
    return {width: Number(match[1]), height: Number(match[2])};
}

function positive(value: string, flag: string): number {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw new PageShotUsageError(`${flag} 需要正数，收到：${value}`);
    return number;
}

/** `--path` 必须是同源路径：不能是绝对 URL、`//` 开头或含反斜杠，拼出来的地址要与 `--url` 同源。 */
export function pageAddress(base: string, path: string): string {
    if (/^[a-z][a-z0-9+.-]*:/iu.test(path) || path.startsWith("//") || path.includes("\\")) {
        throw new PageShotUsageError(`--path 要写同源路径（例如 /?project=sample），收到：${path}`);
    }
    const url = new URL(path, base);
    if (url.origin !== new URL(base).origin) throw new PageShotUsageError(`--path 拼出的地址不同源：${url.href}`);
    return url.href;
}

export function parsePageShotArgs(args: readonly string[]): PageShotOptions {
    let url: string | null = null;
    let path = "/";
    const steps: PageShotStep[] = [];
    let windowSize = {width: 1440, height: 900};
    let fullPage = false;
    let scale = 1;
    let theme: "light" | "dark" | null = null;
    let timeoutMs = 120_000;
    let out = "";
    let browserExecutable: string | null = null;
    for (let index = 0; index < args.length; index += 1) {
        const flag = args[index]!;
        if (flag === "--help" || flag === "-h") throw new PageShotUsageError(USAGE);
        if (flag === "--full-page") {
            fullPage = true;
            continue;
        }
        const value = args[index + 1];
        if (value === undefined || value.startsWith("--")) throw new PageShotUsageError(`${flag} 缺少取值\n\n${USAGE}`);
        index += 1;
        switch (flag) {
            case "--url": url = new URL(value).href; break;
            case "--path": path = value; break;
            case "--click": steps.push({kind: "click", selector: value}); break;
            case "--wait-for": steps.push({kind: "wait-for", selector: value}); break;
            case "--window": windowSize = parseSize(value, flag); break;
            case "--scale": scale = positive(value, flag); break;
            case "--theme":
                if (value !== "light" && value !== "dark") throw new PageShotUsageError(`--theme 只能是 light 或 dark，收到：${value}`);
                theme = value;
                break;
            case "--timeout": timeoutMs = positive(value, flag) * 1000; break;
            case "--out": out = resolve(value); break;
            case "--browser-executable": browserExecutable = value; break;
            default: throw new PageShotUsageError(`未知参数：${flag}\n\n${USAGE}`);
        }
    }
    if (url === null) throw new PageShotUsageError(`缺少 --url\n\n${USAGE}`);
    pageAddress(url, path);
    if (out === "") out = resolveAgentScratchPath("browser", "page-shot", new Date().toISOString().replace(/[:.]/gu, "-"));
    return {url, path, steps, windowSize, fullPage, scale, theme, timeoutMs, out, browserExecutable};
}

/** 等页面静下来，再等字体就绪；到上限还在变时返回 false。 */
async function settle(page: Page): Promise<boolean> {
    const quiet = await page.evaluate(({quietMs, limitMs}) => new Promise<boolean>((resolve) => {
        let timer = setTimeout(() => finish(true), quietMs);
        const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => finish(true), quietMs);
        });
        const limit = setTimeout(() => finish(false), limitMs);
        function finish(value: boolean): void {
            observer.disconnect();
            clearTimeout(timer);
            clearTimeout(limit);
            resolve(value);
        }
        observer.observe(document, {subtree: true, childList: true, attributes: true, characterData: true});
    }), {quietMs: QUIET_MS, limitMs: SETTLE_LIMIT_MS});
    await page.evaluate(() => document.fonts.ready);
    return quiet;
}

async function runStep(page: Page, step: PageShotStep, timeout: number): Promise<void> {
    const target = page.locator(step.selector).first();
    // 点击靠 Playwright 的自动等待（可见、稳定、能接收指针）；点击引起的新界面由后面的 --wait-for 等。
    if (step.kind === "click") await target.click({timeout});
    else await target.waitFor({state: "visible", timeout});
}

export async function runPageShot(options: PageShotOptions): Promise<PageShotReport> {
    const address = pageAddress(options.url, options.path);
    await mkdir(options.out, {recursive: true});
    const problems: string[] = [];
    const done: PageShotStep[] = [];
    let browser: Browser | null = null;
    let page: Page | null = null;
    let report: PageShotReport;
    try {
        browser = await chromium.launch(options.browserExecutable === null
            ? {channel: "chrome", headless: true}
            : {executablePath: resolve(options.browserExecutable), headless: true});
        const context = await browser.newContext({viewport: options.windowSize, deviceScaleFactor: options.scale, colorScheme: options.theme ?? undefined});
        page = await context.newPage();
        const opened = page;
        opened.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
        opened.on("console", (message) => {
            if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`);
        });
        try {
            await opened.goto(address, {waitUntil: "domcontentloaded", timeout: options.timeoutMs});
            await opened.locator(READY_SELECTOR).first().waitFor({state: "visible", timeout: options.timeoutMs});
            const unsettled = (when: string): string => `${when}页面 ${String(SETTLE_LIMIT_MS / 1000)} 秒内一直有 DOM 变化，没等它静下来`;
            if (!(await settle(opened))) problems.push(unsettled("就绪后"));
            for (const step of options.steps) {
                await runStep(opened, step, options.timeoutMs);
                done.push(step);
            }
            if (options.steps.length > 0 && !(await settle(opened))) problems.push(unsettled("截图前"));
            const file = join(options.out, "page.png");
            await opened.screenshot({path: file, fullPage: options.fullPage});
            report = {url: opened.url(), window: options.windowSize, steps: done, file, problems, error: null};
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            const failure = join(options.out, "failure.png");
            const saved = await opened.screenshot({path: failure, fullPage: options.fullPage}).then(() => true, (shotError: unknown) => {
                problems.push(`failure.png 没有截出来：${shotError instanceof Error ? shotError.message : String(shotError)}`);
                return false;
            });
            report = {url: opened.url(), window: options.windowSize, steps: done, file: saved ? failure : null, problems, error: reason};
        }
    } finally {
        await browser?.close();
    }
    await writeFile(join(options.out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        const options = parsePageShotArgs(process.argv.slice(2));
        const report = await runPageShot(options);
        if (report.error === null) console.log(`截图：${report.file}`);
        else console.error(`截图失败（已执行 ${String(report.steps.length)} 步）：${report.error.split("\n")[0]}${report.file === null ? "" : `\n失败时的页面：${report.file}`}`);
        if (report.problems.length > 0) console.log(`页面问题 ${String(report.problems.length)} 条，见报告`);
        console.log(`报告：${join(options.out, "report.json")}`);
        if (report.error !== null) process.exitCode = 1;
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
