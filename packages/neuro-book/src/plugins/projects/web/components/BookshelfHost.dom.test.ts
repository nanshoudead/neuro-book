/**
 * 书架宿主的新建结算（docs/specs/workbench/bookshelf.md 输出 11）：建好、封面与作品目录写完之后打开新作品；封面或作品目录
 * 没写成时留在书架上，让失败通知看得见。书架的数据层（`ShelfPage`）用替身：这里只看宿主把几步按什么顺序接起来。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {computed, ref, shallowRef} from "vue";

import type {ProjectActionOutcome, ShelfPage} from "../shelf-page";
import BookshelfHost from "./BookshelfHost.vue";
import BookshelfPage from "./BookshelfPage.vue";
import ProjectInfoDialog from "./ProjectInfoDialog.vue";
import type {ProjectInfoSubmit} from "./ProjectInfoDialog.vue";

const LIBRARY = "/home/writer/Documents/NeuroBook";

function fakePage(results: {cover: boolean; library: boolean}): {page: ShelfPage; calls: string[]} {
    const calls: string[] = [];
    const created: ProjectActionOutcome = {ok: true, id: "new-book"};
    const page = {
        status: ref("ready"),
        error: ref(""),
        items: shallowRef([]),
        now: ref("2026-10-27T12:00:00.000Z"),
        activeId: ref(null),
        view: computed(() => "cards"),
        sort: computed(() => "recent"),
        select: () => undefined,
        setView: () => undefined,
        setSort: () => undefined,
        setVisible: () => undefined,
        focused: () => undefined,
        refresh: async () => undefined,
        open: (id: string) => void calls.push(`open:${id}`),
        openInNewWindow: () => undefined,
        continueWriting: () => undefined,
        library: async () => ({path: LIBRARY, source: "default"}),
        browse: async () => ({ok: false, reason: ""}),
        create: async () => {
            calls.push("create");
            return created;
        },
        update: async () => created,
        setCover: async () => {
            calls.push("cover");
            return results.cover;
        },
        rememberLibrary: async (path: string) => {
            calls.push(`library:${path}`);
            return results.library;
        },
        addExisting: async () => ({ok: true}),
        remove: async () => ({ok: true}),
        runCommand: async () => undefined,
    } as unknown as ShelfPage;
    return {page, calls};
}

const submit = (parent: string, cover: ProjectInfoSubmit["cover"]): ProjectInfoSubmit => ({title: "长夜行", description: "", color: null, parent, cover});

async function createWith(page: ShelfPage, values: ProjectInfoSubmit): Promise<void> {
    const wrapper = mount(BookshelfHost, {props: {page, locale: "zh-CN", settingsOpen: false}, attachTo: document.body});
    wrappers.push(wrapper);
    await flushPromises();
    wrapper.findComponent(BookshelfPage).vm.$emit("create");
    await flushPromises();
    wrapper.findComponent(ProjectInfoDialog).vm.$emit("submit", values);
    await flushPromises();
}

const wrappers: Array<ReturnType<typeof mount>> = [];
afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount();
});

const COVER: ProjectInfoSubmit["cover"] = {kind: "set", file: new File(["png"], "cover.png", {type: "image/png"})};

describe("BookshelfHost 的新建", () => {
    it("建好之后打开新作品；有封面时先上传，换了位置时先记住作品目录", async () => {
        const {page, calls} = fakePage({cover: true, library: true});
        await createWith(page, submit("/books", COVER));
        expect(calls).toEqual(["create", "cover", "library:/books", "open:new-book"]);
    });

    it("没给封面、位置是作品目录：建好就打开", async () => {
        const {page, calls} = fakePage({cover: true, library: true});
        await createWith(page, submit(LIBRARY, {kind: "keep"}));
        expect(calls).toEqual(["create", "open:new-book"]);
    });

    it("封面没传上或作品目录没写进设置：留在书架上，失败通知看得见", async () => {
        for (const results of [{cover: false, library: true}, {cover: true, library: false}]) {
            const {page, calls} = fakePage(results);
            await createWith(page, submit("/books", COVER));
            expect(calls).toEqual(["create", "cover", "library:/books"]);
        }
    });
});
