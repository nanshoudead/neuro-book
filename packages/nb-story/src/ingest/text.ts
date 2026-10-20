/**
 * 原文的解码与切章（docs/specs/story/ingest.md 的“原文与切章”）。规则逐条照 Spec；这里只说 Spec 里没有的实现取舍。
 *
 * 章号按标题出现的顺序编，不用标题里的数字：网文的标题常有跳号、重号、番外插在中间，按数字排会打乱原文顺序。
 */

import {StoryError} from "../core/errors";
import type {SourceChapter} from "../core/dataset";
import {sourceChapter} from "./compile";

/** 原文文件（解码前）的大小上限。 */
export const MAX_SOURCE_BYTES = 32 * 1024 * 1024;

const TITLE_MAX_CHARS = 40;
// 只排除句号与收尾的引号：网文的章标题常以“！”“？”“…”结尾（样例书的“第36章 抓猫！”），按句末标点一并排除会把
// 这些章并进上一章。
const SENTENCE_END = /[。”」』]$/u;
const NUMBER = "[0-9０-９零〇一二三四五六七八九十百千万两]+";
// 章标题前面可以带同一行的卷标题：“第一卷 小丑 第一章 绯红”。
const CHAPTER_HEADING = new RegExp(`^(?:第\\s*${NUMBER}\\s*卷[^第]{0,20}?\\s*)?第\\s*${NUMBER}\\s*([章回节])(.?)`, "u");
const SPECIAL_HEADING = /^(?:序章|序言|楔子|引子|尾声|后记|番外)(?:$|[\s：:、·—-])/u;
const VOLUME_HEADING = new RegExp(`^第\\s*${NUMBER}\\s*卷`, "u");

export interface SplitResult {
    chapters: SourceChapter[];
    /** 第一个章标题之前的字数（去掉空白，不含卷标题行）。 */
    preambleChars: number;
    /** 卷标题行的个数：不算章，也不算段落。 */
    volumeLines: number;
}

/** 字数：去掉空白后的字符数（按 Unicode 字符，不按 UTF-16 码元）。 */
export function countChars(text: string): number {
    return [...text.replace(/\s/gu, "")].length;
}

/** 按 UTF-8 严格解码；不是 UTF-8 或超过上限时报 `ingest_bad_text`。开头的 BOM 去掉。 */
export function decodeUtf8(bytes: Uint8Array): string {
    if (bytes.byteLength > MAX_SOURCE_BYTES) throw new StoryError("ingest_bad_text", `原文文件有 ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MiB，超过 32 MiB 的上限`);
    try {
        return new TextDecoder("utf-8", {fatal: true, ignoreBOM: false}).decode(bytes);
    } catch (error) {
        throw new StoryError("ingest_bad_text", "原文不是 UTF-8 编码；只收 UTF-8 的 TXT，请先转换编码", {cause: error});
    }
}

/** 一行（已去掉首尾空白）能不能当标题：不长于 40 字，也不以句末标点结尾。 */
function titleCandidate(line: string): boolean {
    return countChars(line) <= TITLE_MAX_CHARS && !SENTENCE_END.test(line);
}

function isChapterHeading(line: string): boolean {
    if (!titleCandidate(line)) return false;
    if (SPECIAL_HEADING.test(line)) return true;
    const match = CHAPTER_HEADING.exec(line);
    // “第三回合”不是章标题：“回”后面紧跟“合”时是回合的回。
    return match !== null && !(match[1] === "回" && match[2] === "合");
}

function isVolumeHeading(line: string): boolean {
    return titleCandidate(line) && VOLUME_HEADING.test(line);
}

/** 切章。一个章标题也没有时报 `ingest_bad_text`。 */
export function splitChapters(text: string): SplitResult {
    const lines = text.replace(/\r\n?/gu, "\n").split("\n").map(line => line.trim()).filter(line => line !== "");
    const chapters: {title: string; paragraphs: string[]}[] = [];
    let preambleChars = 0;
    let volumeLines = 0;
    for (const line of lines) {
        if (isChapterHeading(line)) {
            chapters.push({title: line, paragraphs: [line]});
            continue;
        }
        if (isVolumeHeading(line)) {
            volumeLines += 1;
            continue;
        }
        const current = chapters.at(-1);
        if (current) current.paragraphs.push(line);
        else preambleChars += countChars(line);
    }
    if (chapters.length === 0) throw new StoryError("ingest_bad_text", "原文里找不到章标题（例如“第一章”“第 1 章”“楔子”），切不出章；用 --preview 看切章结果");
    return {
        chapters: chapters.map((chapter, index) => sourceChapter(index + 1, chapter.title, chapter.paragraphs)),
        preambleChars,
        volumeLines,
    };
}
