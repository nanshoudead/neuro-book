/**
 * 第三方插件的安装与启停在真实 Chrome 与生产构建上的验收（docs/specs/runtime/plugin-install.md 输出 1–4、9 与场景 1、3、13，
 * docs/specs/runtime/plugin-manifest.md 输出 11）：从设置窗口的插件页安装 `examples/external/declarative`，重启后它的配置项
 * 出现在设置窗口、能写进本作品层（项目子进程登记了它的声明）；禁用、重启后消失；卸载、重启后登记表与安装目录清空。
 * “重启”是有序停止服务端再在同一个状态根上起一个新进程。
 */

import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {parse as parseJsonc} from "jsonc-parser";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {PACKAGE_ROOT, startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

const SOURCE = join(PACKAGE_ROOT, "examples", "external", "declarative");
const SETTING = "example.hello/greeting";

let tmp = "";
let stateRoot = "";
let projectDir = "";
let server: ProductServer | null = null;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "plugins");
    stateRoot = join(tmp, "state");
    projectDir = join(tmp, "Book");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await mkdir(stateRoot, {recursive: true});
    await writeFile(join(projectDir, ".nbook", "project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
});

test.afterAll(async () => {
    if (server !== null) expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 先让页面离开：页面开着时停服务端，配置层断开会记一条 `settings.layer.unavailable` 警告，那是重启本身的结果。 */
async function restart(page: Page): Promise<void> {
    await page.goto("about:blank");
    if (server !== null) expect(await server.stop()).toBe(0);
    server = await startProductServer(stateRoot);
}

function watchConsole(page: Page, problems: string[]): void {
    page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
}

/** 打开绑定作品的工作台并打开设置窗口，切到某个分区。 */
async function openSettings(page: Page, section: string): Promise<void> {
    await page.goto(new URL("/?project=book", server!.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
    await page.locator("[data-activity-item='nbook.settings']").click();
    await expect(page.locator("[data-settings-window]")).toBeVisible();
    await page.locator(`[data-settings-nav="${section}"]`).click();
}

const pluginRow = (page: Page, id: string) => page.locator(`[data-plugin-row="${id}"]`);
const settingRow = (page: Page) => page.locator(`[data-settings-row="${SETTING}"]`);
const readJson = async (path: string): Promise<unknown> => parseJsonc(await readFile(path, "utf8")) as unknown;
const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false);

test("安装 → 重启后配置项出现、能写进本作品层 → 禁用 → 重启后消失 → 卸载 → 重启后清空", async ({page}) => {
    const problems: string[] = [];
    watchConsole(page, problems);
    await restart(page);

    // 插件页：内置插件标“内置”、没有操作；安装要先确认完全信任；装好后列为“重启后安装”，提示重启。
    await openSettings(page, "nbook.plugins.installed");
    await expect(pluginRow(page, "nbook.settings")).toContainText("内置");
    await expect(pluginRow(page, "nbook.settings").locator("[data-plugin-toggle]")).toHaveCount(0);
    await page.locator("[data-plugin-path] input, input[data-plugin-path]").first().fill(SOURCE);
    await page.locator("[data-plugin-install]").click();
    const dialog = page.getByRole("dialog", {name: "安装插件"});
    await expect(dialog).toContainText("可以访问全部作品、服务器与本机资源");
    await dialog.getByRole("button", {name: "安装"}).click();
    await expect(pluginRow(page, "example.hello").locator("[data-plugin-pending='install']")).toBeVisible();
    await expect(page.locator("[data-plugins-restart]")).toContainText("重启 NeuroBook 后生效");
    // 本次运行里插件没有登记：“其它”分区里没有它的配置项。
    await expect(page.locator("[data-settings-nav='other']")).toHaveCount(0);

    await restart(page);
    await openSettings(page, "other");
    await expect(settingRow(page)).toBeVisible();
    // 本作品层也接受这一项：项目子进程登记了它的顶层声明。
    await page.locator("[data-settings-tabs]").getByRole("radio", {name: "本作品"}).click();
    await expect(settingRow(page)).toHaveAttribute("data-settings-row-state", "inherit");
    await settingRow(page).locator("[data-settings-row-override]").click();
    await expect(settingRow(page)).toHaveAttribute("data-settings-row-state", "edit");
    await expect.poll(() => readJson(join(projectDir, ".nbook", "settings.json"))).toEqual({[SETTING]: "Hello from a plugin"});

    await page.locator("[data-settings-tabs]").getByRole("radio", {name: "用户"}).click();
    await page.locator("[data-settings-nav='nbook.plugins.installed']").click();
    await expect(pluginRow(page, "example.hello").locator("[data-plugin-pending]")).toHaveCount(0);
    await pluginRow(page, "example.hello").locator("[data-plugin-toggle]").click();
    await expect(pluginRow(page, "example.hello").locator("[data-plugin-pending='disable']")).toBeVisible();

    await restart(page);
    await openSettings(page, "nbook.plugins.installed");
    await expect(page.locator("[data-settings-nav='other']")).toHaveCount(0);
    await pluginRow(page, "example.hello").locator("[data-plugin-uninstall]").click();
    await page.getByRole("dialog", {name: "卸载插件"}).getByRole("button", {name: "卸载"}).click();
    await expect(pluginRow(page, "example.hello").locator("[data-plugin-pending='uninstall']")).toBeVisible();
    expect(await exists(join(stateRoot, "plugins", "example.hello", "1.0.0", "package.json"))).toBe(true);

    await restart(page);
    expect(await readJson(join(stateRoot, "plugins", "plugins.json"))).toEqual({schema: "nbook.plugins/v1", plugins: {}});
    expect(await exists(join(stateRoot, "plugins", "example.hello"))).toBe(false);
    await openSettings(page, "nbook.plugins.installed");
    await expect(pluginRow(page, "example.hello")).toHaveCount(0);
    expect(problems).toEqual([]);
});
