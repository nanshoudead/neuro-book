import type {Locator, Page} from "@playwright/test";
import {test, expect} from "./fixtures";

/**
 * Checkbox 的原生 input 聚焦时不滚动外层容器（w00022 t17）。单元测试环境没有布局引擎，聚焦滚动只能在真实浏览器里看。
 *
 * 复现条件（与 Splitter 的格子相同）：`relative overflow-hidden` 的定高格子里套一个不定位的可滚动列表，勾选框在列表靠下处。
 * 组件的 label 不是定位上下文时，`sr-only`（绝对定位）input 的包含块越过列表落到格子上，列表滚动不带着它走，
 * 它停在“列表没滚动时的位置”，也就是格子可见区下方；聚焦时浏览器为了把它滚进视野，会去滚 `overflow: hidden` 的格子，
 * 格子里的内容整个被推出视野（dev-panel 里“多选题点了选项页面变空白”）。夹具为什么必须这样搭，见夹具的头注释。
 *
 * 断言面是夹具里那个格子（`[data-fixture-cell]`），不是验收页外面的 `.acc-canvas`。
 */

async function gotoFixture(page: Page): Promise<void> {
    await page.goto("/acceptance/checkbox-focus?scene=default&theme=nbook&colorway=nbook-light");
    await expect(page.locator("#nb-lab-target")).toBeVisible();
}

/** 记下格子出现过的最大 scrollTop：聚焦滚动可能被后续布局拉回，只看最终值会漏掉。 */
async function watchCellScroll(cell: Locator): Promise<void> {
    await cell.evaluate((element) => {
        const target = element as HTMLElement & {maxScrollTop?: number};
        target.maxScrollTop = target.scrollTop;
        target.addEventListener("scroll", () => {
            target.maxScrollTop = Math.max(target.maxScrollTop ?? 0, target.scrollTop);
        });
    });
}

async function maxCellScrollTop(cell: Locator): Promise<number> {
    // 等两帧，让聚焦触发的滚动事件派发完（滚动事件在下一帧的渲染步骤里派发）。
    return cell.evaluate((element) => new Promise<number>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const target = element as HTMLElement & {maxScrollTop?: number};
            resolve(Math.max(target.maxScrollTop ?? 0, target.scrollTop));
        }));
    }));
}

async function expectInsideCell(cell: Locator, item: Locator): Promise<void> {
    const cellBox = (await cell.boundingBox())!;
    const itemBox = (await item.boundingBox())!;
    expect(cellBox).not.toBeNull();
    expect(itemBox).not.toBeNull();
    expect(itemBox.y, "勾选框上沿在格子可见区内").toBeGreaterThanOrEqual(cellBox.y);
    expect(itemBox.y + itemBox.height, "勾选框下沿在格子可见区内").toBeLessThanOrEqual(cellBox.y + cellBox.height);
}

test("滚动列表底部的勾选框，点击与 Tab 聚焦都不滚动外层 overflow: hidden 的格子", async ({page}) => {
    await gotoFixture(page);

    const cell = page.locator("[data-fixture-cell]");
    const list = page.locator("[data-fixture-list]");
    const label = list.locator("label").filter({hasText: "列表底部的勾选框"});
    const input = label.locator("input[type='checkbox']");

    // 前提一：格子是定位上下文、列表不是（理由见夹具头注释），否则组件没修时这条用例也会通过。
    await expect(cell).toHaveCSS("position", "relative");
    await expect(list).toHaveCSS("position", "static");
    await expect(cell).toHaveCSS("overflow-y", "hidden");

    // 1. 先滚动列表，让勾选框露出来。
    await list.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
    });
    await expectInsideCell(cell, label);
    expect(await cell.evaluate((element) => element.scrollTop), "滚动列表不应带动格子").toBe(0);

    // 2. 前提二：列表确实滚过一段；勾选框在列表没滚动时的位置（静态位置）落在格子可见区之外。
    const layout = await page.evaluate(() => {
        const cellElement = document.querySelector<HTMLElement>("[data-fixture-cell]")!;
        const listElement = document.querySelector<HTMLElement>("[data-fixture-list]")!;
        const labelElement = listElement.querySelector("label")!;
        const labelTopInContent = labelElement.getBoundingClientRect().top - listElement.getBoundingClientRect().top + listElement.scrollTop;
        return {listScrollTop: listElement.scrollTop, labelTopInContent, cellHeight: cellElement.clientHeight};
    });
    expect(layout.listScrollTop, "列表已滚动").toBeGreaterThan(0);
    expect(layout.labelTopInContent, "勾选框的静态位置在格子可见区之外").toBeGreaterThan(layout.cellHeight);

    await watchCellScroll(cell);

    // 3. 点勾选框：选中并聚焦原生 input。
    await label.click();
    await expect(input).toBeChecked();
    await expect(input).toBeFocused();
    // 4. 格子一直没滚，勾选框仍在视野里。
    expect(await maxCellScrollTop(cell), "点击聚焦后格子的 scrollTop").toBe(0);
    await expectInsideCell(cell, label);

    // 3'. 再用键盘离开、Tab 回到它。
    await page.keyboard.press("Shift+Tab");
    await expect(input).not.toBeFocused();
    await page.keyboard.press("Tab");
    await expect(input).toBeFocused();
    // 4'. 同上。
    expect(await maxCellScrollTop(cell), "Tab 聚焦后格子的 scrollTop").toBe(0);
    await expectInsideCell(cell, label);
});
