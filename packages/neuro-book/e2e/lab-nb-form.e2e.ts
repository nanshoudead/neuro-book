/**
 * nb-form 渲染层在 Lab 场景里的真实浏览器行为（docs/specs/ui/forms.md 验收 1、3、4、6）：每种控件的可访问名称是字段
 * 标签、说明是字段说明、出错时有错误信息；问题汇总点一条聚焦到字段；条件显示切换后填过的值还在；扩展参数写坏时报
 * 无法解析；列表增删排序的焦点落点与播报；展示态 Tab 只停在展开与复制按钮上。happy-dom 算不出可访问名称，也没有真实
 * 的焦点移动，所以这些在这里断言。
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

test("服务商连接：扩展参数写坏时报无法解析，汇总里点它聚焦到 JSON 框", async ({page}) => {
    await openScene(page, "c=SchemaForm&s=conditional");
    const form = stage(page);
    const extra = form.getByRole("textbox", {name: "扩展参数"});
    await expect(extra).toHaveValue('{\n  "temperature": 0.7\n}');
    await extra.fill('{"temperature": ');
    await extra.press("Tab");
    await expect(extra).toHaveAttribute("aria-invalid", "true");
    await form.getByRole("button", {name: "1 个问题"}).click();
    await form.getByRole("button", {name: "扩展参数：无法解析"}).click();
    await expect(extra).toBeFocused();
    // 分组可以折叠：折叠后里面的字段不挂载，标题旁写里面的问题数。折叠会丢掉没提交的草稿（输出 21：折叠的分组不
    // 挂载），所以先改好扩展参数，再让超时违反 schema。
    await extra.fill("{}");
    await extra.press("Tab");
    const timeout = form.getByLabel("超时");
    await timeout.fill("0");
    await timeout.press("Tab");
    const advanced = form.getByRole("button", {name: "高级"});
    await advanced.click();
    await expect(advanced).toHaveAttribute("aria-expanded", "false");
    await expect(timeout).toHaveCount(0);
    await expect(advanced).toContainText("含 1 个问题");
});

test("对象列表：添加、删除中间项、上移与 Alt+↑，焦点落点与读屏播报（验收 4）", async ({page}) => {
    await openScene(page, "c=SchemaForm&s=lists");
    const people = stage(page).getByRole("group", {name: "人物", exact: true});
    const live = people.locator("[aria-live='polite']");

    await people.getByRole("button", {name: "添加"}).click();
    await expect(people.getByRole("textbox", {name: "名字"}).nth(2)).toBeFocused();
    await expect(live).toHaveText("已添加第 3 项");

    await people.getByRole("button", {name: "删除：沈三"}).click();
    await expect(people.getByRole("button", {name: "删除：第 2 项"})).toBeFocused();
    await expect(live).toHaveText("已删除第 2 项");

    await people.getByRole("button", {name: "上移：第 2 项"}).click();
    await expect(people.getByRole("button", {name: "下移：第 1 项"})).toBeFocused();
    await expect(live).toHaveText("第 2 项移到第 1 位");

    // 焦点在项里的输入框时 Alt+↑ 移动这一项，焦点留在原来的输入框上。
    const lin = people.getByRole("textbox", {name: "名字"}).nth(1);
    await expect(lin).toHaveValue("林照");
    await lin.focus();
    await page.keyboard.press("Alt+ArrowUp");
    await expect(people.getByRole("textbox", {name: "名字"}).first()).toHaveValue("林照");
    await expect(people.getByRole("textbox", {name: "名字"}).first()).toBeFocused();
});

test("左列表右详情：点标题选中，新增的项自动选中并聚焦详情", async ({page}) => {
    await openScene(page, "c=SchemaForm&s=lists");
    const servers = stage(page).getByRole("group", {name: "服务", exact: true});
    await servers.getByRole("button", {name: "备用", exact: true}).click();
    await expect(servers.getByRole("button", {name: "备用", exact: true})).toHaveAttribute("aria-current", "true");
    await expect(servers.getByRole("textbox", {name: "名称"})).toHaveValue("备用");
    await servers.getByRole("button", {name: "添加"}).click();
    await expect(servers.getByRole("button", {name: "第 3 项", exact: true})).toHaveAttribute("aria-current", "true");
    await expect(servers.getByRole("textbox", {name: "名称"})).toBeFocused();
});

test("自定义控件：名字来自字段标签，选一颗星就提交", async ({page}) => {
    await openScene(page, "c=SchemaForm&s=custom");
    const rating = stage(page).getByRole("radiogroup", {name: "评分"});
    await expect(rating.getByRole("radio", {name: "4 星"})).toHaveAttribute("aria-checked", "true");
    await rating.getByRole("radio", {name: "2 星"}).click();
    await expect(rating.getByRole("radio", {name: "2 星"})).toHaveAttribute("aria-checked", "true");
});
