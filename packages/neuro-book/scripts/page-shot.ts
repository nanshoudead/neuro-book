#!/usr/bin/env node
/**
 * 截产品页面（w00022 t18）：打开开发服务上的一个页面，等应用自己的就绪标记，按命令行里出现的顺序执行点击与等待，再截图，
 * 并写出 JSON 报告。对着 `bun run dev` 运行（`nbdev shot --page` 经它截图）：
 *
 *   bun run page:shot -- --url http://127.0.0.1:4217/ --path '/?project=sample'
 *
 * 就绪只看应用自己给出的信号，与参数无关，不给任何步骤也不会截到加载页或半成品：
 * 1. 页面画出：页面根带 `data-window-state="ready"`、`data-rpc-state="online"` 与 `data-page-rendered`（src/web/PageOutlet.md；
 *    前两个在页面组件挂上时就有了，按需加载的外壳、首页这些主体要晚一些，所以要等页面自己标的第三个）。窗口没有就绪、停在
 *    宿主页的失败页（`data-browser-host-status` 不是加载中）也算画出，照常截图，报告的 `hostStatus` 写它的状态。
 * 2. 画面稳定：连续 `IDLE_FRAMES` 帧既没有在跑的动画与过渡（`document.getAnimations()`；骨架、转圈这些加载指示都是动画），
 *    也没有看得见的 `aria-busy="true"`（应用用它标正在加载的区域，PageOutlet.md 的页面合同），窗口里也没有还在加载的图片，
 *    再等字体就绪。
 * 之后按顺序执行步骤，点击之后要等的新界面写在它后面的 `--wait-for` 里；截图前再等一次画面稳定。每一项等待的上限都是
 * `--timeout`，到了就失败（退出码 1），原因写明卡在哪一项、还在跑的动画与忙着的元素是哪些。
 * 由 Node 运行（Node 直接执行 TypeScript）：Bun 下 Playwright 连接浏览器的握手会超时。
 */
