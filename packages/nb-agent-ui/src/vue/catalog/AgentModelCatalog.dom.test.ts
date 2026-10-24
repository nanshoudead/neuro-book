/** AgentModelCatalog（同名 .md）：搜索、勾选、已添加、用不了的服务商与加入候选。对话框渲染到 body，在整个文档里找。 */

import {afterEach, describe, expect, it} from "vitest";
import {flushPromises, mount, type VueWrapper} from "@vue/test-utils";
import {nextTick} from "vue";

import type {CatalogModelView, CatalogProviderView} from "../../model-catalog";
import AgentModelCatalog from "./AgentModelCatalog.vue";

const model = (id: string, name = id, fields: Partial<CatalogModelView> = {}): CatalogModelView => ({id, name, api: "openai-completions", contextWindow: 200_000, reasoning: false, images: false, price: null, ...fields});
const PROVIDERS: CatalogProviderView[] = [
    {id: "deepseek", name: "DeepSeek", source: "catalog", access: "key", keyEnvs: ["DEEPSEEK_API_KEY"], keySet: true, models: [model("deepseek-flash", "DeepSeek Flash", {price: {input: 0.1, output: 0.4, currency: "USD"}, contextWindow: 1_000_000})]},
    {id: "openai", name: "OpenAI", source: "catalog", access: "key", keyEnvs: ["OPENAI_API_KEY"], keySet: false, models: [model("gpt-5.6-sol", "GPT-5.6 Sol"), model("gpt-4")]},
    {id: "anthropic", name: "Anthropic", source: "catalog", access: "login", keyEnvs: ["ANTHROPIC_API_KEY"], keySet: false, models: [model("claude-sonnet-5", "Claude Sonnet 5")]},
];

const mounted: VueWrapper[] = [];
// 先关上对话框再卸载：开着时卸载，浮层里的节点由 Teleport 收拾，happy-dom 里会留在 body 上。
afterEach(async () => {
    for (const wrapper of mounted.splice(0)) {
        await wrapper.setProps({open: false});
        await flushPromises();
        wrapper.unmount();
    }
    document.body.innerHTML = "";
});

async function open(chosen: string[] = []) {
    const wrapper = mount(AgentModelCatalog, {props: {open: true, providers: PROVIDERS, chosen, locale: "zh-CN"}, attachTo: document.body});
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
}

const all = <T extends Element>(selector: string) => [...document.querySelectorAll<T>(selector)];
const one = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;

describe("AgentModelCatalog", () => {
    it("左栏：全部、能用的（有值的在前）、分隔线后用不了的；单价未知写“未知”", async () => {
        await open();
        expect(all("[data-catalog-provider]").map((item) => item.getAttribute("data-catalog-provider"))).toEqual(["*", "deepseek", "openai", "anthropic"]);
        expect(one("[data-catalog-provider='anthropic']").classList.contains("is-locked")).toBe(true);
        expect(one("[data-catalog-model='openai/gpt-4']").textContent).toContain("未知");
        expect(one("[data-catalog-model='deepseek/deepseek-flash']").textContent).toContain("0.1 / 0.4 USD");
        expect(one("[data-catalog-model='deepseek/deepseek-flash']").textContent).toContain("1M");
    });

    it("搜索按 服务商/模型名 与显示名；勾两个后加入候选，按勾选先后发出 pick 并关闭", async () => {
        const wrapper = await open(["deepseek/deepseek-flash"]);
        const input = one<HTMLInputElement>("[data-catalog-search] input");
        input.value = "gpt";
        input.dispatchEvent(new Event("input"));
        await nextTick();
        expect(all("[data-catalog-model]").map((row) => row.getAttribute("data-catalog-model"))).toEqual(["openai/gpt-5.6-sol", "openai/gpt-4"]);
        one<HTMLElement>("[data-catalog-model='openai/gpt-4']").click();
        one<HTMLElement>("[data-catalog-model='openai/gpt-5.6-sol']").click();
        await nextTick();
        expect(one("[data-catalog-selected]").textContent).toContain("选中 2 个");
        one<HTMLButtonElement>("[data-catalog-confirm]").click();
        expect(wrapper.emitted("pick")).toEqual([[["openai/gpt-4", "openai/gpt-5.6-sol"]]]);
        expect(wrapper.emitted("update:open")).toEqual([[false]]);
    });

    it("已添加的与用不了的服务商的模型不能勾；点用不了的服务商右栏是说明页", async () => {
        const wrapper = await open(["deepseek/deepseek-flash"]);
        expect(one("[data-catalog-model='deepseek/deepseek-flash']").textContent).toContain("已添加");
        one<HTMLElement>("[data-catalog-model='deepseek/deepseek-flash']").click();
        one<HTMLElement>("[data-catalog-model='anthropic/claude-sonnet-5']").click();
        await nextTick();
        expect(one("[data-catalog-selected]").textContent).toContain("选中 0 个");
        expect(one<HTMLButtonElement>("[data-catalog-confirm]").disabled).toBe(true);
        one<HTMLElement>("[data-catalog-provider='anthropic']").click();
        await nextTick();
        expect(one("[data-catalog-locked]").textContent).toContain("也可以设 ANTHROPIC_API_KEY");
        expect(one("[data-catalog-locked]").textContent).toContain("目录里有 1 个模型");
        one<HTMLElement>("[data-catalog-add-provider]").click();
        expect(wrapper.emitted("add-provider")).toHaveLength(1);
    });
});
