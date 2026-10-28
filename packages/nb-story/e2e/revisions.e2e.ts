/**
 * 图的修订的真实浏览器验收（docs/specs/story/viewer.md 输出 58 到 62、验收 14）：生产构建的网页、真实的 `nbstory serve`、
 * 100 章样例书。样例书第 30 章第 61 段有一条候选身份说法 s30-13（e30-1 与 e10-1）。
 */

import {expect, test, type Page} from "@playwright/test";

import {login, makeLibrary, startServe, type StoryServer} from "./fixtures";

let server: StoryServer;
let cleanup: () => Promise<void>;

test.beforeAll(async () => {
    const library = await makeLibrary("revisions");
    cleanup = library.cleanup;
    server = await startServe(library.library);
});
test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    await cleanup();
});
test.beforeEach(async ({context}) => {
    await login(context, server);
});

async function open(page: Page, path: string): Promise<void> {
    await page.goto(`${server.base}${path}`);
    await expect(page.getByTestId("book-frame")).toBeVisible();
}
async function rpc<T>(page: Page, method: string, params: Record<string, unknown>): Promise<T> {
    const response = await page.context().request.post(`${server.base}/api/rpc/${method}`, {data: {book: "fox", ...params}});
    expect(response.ok()).toBe(true);
    return (await response.json()) as T;
}
type Counts = {counts: {pending: number; adopted: number; rejected: number; closed: number; stale: number}};

test("人物卡上就地确认：头部有候选块，确认后消失、导航角标减一，撤销后回来；刷新后修订还在（输出 59、62）", async ({page}) => {
    await open(page, "/book/fox/roster?at=30.61&entity=e30-1");
    const block = page.getByTestId("candidate-block");
    await expect(block).toBeVisible();
    await expect(block).toContainText("确认后从第 30 章第 61 段起生效");
    await expect(page.getByTestId("revisions-badge")).toHaveText("1");
    await page.getByTestId("candidate-confirm").click();
    await expect(page.getByTestId("candidate-done")).toContainText("已确认");
    await expect(page.getByTestId("candidate-confirm")).toHaveCount(0);
    await expect(page.getByTestId("revisions-badge")).toHaveCount(0);
    expect((await rpc<Counts>(page, "revisions.list", {at: {chapter: 30, paragraph: 61}})).counts).toMatchObject({adopted: 1, pending: 0});
    await page.reload();
    await expect(page.getByTestId("book-frame")).toBeVisible();
    expect((await rpc<Counts>(page, "revisions.list", {at: {chapter: 30, paragraph: 61}})).counts.adopted).toBe(1);
    await open(page, "/book/fox/revisions?at=30.61");
    await page.getByRole("tab", { name: /已处理/u }).click();
    await page.getByTestId("revision-undo").click();
    await page.getByRole("tab", { name: /待确认/u }).click();
    await expect(page.locator('[data-revision="st:s30-13"]')).toBeVisible();
});

test("待确认页：卡片带依据原文，驳回后到已处理，撤销后回到待确认；点卡片在抽屉打开人物卡（输出 58）", async ({page}) => {
    await open(page, "/book/fox/revisions?at=30.61");
    const card = page.locator('[data-revision="st:s30-13"]');
    await expect(card).toBeVisible();
    await expect(card.getByTestId("revision-summary")).not.toBeEmpty();
    await card.click({position: {x: 30, y: 10}});
    await expect(page.getByTestId("entity-card")).toBeVisible();
    await page.getByTestId("revision-reject").click();
    await expect(page.getByTestId("revisions-last")).toContainText("已驳回");
    await expect(card).toHaveCount(0);
    await page.getByRole("tab", { name: /已处理/u }).click();
    await expect(page.locator('[data-state="rejected"]')).toBeVisible();
    await page.getByTestId("revision-undo").click();
    await page.getByRole("tab", { name: /待确认/u }).click();
    await expect(page.locator('[data-revision="st:s30-13"]')).toBeVisible();
});

test("“⋯”菜单：改对象种类与连到另一个对象，依据段必选；失败写在对话框里不关闭；改完人物卡与统计跟着变（输出 60）", async ({page}) => {
    await open(page, "/book/fox/roster?at=3.30&entity=e3-2");
    await page.getByTestId("card-revise-menu").click();
    await page.getByRole("menuitem", { name: /改对象种类/u }).click();
    const dialog = page.getByTestId("revise-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("revise-submit")).toBeDisabled();
    await dialog.locator("[data-ref]").first().click();
    await expect(page.getByTestId("revise-submit")).toBeEnabled();
    await page.getByTestId("revise-submit").click();
    await expect(dialog).toHaveCount(0);
    const list = await rpc<{items: {op: string; state: string}[]}>(page, "revisions.list", {at: {chapter: 3, paragraph: 30}, state: "adopted"});
    expect(list.items.map(item => item.op)).toContain("kind.set");

    await page.getByTestId("card-revise-menu").click();
    await page.getByRole("menuitem", { name: /连到另一个对象/u }).click();
    await page.getByPlaceholder("例如 5.75").fill("999.1");
    await page.getByPlaceholder("按名字或称呼搜").fill("苏天晴");
    await page.locator('[data-entity="e1-1"]').click();
    await page.getByTestId("revise-submit").click();
    await expect(page.getByTestId("revise-error")).toContainText("第 999 章");
    await expect(page.getByTestId("revise-dialog")).toBeVisible();
});

test("手机宽度：待确认页单列、“更多”带角标且完整导航里有“待确认”；点卡片从底部拉起人物卡并能确认（输出 61）", async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await open(page, "/book/fox/revisions?at=30.61");
    await expect(page.locator('[data-revision="st:s30-13"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // 前面的用例把抽屉里的人物卡存进了阅读状态，手机上它会浮在页面上：先关掉。
    if (await page.getByTestId("drawer").isVisible()) await page.getByTestId("drawer-scrim").click({position: {x: 10, y: 10}});
    await page.getByRole("button", { name: /更多/u }).click();
    await expect(page.getByRole("navigation", { name: "页面" }).getByText("待确认")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.mouse.click(300, 400);
    await open(page, "/book/fox/roster?at=30.61&entity=e30-1");
    await expect(page.getByTestId("candidate-block")).toBeVisible();
    await page.getByTestId("candidate-confirm").click();
    await expect(page.getByTestId("candidate-done")).toBeVisible();
});
