/**
 * 图片的地址（docs/specs/workspace/markdown-dialect.md 输出 18）：真实的文件服务场地（服务端、项目实例与窗口三个实例），地址经
 * 字节路由取 URL，磁盘上的文件变了通知订阅者并换新 URL。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {BATCH_DELAY_MS} from "nbook/plugins/files/backend/changes";
import {files, filesScene} from "nbook/plugins/files/testing/scene";

import {createAssetUrls} from "./web/parts/asset-urls";

let tmp = "";
let counter = 0;
const closers: Array<() => Promise<void>> = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-markdown", "asset-urls");
});
afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("Spec workspace.markdown-dialect 输出 18：图片的地址", () => {
    it("作品里的图片经字节路由，外部图片原样，根以外的不显示；文件在磁盘上变了，订阅者收到通知、URL 换成新的", async () => {
        counter += 1;
        const created = await filesScene(join(tmp, `case-${String(counter)}`), {project: {"正文/第一章.md": "![图](images/a.png)", "正文/images/a.png": "一"}});
        closers.push(async () => {
            await created.world.close();
        });
        const client = files(created.window);
        const assets = createAssetUrls(client);
        closers.push(async () => assets.dispose());
        const base = "project://正文/第一章.md";
        const first = assets.resolve(base, "images/a.png");
        expect(first).toEqual({url: client.rawUrl("project://正文/images/a.png") as string, address: "project://正文/images/a.png"});
        expect(assets.resolve(base, "https://example.com/a.png")).toEqual({url: "https://example.com/a.png", address: null});
        expect(assets.resolve(base, "../../外面.png")).toBeNull();
        expect(assets.resolve(base, "chapter://c1")).toBeNull();

        let notified = 0;
        const stop = assets.onChange("project://正文/images/a.png", () => {
            notified += 1;
        });
        // 同一窗口同一方案共用一条订阅：它推了 `ready` 之后，这里的订阅也在了，之后的修改都看得到。
        let ready = false;
        const probe = client.watch("project", (message) => {
            if (message.kind === "ready") ready = true;
        });
        closers.push(async () => probe());
        await waitUntil("订阅建立", () => (ready ? true : null));
        await writeFile(join(created.project, "正文/images/a.png"), "二");
        await waitUntil("外部修改通知到订阅者", () => {
            created.world.clock.advance(BATCH_DELAY_MS);
            return notified > 0 ? true : null;
        });
        const second = assets.resolve(base, "images/a.png");
        expect(second?.url).not.toBe(first?.url);
        expect(second?.url.startsWith(first?.url ?? "")).toBe(true);
        stop();
    });
});
