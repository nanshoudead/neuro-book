import type {Locator, Page} from "@playwright/test";
import {test, expect} from "./fixtures";

/**
 * 弹出列表的滚动（w00029 t04 决定 5）：项超过 8 个时视口截在第 9 项的中点，不超过时取自然高度，空间不够时按可用空间收矮；
 * 悬浮滑块可拖，Lab 画布这类 CSS `zoom` 下也跟手；键盘移到看不见的项时滚过去，静止的指针不抢高亮；级联菜单的父级一滚动，
 * 它展开的子菜单收起。全部要真实布局与真实指针。
 */

const ITEM = "[role^='menuitem'], [role='option']";

async function gotoLong(page: Page, scene = "long"): Promise<void> {
    await page.goto(`/acceptance/popup-lists?scene=${scene}&theme=nbook&colorway=nbook-light`);
    await expect(page.locator("#nb-lab-target")).toBeVisible();
}

/** 浮层入场有一段缩放动画；量尺寸前等它与随后的重新测量（下一帧）都结束。 */
async function settled(surface: Locator): Promise<void> {
    await expect(surface).toBeVisible();
    await surface.evaluate(async (element) => {
        await Promise.all(element.getAnimations({subtree: true}).map((animation) => animation.finished));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
}

/** 视口下沿与第 9 项中点的距离（视觉像素）；视口未滚动时量。 */
async function cutOffset(viewport: Locator): Promise<number> {
    return viewport.evaluate((element, selector) => {
        const items = element.querySelectorAll(selector);
        const ninth = items[8]!.getBoundingClientRect();
        return element.getBoundingClientRect().bottom - (ninth.top + ninth.height / 2);
    }, ITEM);
}

const scrollState = (viewport: Locator): Promise<{top: number; max: number}> =>
    viewport.evaluate((element) => ({top: element.scrollTop, max: element.scrollHeight - element.clientHeight}));

test("项超过 8 个时截在第 9 项中点（菜单含分隔线、选择器含带说明的项）；8 项时取自然高度、没有滑块", async ({page}) => {
    await gotoLong(page);

    await page.locator("[data-fixture-long-dropdown-trigger]").click();
    const dropdown = page.locator("[data-fixture-long-dropdown]");
    await settled(dropdown);
    const dropdownViewport = dropdown.locator(".nb-ui-popover-scroll");
    expect(Math.abs(await cutOffset(dropdownViewport)), "下拉菜单截在第 9 项中点").toBeLessThanOrEqual(1);
    await expect(dropdown.locator("[data-popup-scrollbar-thumb]")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.locator("[data-fixture-short-dropdown-trigger]").click();
    const short = page.locator("[data-fixture-short-dropdown]");
    await settled(short);
    const shortState = await scrollState(short.locator(".nb-ui-popover-scroll"));
    expect(shortState.max, "8 项不滚动").toBe(0);
    await expect(short.locator("[data-popup-scrollbar]")).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.locator("[data-fixture-long-select]").click();
    const listbox = page.getByRole("listbox");
    await settled(listbox);
    // 选中的是第 20 项：reka 打开时把它滚进视口，这里不去重置滚动位置。
    const selected = page.getByRole("option", {name: "第 20 章"});
    await expect(selected).toBeInViewport({ratio: 1});
    const selectViewport = page.locator("[data-reka-select-viewport]");
    expect((await scrollState(selectViewport)).top, "停在选中项附近，不在顶部").toBeGreaterThan(0);
    await selectViewport.evaluate((element) => {
        element.scrollTop = 0;
    });
    expect(Math.abs(await cutOffset(selectViewport)), "带说明的项混排时同样截在第 9 项中点").toBeLessThanOrEqual(1);
});

test("空间不够时按可用空间收矮，不越出窗口", async ({page}) => {
    await page.setViewportSize({width: 900, height: 360});
    await gotoLong(page);
    await page.locator("[data-fixture-long-dropdown-trigger]").click();
    const dropdown = page.locator("[data-fixture-long-dropdown]");
    await settled(dropdown);
    const box = (await dropdown.boundingBox())!;
    expect(box.y + box.height, "下沿在窗口里").toBeLessThanOrEqual(360);
    expect((await scrollState(dropdown.locator(".nb-ui-popover-scroll"))).max, "收矮后仍能滚动").toBeGreaterThan(0);
});

test("拖动滑块到两端：页面 CSS zoom 下也一一对应", async ({page}) => {
    await gotoLong(page);
    await page.evaluate(() => {
        document.documentElement.style.zoom = "0.8";
    });
    await page.locator("[data-fixture-long-dropdown-trigger]").click();
    const dropdown = page.locator("[data-fixture-long-dropdown]");
    await settled(dropdown);
    const viewport = dropdown.locator(".nb-ui-popover-scroll");
    const track = (await dropdown.locator("[data-popup-scrollbar]").boundingBox())!;
    const thumb = (await dropdown.locator("[data-popup-scrollbar-thumb]").boundingBox())!;
    const free = track.height - thumb.height;

    await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
    await page.mouse.down();
    await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2 + free, {steps: 8});
    const bottom = await scrollState(viewport);
    expect(Math.abs(bottom.top - bottom.max), "拖过整条轨道正好到底").toBeLessThanOrEqual(1);
    await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2, {steps: 8});
    expect((await scrollState(viewport)).top, "拖回原处正好到顶").toBeLessThanOrEqual(1);
    await page.mouse.up();
    await expect(dropdown, "拖动不关菜单").toBeVisible();
});

test("右键菜单：键盘移到看不见的项时滚过去；静止的指针不抢高亮", async ({page}) => {
    await gotoLong(page);
    await page.locator("[data-fixture-context-area]").click({button: "right"});
    const panel = page.locator("[data-menu-panel]");
    await settled(panel);
    const third = panel.getByRole("menuitem", {name: "主项 1", exact: true});
    await third.hover();
    for (let index = 0; index < 12; index += 1) await page.keyboard.press("ArrowDown");
    const target = panel.getByRole("menuitem", {name: "主项 13", exact: true});
    await expect(target).toBeFocused();
    await expect(target).toBeInViewport({ratio: 1});
    expect(await page.locator("[data-highlighted]").evaluateAll((items) => items.map((item) => item.textContent?.trim()))).toEqual(["主项 13"]);

    // 滚进来的项让开底部 22px 的渐隐，不落在半透明里。
    const viewport = panel.locator(".nb-ui-popover-scroll").first();
    const targetBox = (await target.boundingBox())!;
    const viewportBox = (await viewport.boundingBox())!;
    expect(targetBox.y + targetBox.height, "让开底部渐隐").toBeLessThanOrEqual(viewportBox.y + viewportBox.height - 22 + 1);

    await page.keyboard.press("End");
    await expect(panel.getByRole("menuitem", {name: "主项 30", exact: true})).toBeInViewport({ratio: 1});
});

test("下拉菜单的一级用键盘往下走：当前项一直在视口里", async ({page}) => {
    await gotoLong(page);
    const trigger = page.locator("[data-fixture-long-dropdown-trigger]");
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    const dropdown = page.locator("[data-fixture-long-dropdown]");
    await settled(dropdown);
    for (let index = 0; index < 14; index += 1) await page.keyboard.press("ArrowDown");
    const focused = page.locator("[data-fixture-long-dropdown] [data-highlighted]");
    await expect(focused).toHaveCount(1);
    await expect(focused).toBeInViewport({ratio: 1});
});

test("同级换成另一个长子菜单时从顶部开始，不接着上一份的滚动位置", async ({page}) => {
    await gotoLong(page);
    await page.locator("[data-fixture-long-dropdown-trigger]").click();
    const dropdown = page.locator("[data-fixture-long-dropdown]");
    await settled(dropdown);
    await dropdown.getByRole("menuitem", {name: /^长子菜单$/}).hover();
    const level = page.locator(".nb-menu-level").first();
    await settled(level);
    const levelViewport = level.locator(".nb-menu-level-viewport");
    await levelViewport.hover();
    await page.mouse.wheel(0, 200);
    await expect.poll(() => scrollState(levelViewport).then((state) => state.top)).toBeGreaterThan(0);
    await dropdown.getByRole("menuitem", {name: /长子菜单二/}).hover();
    await expect(level.getByRole("menuitem", {name: "二号子项 1", exact: true})).toBeVisible();
    expect((await scrollState(levelViewport)).top).toBe(0);
});

test("级联：父级滚轮或拖滑块时收起它展开的子菜单；同级换成短内容时子菜单变矮", async ({page}) => {
    await gotoLong(page);
    await page.locator("[data-fixture-long-dropdown-trigger]").click();
    const dropdown = page.locator("[data-fixture-long-dropdown]");
    await settled(dropdown);

    await dropdown.getByRole("menuitem", {name: /^长子菜单$/}).hover();
    const levels = page.locator(".nb-menu-level");
    await expect(levels).toHaveCount(1);
    await settled(levels.first());
    const levelViewport = levels.first().locator(".nb-menu-level-viewport");
    expect(Math.abs(await cutOffset(levelViewport)), "子菜单同样截在第 9 项中点").toBeLessThanOrEqual(1);
    const longHeight = (await levels.first().boundingBox())!.height;

    // 再展开一级，然后在第一级上滚轮：第二级收起，第一级留着。
    await levels.first().getByRole("menuitem", {name: /更深/}).hover();
    await expect(levels).toHaveCount(2);
    await levelViewport.hover();
    await page.mouse.wheel(0, 120);
    await expect(levels).toHaveCount(1);

    // 同级换成两项的子菜单：面板变矮到自然高度。
    await dropdown.getByRole("menuitem", {name: /短子菜单/}).hover();
    await expect(levels.first().getByRole("menuitem", {name: "短项 1"})).toBeVisible();
    await expect.poll(async () => (await levels.first().boundingBox())!.height).toBeLessThan(longHeight / 2);

    // 主菜单滚轮：子菜单全部收起。
    await dropdown.locator(".nb-ui-popover-scroll").hover();
    await page.mouse.wheel(0, 120);
    await expect(levels).toHaveCount(0);
});

test("下拉菜单：点击父项立即展开子菜单，第一项与父项同一行", async ({page}) => {
    await gotoLong(page);
    await page.locator("[data-fixture-long-dropdown-trigger]").click();
    const dropdown = page.locator("[data-fixture-long-dropdown]");
    await settled(dropdown);
    const parent = dropdown.getByRole("menuitem", {name: /短子菜单/});
    await parent.click();
    const level = page.locator(".nb-menu-level").first();
    await expect(level.getByRole("menuitem", {name: "短项 1"})).toBeVisible();
    await settled(level);
    const parentBox = (await parent.boundingBox())!;
    const first = (await level.getByRole("menuitem").first().boundingBox())!;
    expect(Math.abs(first.y - parentBox.y), "子菜单第一项与父项同一行").toBeLessThanOrEqual(1);
    expect(first.x, "子菜单在父级右侧").toBeGreaterThan(parentBox.x + parentBox.width);
});

test("页面 CSS zoom 下级联面板照样贴着父项、装得下全部内容", async ({page}) => {
    await gotoLong(page);
    await page.evaluate(() => {
        document.documentElement.style.zoom = "0.8";
    });
    await page.locator("[data-fixture-long-dropdown-trigger]").click();
    const dropdown = page.locator("[data-fixture-long-dropdown]");
    await settled(dropdown);
    const parent = dropdown.getByRole("menuitem", {name: /短子菜单/});
    await parent.hover();
    const level = page.locator(".nb-menu-level").first();
    await expect(level.getByRole("menuitem", {name: "短项 1"})).toBeVisible();
    await settled(level);
    const parentBox = (await parent.boundingBox())!;
    const dropdownBox = (await dropdown.boundingBox())!;
    const levelBox = (await level.boundingBox())!;
    const items = level.getByRole("menuitem");
    const first = (await items.first().boundingBox())!;
    const last = (await items.last().boundingBox())!;
    expect(Math.abs(first.y - parentBox.y), "子菜单第一项与父项同一行").toBeLessThanOrEqual(1);
    // 两级之间的间隙是 6 个 CSS 像素，zoom 0.8 下量到约 4.8。
    expect(Math.abs(levelBox.x - (dropdownBox.x + dropdownBox.width) - 4.8), "与父级的间隙随 zoom 缩放").toBeLessThanOrEqual(1);
    expect(last.y + last.height, "最后一项不被面板裁掉").toBeLessThanOrEqual(levelBox.y + levelBox.height);
    expect(first.x + first.width, "项不比面板宽").toBeLessThanOrEqual(levelBox.x + levelBox.width);
});

test("右键菜单的长子菜单：位置贴着父项，父级拖滑块时收起", async ({page}) => {
    await gotoLong(page);
    await page.locator("[data-fixture-context-area]").click({button: "right"});
    const panel = page.locator("[data-menu-panel]");
    await settled(panel);
    const parent = panel.getByRole("menuitem", {name: /长子菜单/});
    await parent.hover();
    const level = page.locator("[data-menu-level='0']");
    await settled(level);
    const parentBox = (await parent.boundingBox())!;
    const firstChild = (await level.getByRole("menuitem", {name: "子项 1", exact: true}).boundingBox())!;
    expect(Math.abs(firstChild.y - parentBox.y), "子菜单第一项与父项同一行").toBeLessThanOrEqual(1);
    expect(firstChild.x, "子菜单在父级右侧").toBeGreaterThan(parentBox.x + parentBox.width);

    const thumb = (await panel.locator("[role='menu']").first().locator(":scope > [data-popup-scrollbar] [data-popup-scrollbar-thumb]").boundingBox())!;
    await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
    await page.mouse.down();
    await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2 + 40, {steps: 4});
    await page.mouse.up();
    await expect(level).toHaveCount(0);
    await expect(panel).toBeVisible();
});

test("QuickPick：长列表截断；过滤后变短，滑块与渐隐跟着消失", async ({page}) => {
    await gotoLong(page, "quick-pick-long");
    const listbox = page.getByRole("listbox");
    await settled(page.getByRole("dialog"));
    const viewport = page.locator(".nb-ui-popover-scroll").filter({has: listbox});
    expect(Math.abs(await cutOffset(viewport))).toBeLessThanOrEqual(1);
    await expect(page.locator("[data-popup-scrollbar-thumb]")).toBeVisible();
    await expect(viewport).toHaveClass(/nb-ui-popover-scroll-fade-bottom/);

    await page.getByRole("combobox").fill("命令 3");
    await expect(listbox.getByRole("option")).toHaveCount(2);
    await expect(page.locator("[data-popup-scrollbar]")).toHaveCount(0);
    await expect(viewport).not.toHaveClass(/nb-ui-popover-scroll-fade/);
});
