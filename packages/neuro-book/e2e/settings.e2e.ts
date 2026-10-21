/**
 * 配置在真实 Chrome 中的验收（docs/specs/settings/configuration.md 验收 2、3，docs/specs/theme/system.md 的“运行时流程”，
 * docs/specs/workbench/quick-open.md 的显示语言）：生产构建的外壳与后端；Lab 的那一条用真实的开发会话（Lab 只在开发
 * 模式加载）。设置文件在测试临时根下，外部修改直接写文件，等页面上可观察的变化，不按时长等待。
 */

import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import {parse as parseJsonc} from "jsonc-parser";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startDevSession, startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

let tmp = "";
let stateRoot = "";
let projectDir = "";
let server: ProductServer;

/** 用户层文件一开始的样子：带注释，验证写入后注释与其余内容保留。 */
const USER_FILE = "// 我的设置\n{\n    // 主题\n    \"nbook.workbench/theme\": \"nbook\"\n}\n";

const userFile = (): string => join(stateRoot, "settings.json");
const projectFile = (): string => join(projectDir, ".nbook", "settings.json");

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "settings");
    stateRoot = join(tmp, "state");
    projectDir = join(tmp, "Book");
    // 先登记好项目 `book`：身份文件与登记表按 docs/specs/runtime/projects.md 的格式写入，不经界面。
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await mkdir(stateRoot, {recursive: true});
    await writeFile(join(projectDir, ".nbook", "project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    await writeFile(userFile(), USER_FILE);
    server = await startProductServer(stateRoot);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 每个用例从同一份用户层、空的项目层开始；页面都在用例里新开。 */
test.beforeEach(async () => {
    await writeFile(userFile(), USER_FILE);
    await rm(projectFile(), {force: true});
});

function watchConsole(page: Page, problems: string[]): void {
    page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
}

async function open(page: Page, path = "/workbench"): Promise<void> {
    await page.goto(new URL(path, server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
    await expect(page.locator("[data-workbench-document]")).toHaveCount(1);
}

/** 打开命令面板（命令宿主随页面异步加载，按到面板出现为止），输入文字后按回车执行第一项。 */
async function runCommand(page: Page, text: string): Promise<void> {
    const combobox = page.getByRole("combobox");
    await expect(async () => {
        await page.keyboard.press("Control+Shift+P");
        await expect(combobox).toBeFocused({timeout: 500});
    }).toPass();
    await combobox.fill(`>${text}`);
    await expect(page.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("Enter");
}

/** 选择模式里选一项：输入文字过滤后按回车。 */
async function choose(page: Page, text: string): Promise<void> {
    const combobox = page.getByRole("combobox");
    await expect(combobox).toBeFocused();
    await combobox.fill(text);
    await expect(page.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(combobox).toHaveCount(0);
}

const html = (page: Page, name: "lang" | "data-nb-theme" | "data-nb-appearance") => page.locator("html").getAttribute(name);
const pageBackground = (page: Page) => page.locator("[data-workbench-shell]").evaluate((element) => getComputedStyle(element).backgroundColor);

/** 首页的背景、文字颜色与字体，以及同一位置上外壳底色（主题的 `--shell-ground`，平铺的主题是面板底色）、`--text-main`、`--font-ui` 解析出的值（用探针元素求出）。 */
const pageTokens = (page: Page) => page.locator("[data-workbench-shell]").evaluate((element) => {
    const probe = document.createElement("div");
    probe.style.cssText = "background-color: var(--shell-ground, var(--panel-surface)); color: var(--text-main); font-family: var(--font-ui)";
    element.append(probe);
    const own = getComputedStyle(element);
    const token = getComputedStyle(probe);
    const result = {
        actual: [own.backgroundColor, own.color, own.fontFamily],
        tokens: [token.backgroundColor, token.color, token.fontFamily],
    };
    probe.remove();
    return result;
});

test("两个窗口：一处用命令面板切换界面语言，另一处即时换成英文；面板文字跟着换；刷新后保持；设置文件的注释保留", async ({browser}) => {
    const context = await browser.newContext();
    const a = await context.newPage();
    const b = await context.newPage();
    const problems: string[] = [];
    watchConsole(a, problems);
    watchConsole(b, problems);
    await open(a);
    await open(b);
    expect(await html(b, "lang")).toBe("zh-CN");
    await expect(b.getByText("显示所有命令")).toBeVisible();

    await runCommand(a, "切换界面语言");
    await choose(a, "English");
    await expect.poll(() => html(b, "lang")).toBe("en-US");
    await expect(b.getByText("Show All Commands")).toBeVisible();
    await expect(a.getByText("Show All Commands")).toBeVisible();

    // 面板自己的文字按当前语言。
    await expect(async () => {
        await a.keyboard.press("Control+Shift+P");
        await expect(a.getByRole("combobox", {name: "Type a command, or : to go to a line"})).toBeFocused({timeout: 500});
    }).toPass();
    await a.keyboard.press("Escape");

    await b.reload();
    await expect(b.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
    await expect(b.getByText("Show All Commands")).toBeVisible();

    const written = await readFile(userFile(), "utf8");
    expect(written).toContain("// 我的设置");
    expect(written).toContain("// 主题");
    expect(JSON.parse(written.replace(/\/\/.*$/gmu, ""))).toEqual({"nbook.workbench/theme": "nbook", "nbook.settings/locale": "en-US"});
    expect(problems).toEqual([]);
    await context.close();
});

test("外部改用户层文件后主题与页面底色变化；项目层覆盖主题时绑定窗口与未绑定窗口各自正确，切换主题在绑定窗口里改项目层", async ({browser}) => {
    const context = await browser.newContext();
    const free = await context.newPage();
    const bound = await context.newPage();
    await open(free);
    await expect.poll(() => html(free, "data-nb-theme")).toBe("nbook");
    const nbookBackground = await pageBackground(free);
    const nbookTokens = await pageTokens(free);
    expect(nbookTokens.actual).toEqual(nbookTokens.tokens);

    await writeFile(userFile(), "{\"nbook.workbench/theme\": \"macos\"}");
    await expect.poll(() => html(free, "data-nb-theme")).toBe("macos");
    await expect.poll(() => pageBackground(free)).not.toBe(nbookBackground);
    const tokens = await pageTokens(free);
    expect(tokens.actual).toEqual(tokens.tokens);

    await writeFile(projectFile(), "{\"nbook.workbench/theme\": \"nbook\"}");
    await open(bound, "/?project=book");
    await expect.poll(() => html(bound, "data-nb-theme")).toBe("nbook");
    expect(await html(free, "data-nb-theme")).toBe("macos");

    await runCommand(bound, "切换主题");
    await choose(bound, "macOS");
    await expect.poll(async () => JSON.parse(await readFile(projectFile(), "utf8")) as unknown).toEqual({"nbook.workbench/theme": "macos"});
    await expect.poll(() => html(bound, "data-nb-theme")).toBe("macos");
    // 用户层没有被这次切换改动。
    expect(JSON.parse(await readFile(userFile(), "utf8")) as unknown).toEqual({"nbook.workbench/theme": "macos"});
    await context.close();
});

test("明暗跟随系统：系统明暗变化时页面即时跟着变，配置仍是 system；改成显式明暗后不再跟随", async ({page}) => {
    await page.emulateMedia({colorScheme: "light"});
    await writeFile(userFile(), "{\"nbook.workbench/appearance\": \"system\"}");
    await open(page);
    await expect.poll(() => html(page, "data-nb-appearance")).toBe("light");
    await page.emulateMedia({colorScheme: "dark"});
    await expect.poll(() => html(page, "data-nb-appearance")).toBe("dark");
    expect(JSON.parse(await readFile(userFile(), "utf8")) as unknown).toEqual({"nbook.workbench/appearance": "system"});

    await writeFile(userFile(), "{\"nbook.workbench/appearance\": \"light\"}");
    await expect.poll(() => html(page, "data-nb-appearance")).toBe("light");
    await page.emulateMedia({colorScheme: "light"});
    await page.emulateMedia({colorScheme: "dark"});
    // 屏障：之后的一次配置变化生效时，前面的系统明暗变化事件早已派发完。
    await writeFile(userFile(), "{\"nbook.workbench/appearance\": \"light\", \"nbook.workbench/theme\": \"macos\"}");
    await expect.poll(() => html(page, "data-nb-theme")).toBe("macos");
    expect(await html(page, "data-nb-appearance")).toBe("light");
});

test("Lab 显示期间改产品主题：Lab 的文档根不变；回到产品页后按最新配置应用", async ({page}) => {
    const devRoot = join(tmp, "dev-state");
    await mkdir(devRoot, {recursive: true});
    const dev = await startDevSession(devRoot);
    try {
        await page.goto(`${dev.pageUrl}lab`);
        await expect(page.locator(".lab-root")).toBeVisible();
        const labTheme = await html(page, "data-nb-theme");
        const labAppearance = await html(page, "data-nb-appearance");

        await writeFile(join(devRoot, "settings.json"), "{\"nbook.workbench/theme\": \"macos\", \"nbook.workbench/appearance\": \"dark\"}");
        // 等服务端读到新配置：另开一个产品页看到 macos，说明已经推到窗口。
        const probe = await page.context().newPage();
        await probe.goto(dev.pageUrl);
        await expect.poll(() => html(probe, "data-nb-theme")).toBe("macos");
        await probe.close();
        expect(await html(page, "data-nb-theme")).toBe(labTheme);
        expect(await html(page, "data-nb-appearance")).toBe(labAppearance);

        await page.goto(dev.pageUrl);
        await expect.poll(() => html(page, "data-nb-theme")).toBe("macos");
        await expect.poll(() => html(page, "data-nb-appearance")).toBe("dark");
    } finally {
        dev.child.kill("SIGTERM");
        expect(await dev.exit).toBe(0);
    }
});

// ── 设置窗口（docs/specs/settings/settings-window.md 验收 1–4，ui/workbench-shell.md 验收 43–44，bookshelf.md 输出 1） ──

const settingsWindow = (page: Page) => page.locator("[data-settings-window]");
const workbenchGear = (page: Page) => page.locator("[data-activity-item='nbook.settings']");
const shelfGear = (page: Page) => page.locator("[data-shelf-settings]");
const row = (page: Page, key: string) => page.locator(`[data-settings-row="${key}"]`);
/** 设置文件按 JSONC 读：删掉一个键时写入路径保留注释，可能留下合法的尾随逗号。 */
const readSettings = async (path: string): Promise<unknown> => parseJsonc(await readFile(path, "utf8")) as unknown;

/** 按 `Ctrl+,`：命令宿主随页面异步加载，按到窗口出现（或已开着的窗口拿回焦点）为止。 */
async function pressOpenSettings(page: Page): Promise<void> {
    await expect(async () => {
        await page.keyboard.press("Control+,");
        await expect(page.locator("[data-settings-nav-current]")).toBeFocused({timeout: 500});
    }).toPass();
}

test("工作台活动栏的齿轮、书架的齿轮与 Ctrl+, 打开同一个窗口；再触发只聚焦；窗口开着时齿轮按下", async ({page}) => {
    const problems: string[] = [];
    watchConsole(page, problems);
    await open(page, "/?project=book");
    // 活动栏最下面：头像占位在上、齿轮在下。
    const bottom = page.locator("[data-activity-items] [data-activity-item]");
    await expect(bottom).toHaveCount(2);
    expect(await bottom.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-activity-item")))).toEqual(["nbook.workbench.profile", "nbook.settings"]);
    await expect(page.locator("[data-activity-item='nbook.workbench.profile']")).toHaveAttribute("aria-label", "个人资料尚未开放");
    await expect(workbenchGear(page)).toHaveAttribute("aria-pressed", "false");

    await workbenchGear(page).click();
    await expect(settingsWindow(page)).toHaveCount(1);
    await expect(workbenchGear(page)).toHaveAttribute("aria-pressed", "true");
    // 焦点挪到窗口里别处，再点齿轮：还是这一个窗口，焦点回到左栏的当前项。
    await row(page, "nbook.workbench/theme").getByRole("radio", {name: "macOS"}).focus();
    await workbenchGear(page).click();
    await expect(settingsWindow(page)).toHaveCount(1);
    await expect(page.locator("[data-settings-nav-current]")).toBeFocused();
    await row(page, "nbook.workbench/theme").getByRole("radio", {name: "macOS"}).focus();
    await pressOpenSettings(page);
    await expect(settingsWindow(page)).toHaveCount(1);

    // Esc 关窗口：焦点回到打开窗口之前的位置（第一次是点齿轮打开的），齿轮回到没按下；Ctrl+, 再打开同一个窗口。
    await page.keyboard.press("Escape");
    await expect(settingsWindow(page)).toHaveCount(0);
    await expect(workbenchGear(page)).toBeFocused();
    await expect(workbenchGear(page)).toHaveAttribute("aria-pressed", "false");
    await pressOpenSettings(page);
    await expect(settingsWindow(page)).toHaveCount(1);
    await expect(workbenchGear(page)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");

    // 书架：右上角的齿轮在头像左边，打开同一个窗口（首页也挂着设置浮层）。
    await open(page, "/");
    await expect(page.locator("[data-bookshelf-page]")).toBeVisible();
    await expect(shelfGear(page)).toHaveAttribute("aria-pressed", "false");
    await shelfGear(page).click();
    await expect(settingsWindow(page)).toHaveCount(1);
    await expect(shelfGear(page)).toHaveAttribute("aria-pressed", "true");
    await row(page, "nbook.workbench/theme").getByRole("radio", {name: "macOS"}).focus();
    await shelfGear(page).click();
    await expect(settingsWindow(page)).toHaveCount(1);
    await expect(page.locator("[data-settings-nav-current]")).toBeFocused();
    // 没有绑定作品：没有“用户 | 本作品”。
    await expect(page.locator("[data-settings-tabs]")).toHaveCount(0);
    expect(problems).toEqual([]);
});

test("用户标签改主题，两个页面即时变化；本作品标签单独设明暗后用户标签出现覆盖提示（写着书名），移除后消失", async ({browser}) => {
    const context = await browser.newContext();
    const a = await context.newPage();
    const b = await context.newPage();
    await open(a, "/?project=book");
    await open(b, "/?project=book");
    await workbenchGear(a).click();
    await expect(settingsWindow(a)).toBeVisible();

    await row(a, "nbook.workbench/theme").getByRole("radio", {name: "macOS"}).click();
    await expect.poll(() => html(a, "data-nb-theme")).toBe("macos");
    await expect.poll(() => html(b, "data-nb-theme")).toBe("macos");
    await expect.poll(() => readSettings(userFile())).toEqual({"nbook.workbench/theme": "macos"});

    await a.locator("[data-settings-tabs]").getByRole("radio", {name: "本作品"}).click();
    const appearance = row(a, "nbook.workbench/appearance");
    await expect(appearance).toHaveAttribute("data-settings-row-state", "inherit");
    await appearance.locator("[data-settings-row-override]").click();
    await expect(appearance).toHaveAttribute("data-settings-row-state", "edit");
    await appearance.getByRole("radio", {name: "深色"}).click();
    await expect.poll(() => readSettings(projectFile())).toEqual({"nbook.workbench/appearance": "dark"});
    await expect.poll(() => html(b, "data-nb-appearance")).toBe("dark");

    await a.locator("[data-settings-tabs]").getByRole("radio", {name: "用户"}).click();
    // 没写书名：书名是目录原名 Book（不是短名 book）。
    await expect(appearance.locator("[data-settings-row-overridden]")).toContainText("《Book》");

    await a.locator("[data-settings-tabs]").getByRole("radio", {name: "本作品"}).click();
    await appearance.locator("[data-settings-row-remove]").click();
    await expect(appearance).toHaveAttribute("data-settings-row-state", "inherit");
    await a.locator("[data-settings-tabs]").getByRole("radio", {name: "用户"}).click();
    await expect(appearance.locator("[data-settings-row-overridden]")).toHaveCount(0);
    await expect.poll(() => readSettings(projectFile())).toEqual({});
    await context.close();
});

test("改过的项有已修改标记；恢复默认后键从 settings.json 删掉，其余内容与注释不变", async ({page}) => {
    await open(page, "/?project=book");
    await workbenchGear(page).click();
    const appearance = row(page, "nbook.workbench/appearance");
    await expect(appearance).not.toHaveAttribute("data-settings-row-modified", "");
    await appearance.getByRole("radio", {name: "深色"}).click();
    await expect(appearance).toHaveAttribute("data-settings-row-modified", "");
    await expect.poll(() => readSettings(userFile())).toEqual({"nbook.workbench/theme": "nbook", "nbook.workbench/appearance": "dark"});

    await appearance.locator("[data-settings-row-reset]").click();
    await expect(appearance).not.toHaveAttribute("data-settings-row-modified", "");
    await expect.poll(() => readSettings(userFile())).toEqual({"nbook.workbench/theme": "nbook"});
    const written = await readFile(userFile(), "utf8");
    expect(written).toContain("// 我的设置");
    expect(written).toContain("// 主题");
});

test("用户层文件改坏：分区顶部出现说明、控件停用；修好后说明消失、控件恢复", async ({page}) => {
    await open(page, "/?project=book");
    await workbenchGear(page).click();
    const macos = row(page, "nbook.workbench/theme").getByRole("radio", {name: "macOS"});
    await expect(macos).toBeEnabled();
    await writeFile(userFile(), "{\"nbook.workbench/theme\": \"nbook\",,}");
    await expect(page.locator("[data-settings-layer-notice='invalid']")).toBeVisible();
    await expect(macos).toBeDisabled();
    await writeFile(userFile(), USER_FILE);
    await expect(page.locator("[data-settings-layer-notice]")).toHaveCount(0);
    await expect(macos).toBeEnabled();
});

test("调整窗口大小后关掉再开、刷新页面仍是这个尺寸，每次打开居中；切换分区时尺寸不变", async ({page}) => {
    await open(page, "/?project=book");
    await workbenchGear(page).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const width = async (): Promise<number> => Math.round((await dialog.boundingBox())!.width);
    // 打开时窗口从略小处放大（nb-ui Dialog 的进场动画）：量尺寸与位置之前等它播完，否则量到的是缩放中的外框。
    const settled = (): Promise<unknown> => dialog.evaluate((element) => Promise.all(element.getAnimations({subtree: true}).map((animation) => animation.finished)));
    await settled();
    const before = await width();
    // 方向键一次 10px（nb-ui 浮动窗口），收窄两次。
    await dialog.locator("[data-dialog-resize='right']").focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect.poll(width).toBeLessThan(before);
    const resized = await width();
    await page.locator("[data-settings-nav='nbook.works']").click();
    expect(await width()).toBe(resized);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await workbenchGear(page).click();
    await expect(dialog).toBeVisible();
    await settled();
    expect(await width()).toBe(resized);
    // 收窄时左边不动、窗口偏到左边；位置不记，再打开时重新居中。
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    if (box === null || viewport === null) throw new Error("量不到窗口或视口");
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1);

    await page.reload();
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
    await workbenchGear(page).click();
    await expect(dialog).toBeVisible();
    await settled();
    expect(await width()).toBe(resized);
});

// ── 搜索、设置文件视图（settings-window.md 输出 21、23）与 Lab“模型服务”（输出 20、22） ──

test("Ctrl+F 聚焦设置里的搜索框；搜到“明暗”直接改掉；Esc 先清空搜索、窗口不关", async ({page}) => {
    await open(page, "/?project=book");
    await workbenchGear(page).click();
    await page.keyboard.press("Control+f");
    const search = page.locator("[data-settings-search] input");
    await expect(search).toBeFocused();
    await search.fill("明暗");
    const appearance = row(page, "nbook.workbench/appearance");
    await expect(page.locator("[data-settings-row]")).toHaveCount(1);
    await appearance.getByRole("radio", {name: "深色"}).click();
    await expect.poll(() => readSettings(userFile())).toEqual({"nbook.workbench/theme": "nbook", "nbook.workbench/appearance": "dark"});
    await search.focus();
    await page.keyboard.press("Escape");
    await expect(search).toHaveValue("");
    await expect(settingsWindow(page)).toBeVisible();
    await expect(page.locator("[data-settings-section='nbook.appearance']")).toBeVisible();
});

test("设置文件视图：看到带注释的全文，改主题后 Ctrl+S 保存，文件原样落盘、页面跟着变；别处把文件改坏后经它修好", async ({page}) => {
    const problems: string[] = [];
    watchConsole(page, problems);
    await open(page, "/?project=book");
    await workbenchGear(page).click();
    await page.locator("[data-settings-nav='file']").click();
    const text = page.locator("[data-settings-file-text]");
    await expect(text).toHaveValue(USER_FILE);
    const next = USER_FILE.replace("\"nbook\"", "\"macos\"");
    await text.fill(next);
    await text.press("Control+s");
    await expect.poll(() => readFile(userFile(), "utf8")).toBe(next);
    await expect.poll(() => html(page, "data-nb-theme")).toBe("macos");
    await expect(page.locator("[data-settings-file-actions]").getByRole("button", {name: "保存"})).toBeDisabled();

    await writeFile(userFile(), "{\"nbook.workbench/theme\": \"nbook\",,}");
    await expect(text).toHaveValue("{\"nbook.workbench/theme\": \"nbook\",,}");
    await expect(page.locator("[data-settings-layer-notice='invalid']")).toBeVisible();
    await text.fill("{\n    \"nbook.workbench/theme\": \"nbook\"\n    \"x\": 1\n}");
    await page.locator("[data-settings-file-actions]").getByRole("button", {name: "保存"}).click();
    await expect(page.locator("[data-settings-file-error]")).toContainText("第 3 行第 5 列");
    await text.fill(USER_FILE);
    await page.locator("[data-settings-file-actions]").getByRole("button", {name: "保存"}).click();
    await expect(page.locator("[data-settings-layer-notice]")).toHaveCount(0);
    expect(await readFile(userFile(), "utf8")).toBe(USER_FILE);
    expect(problems).toEqual([]);
});

test("Lab“模型服务”：打开时才激活；加一家服务商没填好时保存被拒，填好后保存；有改动时切分区先确认", async ({page}) => {
    const devRoot = join(tmp, "dev-models");
    await mkdir(devRoot, {recursive: true});
    const dev = await startDevSession(devRoot);
    try {
        await page.goto(`${dev.pageUrl}lab?c=SettingsWindow&s=page-fill`);
        const models = page.locator("[data-sample-models]");
        await expect(models).toBeVisible();
        const items = models.locator("[data-nb-list-action='select']");
        await expect(items).toHaveText(["DeepSeek", "本地 Ollama"]);
        // 第一个“添加”是服务商列表的，详情里“模型”列表另有一个。
        await models.locator("[data-nb-list-add]").first().click();
        await expect(page.locator("[data-sample-models-actions]").getByRole("button", {name: "保存"})).toBeEnabled();
        await page.locator("[data-sample-models-actions]").getByRole("button", {name: "保存"}).click();
        await expect(page.locator("[data-sample-models-failure]")).toContainText("还没保存");
        const detail = models.locator("[data-nb-detail]");
        await detail.getByLabel("标识").fill("openai");
        await detail.getByLabel("名称").fill("OpenAI");
        await detail.getByLabel("接口地址").fill("https://api.openai.com/v1");
        await detail.getByLabel("超时").fill("30");
        await detail.getByLabel("超时").blur();
        await page.locator("[data-sample-models-actions]").getByRole("button", {name: "保存"}).click();
        await expect(page.locator("[data-sample-models-actions]").getByRole("button", {name: "保存"})).toBeDisabled();
        await expect(items).toHaveText(["DeepSeek", "本地 Ollama", "OpenAI"]);

        await detail.getByLabel("名称").fill("OpenAI 官方");
        await detail.getByLabel("名称").blur();
        await page.locator("[data-settings-nav='nbook.appearance']").click();
        const dialog = page.getByRole("alertdialog");
        await expect(dialog).toContainText("放弃未保存的改动？");
        await expect(dialog.getByRole("button", {name: "继续编辑"})).toBeFocused();
        await dialog.getByRole("button", {name: "继续编辑"}).click();
        await expect(dialog).toHaveCount(0);
        await expect(models).toBeVisible();
        await page.locator("[data-settings-nav='nbook.appearance']").click();
        await page.getByRole("alertdialog").getByRole("button", {name: "放弃"}).click();
        await expect(page.locator("[data-settings-section='nbook.appearance']")).toBeVisible();
    } finally {
        dev.child.kill("SIGTERM");
        expect(await dev.exit).toBe(0);
    }
});
