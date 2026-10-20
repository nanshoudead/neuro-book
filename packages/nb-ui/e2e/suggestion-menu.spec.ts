import type {Locator, Page} from "@playwright/test";
import {test, expect} from "./fixtures";

/**
 * SuggestionMenu（w00029 t04 计划第 6 节）：不抢焦点、贴光标逐帧跟随、按 96px 门槛上下翻转、夹进窗口、超宽锚点收窄、
 * 键盘滚动时静止的指针不抢高亮，以及宿主的 aria-activedescendant 指向的就是高亮项。全部要真实布局与真实指针。
 */

async function gotoScene(page: Page, scene: string): Promise<{input: Locator; menu: Locator}> {
    await page.goto(`/acceptance/suggestion-menu?scene=${scene}&theme=nbook&colorway=nbook-light`);
    const input = page.locator("[data-fixture-input]");
    await expect(input).toBeVisible();
    await input.focus();
    const menu = page.locator("[data-suggestion-menu]");
    await expect(menu).toBeVisible();
    return {input, menu};
}

/** 把用例的“光标”挪到 (x, y)，再等两帧：菜单逐帧读锚点矩形。 */
async function moveCaret(page: Page, x: number, y: number): Promise<void> {
    await page.locator("[data-fixture-caret]").evaluate(async (element, [left, top]) => {
        (element as HTMLElement).style.left = `${String(left)}px`;
        (element as HTMLElement).style.top = `${String(top)}px`;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, [x, y] as const);
}

const caretBox = async (page: Page): Promise<{x: number; y: number; width: number; height: number}> => (await page.locator("[data-fixture-caret]").boundingBox())!;

test("点项后焦点仍在输入处；键盘移动的高亮就是 aria-activedescendant 指向的那一项，跳过禁用项", async ({page}) => {
    const {input, menu} = await gotoScene(page, "caret");
    await menu.getByRole("option", {name: /第 3 章/}).click();
    await expect(input, "点项不夺焦点").toBeFocused();
    await expect(page.locator("[data-fixture-chosen]")).toHaveText("chapter-3");

    await input.fill("钟");
    await expect(menu.getByRole("option")).toHaveCount(1);
    await input.fill("");
    // 当前项是点过的第 3 章（下标 2）；往下 10 项到设定组的钟表铺，它后面是禁用项，再往下应当直接到林雪。
    for (let index = 0; index < 10; index += 1) await page.keyboard.press("ArrowDown");
    const expectActive = async (name: string): Promise<void> => {
        const highlighted = menu.locator("[data-highlighted]");
        await expect(highlighted).toHaveCount(1);
        await expect(highlighted).toContainText(name);
        const id = await input.getAttribute("aria-activedescendant");
        expect(await highlighted.getAttribute("id")).toBe(id);
    };
    await expectActive("钟表铺");
    const labelLeft = async (name: RegExp): Promise<number> => (await menu.getByRole("option", {name}).locator(".nb-ui-menu-item__label").boundingBox())!.x;
    expect(await labelLeft(/旧设定/), "没图标的项留出图标列").toBeCloseTo(await labelLeft(/钟表铺/), 0);
    await page.keyboard.press("ArrowDown");
    await expectActive("林雪");
    await expect(menu.getByRole("option", {name: /林雪/}), "移到看不见的项时滚过去").toBeInViewport({ratio: 1});
    await expect(input).toBeFocused();
});

test("键盘滚动时静止的指针不抢高亮；指针真的移动才改", async ({page}) => {
    const {menu} = await gotoScene(page, "caret");
    await menu.getByRole("option", {name: /第 2 章/}).hover();
    await expect(menu.locator("[data-highlighted]")).toContainText("第 2 章");
    for (let index = 0; index < 10; index += 1) await page.keyboard.press("ArrowDown");
    await expect(menu.locator("[data-highlighted]")).toContainText("第 12 章");
    await expect(menu.locator("[data-highlighted]")).toHaveCount(1);
    const box = (await menu.getByRole("option", {name: /第 12 章/}).boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + box.height / 2 + 1);
    await page.mouse.move(box.x + 24, box.y + box.height / 2 + 2);
    await expect(menu.locator("[data-highlighted]")).toContainText("第 12 章");
});

test("贴光标：光标移动后逐帧跟上；下方不足 96px 时翻到上方；左右不出窗口", async ({page}) => {
    const {menu} = await gotoScene(page, "caret");
    await moveCaret(page, 200, 200);
    let caret = await caretBox(page);
    let box = (await menu.boundingBox())!;
    expect(box.y, "放在光标下方").toBeGreaterThan(caret.y + caret.height);
    expect(Math.abs(box.x - caret.x), "左边与光标对齐").toBeLessThanOrEqual(1);

    await moveCaret(page, 260, 240);
    caret = await caretBox(page);
    box = (await menu.boundingBox())!;
    expect(Math.abs(box.x - caret.x), "光标移动后跟上").toBeLessThanOrEqual(1);

    const height = page.viewportSize()!.height;
    await moveCaret(page, 260, height - 60);
    caret = await caretBox(page);
    box = (await menu.boundingBox())!;
    expect(box.y + box.height, "翻到光标上方").toBeLessThanOrEqual(caret.y);

    const width = page.viewportSize()!.width;
    await moveCaret(page, width - 10, 200);
    box = (await menu.boundingBox())!;
    expect(box.x + box.width, "右边夹进窗口").toBeLessThanOrEqual(width - 12 + 1);
});

test("可用高度不足 96px 且翻不了时按可用空间收矮，不越出窗口", async ({page}) => {
    await page.setViewportSize({width: 900, height: 200});
    const {menu} = await gotoScene(page, "caret");
    await moveCaret(page, 200, 120);
    const box = (await menu.boundingBox())!;
    expect(box.y, "上沿在窗口里").toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, "下沿在窗口里").toBeLessThanOrEqual(200);
});

