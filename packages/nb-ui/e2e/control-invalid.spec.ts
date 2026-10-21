import type {Locator, Page} from "@playwright/test";
import {test, expect} from "./fixtures";

/**
 * 出错的输入框悬停、聚焦时边框仍是出错色（w00030 t02）。
 *
 * 出错边框由 styles.css 的 `.nb-ui-control.nb-ui-control-invalid` 给，与它同层的 `.nb-ui-control:focus` 等规则
 * 靠双类选择器压过；控件模板上的原子类在 utilities 层，不设 border-color。这条用例读计算样式，
 * 样式层的裁决只有真实浏览器能给出答案。
 */

/** `var(--status-danger)` 在页面上算出的颜色：用一个探针元素读，不在用例里写死色值，随主题与配色变。 */
async function dangerColor(page: Page): Promise<string> {
    return page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--status-danger)";
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
    });
}

const borderColor = (input: Locator): Promise<string> => input.evaluate((element) => getComputedStyle(element).borderTopColor);

test("出错的输入框在常态、悬停与聚焦时边框都是出错色，正常的输入框不是", async ({page}) => {
    await page.goto("/acceptance/control-invalid?scene=default&theme=nbook&colorway=nbook-light");
    const invalid = page.locator("[data-fixture-invalid]");
    const normal = page.locator("[data-fixture-normal]");
    await expect(invalid).toBeVisible();
    const danger = await dangerColor(page);

    // 前提：对照用的正常输入框不是出错色，否则下面的断言证明不了什么。
    expect(await borderColor(normal), "正常输入框的边框不是出错色").not.toBe(danger);

    await expect.poll(() => borderColor(invalid), {message: "常态边框是出错色"}).toBe(danger);

    await invalid.hover();
    await expect.poll(() => borderColor(invalid), {message: "悬停时边框仍是出错色"}).toBe(danger);

    await invalid.focus();
    await expect.poll(() => borderColor(invalid), {message: "聚焦时边框仍是出错色"}).toBe(danger);
});