import {mkdir, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";

import {resolveAgentScratchPath} from "@notnotype/neuro-book-test-support/paths";
import {chromium, errors} from "@playwright/test";
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
  --timeout <秒>               每一项等待（页面画出、画面稳定、每一步）的上限，默认 120（首次打开要编译）
  --out <目录>                 输出目录；默认系统临时根下的 browser/page-shot/<时间戳>
  --browser-executable <路径>  浏览器可执行文件；默认用本机 Chrome`;

/** 页面画出：页面根已就绪、链路在线，页面自己标了画出（src/web/PageOutlet.md）。 */
const RENDERED_SELECTOR = "[data-window-state=\"ready\"][data-rpc-state=\"online\"][data-page-rendered]";
/** 宿主页还在加载的状态：`loading` 是 index.html 的静态加载页，`idle`、`starting` 是 FailurePage 的加载样子；其余是失败页的终态。 */
const HOST_LOADING_STATUSES = ["loading", "idle", "starting"];
/** 连续几帧没有动画、没有忙着的区域算稳定：一帧可能恰好落在两段加载之间，两帧之后最后一帧画的就是稳定的画面。 */
const IDLE_FRAMES = 2;

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
    /** 窗口没有就绪、停在宿主页的失败页时是它的状态（`data-browser-host-status`，例如 `project-unavailable`）；页面正常画出时为 null。 */
    readonly hostStatus: string | null;
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

/** 等页面画出；返回宿主页的状态，页面正常画出时为 null。超时时说明卡在哪里。 */
async function waitRendered(page: Page, timeout: number): Promise<string | null> {
    try {
        const handle = await page.waitForFunction(({selector, loading}) => {
            if (document.querySelector(selector) !== null) return {host: null};
            const status = document.querySelector("[data-browser-host-status]")?.getAttribute("data-browser-host-status") ?? null;
            return status !== null && !loading.includes(status) ? {host: status} : false;
        }, {selector: RENDERED_SELECTOR, loading: HOST_LOADING_STATUSES}, {timeout, polling: "raf"});
        const result = await handle.jsonValue();
        return result === false ? null : result.host;
    } catch (error) {
        if (!(error instanceof errors.TimeoutError)) throw error;
        const seen = await page.evaluate(() => {
            const root = document.querySelector("[data-window-state]");
            return {
                root: root === null ? null : {rendered: root.hasAttribute("data-page-rendered"), rpc: root.getAttribute("data-rpc-state")},
                host: document.querySelector("[data-browser-host-status]")?.getAttribute("data-browser-host-status") ?? null,
            };
        });
        const seconds = String(timeout / 1000);
        if (seen.root !== null && seen.root.rpc !== "online") throw new Error(`页面 ${seconds} 秒内没有画出：与服务端的链路是 ${String(seen.root.rpc)}`, {cause: error});
        if (seen.root !== null && !seen.root.rendered) {
            throw new Error(`页面根已就绪，但 ${seconds} 秒内没有标出 data-page-rendered：页面主体没有挂上（看 report.problems 里的控制台错误），或者这个页面不给这个标记（见 src/web/PageOutlet.md；Lab 用 lab:shot）`, {cause: error});
        }
        if (seen.host !== null) throw new Error(`窗口 ${seconds} 秒内没有就绪，宿主页还在加载（${seen.host}）`, {cause: error});
        throw new Error(`页面 ${seconds} 秒内没有出现窗口的根元素，也没有宿主页：这个地址可能不是 NeuroBook 的页面`, {cause: error});
    }
}

/** 等画面稳定（见模块头），再等字体就绪；超时时列出还在跑的动画与忙着的元素。 */
async function settle(page: Page, timeout: number): Promise<void> {
    const outcome = await page.evaluate(({idleFrames, limitMs}) => new Promise<{readonly settled: true} | {readonly settled: false; readonly activity: string[]}>((resolve) => {
        const describe = (element: Element | null): string => {
            if (element === null) return "（文档）";
            const marks = [...element.attributes].filter((attribute) => attribute.name.startsWith("data-") || attribute.name === "class").map((attribute) => `${attribute.name}="${attribute.value.slice(0, 40)}"`);
            return `<${element.tagName.toLowerCase()}${marks.length === 0 ? "" : ` ${marks.slice(0, 3).join(" ")}`}>`;
        };
        const activity = (): string[] => {
            const animations = document.getAnimations().filter((animation) => animation.playState === "running" || animation.pending).map((animation) => {
                const name = animation instanceof CSSAnimation ? animation.animationName : animation instanceof CSSTransition ? `过渡 ${animation.transitionProperty}` : animation.id || "动画";
                const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
                return `动画 ${name} 在 ${describe(target)}`;
            });
            const busy = [...document.querySelectorAll("[aria-busy=\"true\"]")].filter((element) => element.checkVisibility({visibilityProperty: true})).map((element) => `aria-busy 在 ${describe(element)}`);
            const inView = (element: Element): boolean => {
                const box = element.getBoundingClientRect();
                return box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
            };
            const images = [...document.images].filter((image) => !image.complete && image.checkVisibility() && inView(image)).map((image) => `图片 ${image.currentSrc || image.src} 还在加载`);
            return [...animations, ...busy, ...images];
        };
        const deadline = performance.now() + limitMs;
        let idle = 0;
        const frame = (): void => {
            const current = activity();
            idle = current.length === 0 ? idle + 1 : 0;
            if (idle >= idleFrames) resolve({settled: true});
            else if (performance.now() > deadline) resolve({settled: false, activity: current});
            else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    }), {idleFrames: IDLE_FRAMES, limitMs: timeout});
    if (!outcome.settled) throw new Error(`画面 ${String(timeout / 1000)} 秒内没有稳定下来：${outcome.activity.slice(0, 8).join("；")}`);
    await page.evaluate(() => document.fonts.ready);
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
    let hostStatus: string | null = null;
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
            hostStatus = await waitRendered(opened, options.timeoutMs);
            await settle(opened, options.timeoutMs);
            for (const step of options.steps) {
                await runStep(opened, step, options.timeoutMs);
                done.push(step);
            }
            if (options.steps.length > 0) await settle(opened, options.timeoutMs);
            const file = join(options.out, "page.png");
            await opened.screenshot({path: file, fullPage: options.fullPage});
            report = {url: opened.url(), window: options.windowSize, steps: done, hostStatus, file, problems, error: null};
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            const failure = join(options.out, "failure.png");
            const saved = await opened.screenshot({path: failure, fullPage: options.fullPage}).then(() => true, (shotError: unknown) => {
                problems.push(`failure.png 没有截出来：${shotError instanceof Error ? shotError.message : String(shotError)}`);
                return false;
            });
            report = {url: opened.url(), window: options.windowSize, steps: done, hostStatus, file: saved ? failure : null, problems, error: reason};
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
        if (report.hostStatus !== null) console.log(`窗口没有就绪，页面停在宿主页：${report.hostStatus}`);
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
