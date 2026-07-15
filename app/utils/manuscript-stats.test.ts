import {describe, expect, it} from "vitest";
import {computeManuscriptStats, type ManuscriptStatsNode} from "nbook/app/utils/manuscript-stats";

function node(input: Partial<ManuscriptStatsNode> & Pick<ManuscriptStatsNode, "path">): ManuscriptStatsNode {
    return {
        entryType: null,
        words: 0,
        isDirectory: false,
        contentNode: false,
        size: 0,
        ...input,
    };
}

describe("computeManuscriptStats", () => {
    it("只统计真实文件，避免目录节点和当前 index.md 重复计数", () => {
        const current = node({
            path: "manuscript/020/011-chapter/index.md",
            entryType: "chapter",
            words: 5484,
            contentNode: true,
            size: 11296,
        });
        const tree = [
            node({
                path: "manuscript/020/011-chapter/",
                entryType: "chapter",
                words: 5484,
                isDirectory: true,
                contentNode: true,
                size: 4096,
            }),
            current,
        ];

        expect(computeManuscriptStats(current, tree)).toEqual({
            currentWords: 5484,
            totalWords: 5484,
            totalSize: 11296,
            chapters: 1,
            files: 1,
        });
    });

    it("章节数量只按 chapter content index 文件统计", () => {
        const current = node({
            path: "manuscript/020/index.md",
            entryType: "volume",
            words: 100,
            contentNode: true,
            size: 200,
        });
        const tree = [
            current,
            node({
                path: "manuscript/020/011-chapter/index.md",
                entryType: "chapter",
                words: 300,
                contentNode: true,
                size: 500,
            }),
            node({
                path: "manuscript/020/011-chapter/state.md",
                words: 999,
                size: 120,
            }),
        ];

        expect(computeManuscriptStats(current, tree)).toEqual({
            currentWords: 100,
            totalWords: 400,
            totalSize: 820,
            chapters: 1,
            files: 3,
        });
    });
});
