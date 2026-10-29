/**
 * 图片查看器的说明文字（同名 .md）：没有绑定项目与各种读取失败，中英文各一遍。失败的 HTTP 状态来自本机起的真实
 * 服务；图片的解码（“无法显示这个图片”）与布局（缩放、滚动、棋盘格）需要真实浏览器，happy-dom 里解码不会完成，由
 * `e2e/editor-types.e2e.ts` 与 Lab 场景验收。
 */

import {createServer} from "node:http";
import type {Server, ServerResponse} from "node:http";
import type {AddressInfo} from "node:net";

import {flushPromises, mount} from "@vue/test-utils";
import type {VueWrapper} from "@vue/test-utils";
import {computed, ref} from "vue";
import {afterAll, afterEach, beforeAll, describe, expect, it} from "vitest";

import type {BytesEditorBinding} from "nbook/plugins/editor/shared/contracts";
import type {DisplayLocale} from "nbook/shared/localized-text";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {imageViewerCatalogs} from "../text";
import ImageViewer from "./ImageViewer.vue";

const mounted: VueWrapper[] = [];

/** 路径 `/<状态码>` 回应这个状态码；`/hang` 不回应，用来停在“正在读取”。 */
let server: Server;
/** 没有回应的请求；用例读完“正在读取”之后回 404 放行，不让卸载时的取消把连接硬断开。 */
const hanging: ServerResponse[] = [];
let origin = "";

beforeAll(async () => {
    server = createServer((request, response) => {
        // 控件带 `Cache-Control` 头取图，跨源时浏览器环境先发预检。
        const cors = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET"};
        if (request.method === "OPTIONS") {
            response.writeHead(204, cors);
            response.end();
            return;
        }
        if (request.url === "/hang") {
            hanging.push(response);
            return;
        }
        response.writeHead(Number((request.url ?? "/200").slice(1)), cors);
        response.end("x");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

function binding(url: string | null): BytesEditorBinding {
    return {kind: "bytes", token: "t", tabId: "tab", editor: "nbook.image-viewer.image", address: computed(() => "project://插图.png"), url: ref(url), version: ref(0), slot: {state: null, dispose: null}};
}

async function show(url: string | null, locale: DisplayLocale): Promise<VueWrapper> {
    const wrapper = mount(ImageViewer, {
        props: {binding: binding(url), host: {state: null, dispose: null}, readonly: true, visible: true, label: "插图.png", locale},
        global: {provide: provideText(testTextPort(locale, {"nbook.image-viewer": imageViewerCatalogs}))},
    });
    mounted.push(wrapper);
    // 等失败说明出现：请求走真实的本机服务。
    await expect.poll(async () => {
        await flushPromises();
        return wrapper.find("[data-image-viewer-failure]").exists();
    }).toBe(true);
    return wrapper;
}

/** 请求一直没有回应：停在读取中；返回的 `release` 回 404，等失败说明出现。 */
async function showLoading(locale: DisplayLocale): Promise<{readonly wrapper: VueWrapper; release(): Promise<void>}> {
    const wrapper = mount(ImageViewer, {
        props: {binding: binding(`${origin}/hang`), host: {state: null, dispose: null}, readonly: true, visible: true, label: "插图.png", locale},
        global: {provide: provideText(testTextPort(locale, {"nbook.image-viewer": imageViewerCatalogs}))},
    });
    mounted.push(wrapper);
    await flushPromises();
    const release = async (): Promise<void> => {
        await expect.poll(() => hanging.length).toBeGreaterThan(0);
        for (const response of hanging.splice(0)) {
            response.writeHead(404, {"Access-Control-Allow-Origin": "*"});
            response.end();
        }
        await expect.poll(async () => {
            await flushPromises();
            return wrapper.find("[data-image-viewer-failure]").exists();
        }).toBe(true);
    };
    return {wrapper, release};
}

describe("ImageViewer 的说明文字", () => {
    it("没有绑定项目：只有说明，没有“重试”", async () => {
        const wrapper = await show(null, "zh-CN");
        const failure = wrapper.get("[data-image-viewer-failure]");
        expect(failure.get("p").text()).toBe("只能显示作品里的文件。");
        expect(failure.find("button").exists()).toBe(false);
    });

    it.each([
        [404, "插图.png 不在了。"],
        [410, "作品已经关闭，读不到 插图.png。"],
        [413, "插图.png 太大，不能在这里显示。"],
        [500, "读不到 插图.png（500）。"],
    ] as const)("服务端回 %i：说明带上文件名，并带“重试”", async (status, message) => {
        const wrapper = await show(`${origin}/${String(status)}`, "zh-CN");
        const failure = wrapper.get("[data-image-viewer-failure]");
        expect(failure.get("p").text()).toBe(message);
        expect(failure.get("button").text()).toBe("重试");
    });

    it("英文界面：说明与按钮都是英文", async () => {
        const wrapper = await show(`${origin}/404`, "en-US");
        const failure = wrapper.get("[data-image-viewer-failure]");
        expect(failure.get("p").text()).toBe("插图.png no longer exists.");
        expect(failure.get("button").text()).toBe("Retry");
    });

    it.each([["zh-CN", "正在读取…"], ["en-US", "Reading…"]] as const)("读取中（%s）：提示读取，回应来了之后换成失败说明", async (locale, message) => {
        const {wrapper, release} = await showLoading(locale);
        expect(wrapper.get("[role=status]").text()).toBe(message);
        await release();
    });
});
