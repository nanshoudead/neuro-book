/**
 * 测试用的查询接口：临时书库里导入样例书（或一份小书），经公开的 createStoryApi 调用。
 */

import {rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import type {StoryMethod, StoryParams, StoryResult} from "../src/contract/contract";
import {createStoryApi} from "../src/core/api";
import type {StoryApi} from "../src/core/api";
import type {Dataset} from "../src/core/dataset";
import type {StoryErrorCode} from "../src/core/errors";
import {makeSampleRoot, SAMPLE_TITLE} from "./sample";

export interface TestBook {
    api: StoryApi;
    root: string;
    library: string;
    /** 调用并要求成功，返回结果。 */
    ok<M extends StoryMethod>(method: M, params: StoryParams<M>): Promise<StoryResult<M>>;
    /** 调用并要求失败，返回失败码。 */
    fail(method: StoryMethod, params: unknown): Promise<StoryErrorCode>;
    close(): Promise<void>;
}

/** 新建临时书库，导入样例书（给了 dataset 就导入它），书 id 为 `fox`。 */
export async function openTestBook(name: string, dataset?: Dataset): Promise<TestBook> {
    const {root, library, file} = await makeSampleRoot(name);
    let source = file;
    if (dataset) {
        source = join(root, "custom.json");
        await writeFile(source, JSON.stringify(dataset));
    }
    const api = createStoryApi({library});
    const imported = await api.call("book.import", {file: source, title: SAMPLE_TITLE, id: "fox"});
    if (!imported.ok) throw new Error(`导入样例书失败：${imported.error.message}`);
    return {
        api,
        root,
        library,
        async ok(method, params) {
            const outcome = await api.call(method, params);
            if (!outcome.ok) throw new Error(`${method} 失败：${outcome.error.code} ${outcome.error.message}`);
            return outcome.value;
        },
        async fail(method, params) {
            const outcome = await api.call(method, params);
            if (outcome.ok) throw new Error(`${method} 期望失败，却成功了`);
            return outcome.error.code;
        },
        async close() {
            await rm(root, {recursive: true, force: true});
        },
    };
}
