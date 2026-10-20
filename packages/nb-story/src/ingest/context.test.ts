/**
 * “已有记录”与验证过质量的抽取管线逐字一致（docs/specs/story/ingest.md 输出 4）：抽取质量是用当时发给模型的这段文字
 * 验证的。对照的是 w00005 t34 抽样例书时第 2 到 10 章请求里实际发出去的那一段。
 */

import {describe, expect, test} from "bun:test";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";

import {sampleDataset} from "../../testing/sample";
import {compile} from "./compile";
import {renderContext} from "./context";

const FIXTURES = join(import.meta.dir, "..", "..", "tests", "fixtures", "ingest");

async function gunzipJson<T>(name: string): Promise<T> {
    return JSON.parse(gunzipSync(await readFile(join(FIXTURES, name))).toString("utf8")) as T;
}

describe("已有记录", () => {
    test("截至第 1 到 9 章的已有记录与 t34 当时发给模型的逐字相同", async () => {
        const sample = await sampleDataset();
        const final = await gunzipJson<{drafts: {chapter: number}[]; consolidations: {through: number}[]}>("run-med-100-final.json.gz");
        const recorded = await gunzipJson<Record<string, string>>("recorded-context-ch002-010.json.gz");
        for (let chapter = 2; chapter <= 10; chapter++) {
            const before = chapter - 1;
            const {dataset} = compile(
                sample.book,
                sample.sources.filter(source => source.chapter <= before),
                final.drafts.filter(draft => draft.chapter <= before),
                final.consolidations.filter(item => item.through <= before),
            );
            expect({chapter, context: renderContext(dataset, before)}).toEqual({chapter, context: recorded[String(chapter)]!});
        }
    }, 60_000);
});