test("与输入框同宽；顶部搜索框能聚焦、能用鼠标移动光标", async ({page}) => {
    const {menu} = await gotoScene(page, "header");
    const anchor = (await page.locator(".suggestion-box").boundingBox())!;
    const box = (await menu.boundingBox())!;
    expect(Math.abs(box.width - anchor.width), "宽度与锚点相同").toBeLessThanOrEqual(1);
    const search = page.locator("[data-fixture-search]");
    await search.click();
    await expect(search).toBeFocused();
    await page.keyboard.type("第三章");
    const searchBox = (await search.boundingBox())!;
    await page.mouse.click(searchBox.x + 4, searchBox.y + searchBox.height / 2);
    expect(await search.evaluate((element) => (element as HTMLInputElement).selectionStart), "点击把光标移到开头").toBe(0);
});

test("锚点比窗口还宽时收窄到可用宽度；窗口变窄后跟着收窄", async ({page}) => {
    const {menu} = await gotoScene(page, "wide");
    for (const width of [page.viewportSize()!.width, 700]) {
        await page.setViewportSize({width, height: page.viewportSize()!.height});
        await expect.poll(async () => {
            const box = (await menu.boundingBox())!;
            return box.x >= 12 - 1 && box.x + box.width <= width - 12 + 1;
        }).toBe(true);
    }
});

test("关闭后重新打开时贴着光标的新位置", async ({page}) => {
    const {menu} = await gotoScene(page, "caret");
    await page.locator("[data-fixture-toggle]").click();
    await expect(menu).toHaveCount(0);
    await moveCaret(page, 320, 260);
    await page.locator("[data-fixture-toggle]").click();
    await expect(menu).toBeVisible();
    const caret = await caretBox(page);
    expect(Math.abs((await menu.boundingBox())!.x - caret.x)).toBeLessThanOrEqual(1);
});

test("按在浮层的内边距或分组标题上也不夺走输入处的焦点", async ({page}) => {
    const {input, menu} = await gotoScene(page, "caret");
    const box = (await menu.boundingBox())!;
    await page.mouse.click(box.x + 2, box.y + 2);
    await expect(input).toBeFocused();
    await menu.getByText("设定", {exact: true}).click();
    await expect(input).toBeFocused();
    await expect(menu).toBeVisible();
});

test("候选从少变多：滑块与底部渐隐出现", async ({page}) => {
    const {input, menu} = await gotoScene(page, "caret");
    await input.fill("第 1");
    await expect(menu.getByRole("option")).toHaveCount(4);
    await expect(menu.locator("[data-popup-scrollbar]")).toHaveCount(0);
    await input.fill("");
    await expect(menu.getByRole("option")).toHaveCount(15);
    await expect(menu.locator("[data-popup-scrollbar-thumb]")).toBeVisible();
    await expect(menu.locator(".nb-ui-popover-scroll")).toHaveClass(/nb-ui-popover-scroll-fade-bottom/);
});
