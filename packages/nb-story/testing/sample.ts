/**
 * 测试用的样例书与临时书库。样例书的来源见 tests/fixtures/README.md。
 */

import {readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {Dataset} from "../src/core/dataset";

export const SAMPLE_GZ = join(import.meta.dir, "..", "tests", "fixtures", "sample-100ch.json.gz");
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

/**
 * 只留样例书前 `chapters` 章的小书（各类记录按 at 截到这几章）。用于与数据量无关、要跑很多轮的合同测试；
 * 截取后仍是合法的 V9 数据集。
 */
export async function smallDataset(chapters: number, title: string): Promise<Dataset> {
    const full = await sampleDataset();
    const keep = <T extends {at: {chapter: number}}>(records: T[]): T[] => records.filter(record => record.at.chapter <= chapters);
    const sources = full.sources.filter(chapter => chapter.chapter <= chapters);
    return {
        ...full,
        book: {...full.book, title},
        through: {chapter: chapters, paragraph: sources.at(-1)!.paragraphs.length},
        sources,
        entities: keep(full.entities),
        mentions: keep(full.mentions),
        times: keep(full.times),
        beats: keep(full.beats),
        statements: keep(full.statements),
        secrets: keep(full.secrets),
        episodes: keep(full.episodes),
        knowledge: keep(full.knowledge),
        ledger: keep(full.ledger),
        questions: keep(full.questions),
        summaries: keep(full.summaries),
        arcs: keep(full.arcs),
    };
}

/**
 * 样例书前 `chapters` 章拼回的 TXT 原文，前面加书名与一段简介（切章时不算正文）。抽取测试用它：要抽完的书用 5 或
 * 10 章，因为末章要整理，录下的整理回复只有第 5、10 章的（testing/ingest-replay.ts）。
 */
export async function sampleSourceText(chapters: number): Promise<string> {
    const sample = await sampleDataset();
    return `${SAMPLE_TITLE}\n作者：测试\n\n${sample.sources.slice(0, chapters).map(source => source.paragraphs.join("\n")).join("\n\n")}`;
}
