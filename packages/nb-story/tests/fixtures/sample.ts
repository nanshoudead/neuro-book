/**
 * 测试用的样例书与临时书库。样例书的来源见同目录 README.md。
 */

import {readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {Dataset} from "../../src/core/dataset";

export const SAMPLE_GZ = join(import.meta.dir, "sample-100ch.json.gz");
export const SAMPLE_TITLE = "转生反派萝莉，找茬魔法少女";

let sampleText: string | undefined;

/** 解压后的样例书 JSON 文本（进程内只解压一次）。 */
export async function sampleJson(): Promise<string> {
    sampleText ??= gunzipSync(await readFile(SAMPLE_GZ)).toString("utf8");
    return sampleText;
}

export async function sampleDataset(): Promise<Dataset> {
    return JSON.parse(await sampleJson()) as Dataset;
}

/** 新建一个临时根，里面放好解压后的样例书文件；返回根目录、书库目录与样例书文件路径。 */
export async function makeSampleRoot(name: string): Promise<{root: string; library: string; file: string}> {
    const root = await createTestTmpRoot(`nb-story-${name}`, `nb-story ${name}`);
    const file = join(root, "sample-100ch.json");
    await writeFile(file, await sampleJson());
    return {root, library: join(root, "library"), file};
}
