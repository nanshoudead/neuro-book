/**
 * nb-form 渲染层在 Lab 场景里的真实浏览器行为（docs/specs/ui/forms.md 验收 1、3、6）：每种控件的可访问名称是字段
 * 标签、说明是字段说明、出错时有错误信息；问题汇总点一条聚焦到字段；条件显示切换后填过的值还在；展示态 Tab 只停在
 * 展开与复制按钮上。happy-dom 算不出可访问名称，所以这些在这里断言。
 */

import {rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {LabDebugState} from "nbook/plugins/lab/shared/debug-api";

import {startDevSession} from "./fixtures";
import type {DevSession} from "./fixtures";

let tmp = "";
let dev: DevSession;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-nb-form");
    dev = await startDevSession(join(tmp, "state"));
});

test.afterAll(async () => {
    dev.child.kill("SIGTERM");
    expect(await dev.exit).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const labState = (page: Page) => page.evaluate(() => (window as unknown as {__nbLab?: {state(): LabDebugState}}).__nbLab?.state() ?? null);

async function openScene(page: Page, query: string): Promise<void> {
    await page.setViewportSize({width: 1440, height: 1200});
    await page.goto(`${dev.pageUrl}lab?${query}`);
    await expect.poll(async () => (await labState(page))?.ready).toBe(true);
}

/** 舞台里的被测表单；Lab 外壳自己也有输入框与下拉，所以限定在舞台里。 */
const stage = (page: Page) => page.locator(".lab-main [data-lab-stage]");

test("每种控件的可访问名称是字段标签，说明是字段说明", async ({page}) => {
    await openScene(page, "c=SchemaForm&s=controls");
    const form = stage(page);
    await expect(form.getByRole("switch", {name: "启用同步"})).toHaveAccessibleDescription("打开后每次保存都推送到远端");
    await expect(form.getByRole("radiogroup", {name: "同意条款"})).toBeVisible();
    await expect(form.getByRole("radiogroup", {name: "接口格式"})).toBeVisible();
    await expect(form.getByRole("combobox", {name: "地区"})).toBeVisible();
    await expect(form.getByRole("combobox", {name: "模型"})).toBeVisible();
    await expect(form.getByRole("group", {name: "标签"})).toBeVisible();
    await expect(form.getByLabel("超时")).toHaveValue("30");
    await expect(form.getByRole("textbox", {name: "名称"})).toHaveValue("本地模型");
    await expect(form.getByRole("textbox", {name: "备注"})).toBeVisible();
    // 组里的复选框不拿字段的 id（字段 id 在组根上），各自的 id 也不重复。
    const group = form.getByRole("group", {name: "标签"});
    const fieldId = await group.getAttribute("id");
    const ids = (await form.getByRole("checkbox").evaluateAll((boxes) => boxes.map((box) => box.id))).filter((id) => id !== "");
    expect(fieldId).not.toBeNull();
    expect(ids).not.toContain(fieldId);
    expect(new Set(ids).size).toBe(ids.length);
});

test("出错的字段带错误信息；问题汇总点一条聚焦到字段", async ({page}) => {
    await openScene(page, "c=SchemaForm&s=issues");
    const form = stage(page);
    const retries = form.getByLabel("重试次数");
    await expect(retries).toHaveAttribute("aria-invalid", "true");
    await expect(retries).toHaveAccessibleDescription("不能大于 5");
    await expect(form.getByRole("textbox", {name: "说明"})).not.toHaveAttribute("aria-invalid", "true");
    const toggle = form.getByRole("button", {name: "4 个问题"});
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await form.getByRole("button", {name: "重试次数：不能大于 5"}).click();
    await expect(retries).toBeFocused();
});

test("数字写成 `1.` 不提交，报无法解析；切换接口格式时代理隐藏又出现，填过的值还在", async ({page}) => {
    await openScene(page, "c=SchemaForm&s=conditional");
    const form = stage(page);
    const timeout = form.getByLabel("超时");
    await timeout.fill("1.");
    await timeout.press("Tab");
    await expect(timeout).toHaveAttribute("aria-invalid", "true");
    await form.getByRole("button", {name: "1 个问题"}).click();
    await expect(form.getByRole("button", {name: "超时：无法解析"})).toBeVisible();

    const proxy = form.getByRole("textbox", {name: "代理"});
    await proxy.fill("http://127.0.0.1:7890");
    await proxy.press("Enter");
    await form.getByRole("radio", {name: "anthropic"}).click();
    await expect(proxy).toBeHidden();
    await form.getByRole("radio", {name: "openai"}).click();
    await expect(proxy).toHaveValue("http://127.0.0.1:7890");
});

test("展示态：长路径与多行文字完整可见，Tab 只停在展开与复制按钮上", async ({page}) => {
    await openScene(page, "c=SchemaForm&s=view");
    const form = stage(page);
    await expect(form).toContainText("没有说出口的那句话.md");
    await expect(form.getByRole("textbox")).toHaveCount(0);
    const expand = form.getByRole("button", {name: "展开"});
    await expand.click();
    await expect(form.getByRole("button", {name: "收起"})).toHaveAttribute("aria-expanded", "true");
    await expect(form).toContainText("第 12 段");
    const stops = await form.locator("*").evaluateAll((elements) => elements
        .filter((element) => (element as HTMLElement).tabIndex >= 0 && !(element as HTMLElement).closest("[inert]"))
        .map((element) => `${element.tagName}:${element.textContent?.trim() ?? ""}`));
    expect(stops).toEqual(["BUTTON:复制", "BUTTON:收起", "BUTTON:复制"]);
});
