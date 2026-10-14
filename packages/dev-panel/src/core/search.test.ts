import {describe, expect, test} from "bun:test";
import {rankRecordMatches, recordRelevance} from "./search.js";

/** 面板搜索的记录类命中按相关度排（t15 阶段 4 第 5 批）。 */
describe("记录类命中的相关度", () => {
    test("标题或编号相同（含短号）> 标题开头 > 编号开头 > 标题包含 > 编号包含；不分大小写", () => {
        const q = "Panel";
        expect([
            recordRelevance({kind: "work", workId: "w00022-dev-panel", title: "Panel"}, q),
            recordRelevance({kind: "task", workId: "w00022-dev-panel", taskId: "t15-ui-polish", title: "panel 外壳"}, q),
            recordRelevance({kind: "artifact", workId: "w00022-dev-panel", taskId: null, artifactId: "panel-review", title: "评审板"}, q),
            recordRelevance({kind: "task", workId: "w00022-dev-panel", taskId: "t03-ui", title: "开发者 panel 的页面"}, q),
            recordRelevance({kind: "session", key: "claude:panel-x", label: null}, q),
        ]).toEqual([0, 1, 2, 3, 4]);
        expect(recordRelevance({kind: "work", workId: "w00022-dev-panel", title: "开发者面板"}, "w00022")).toBe(0);
        expect(recordRelevance({kind: "task", workId: "w00022-dev-panel", taskId: "t15-ui-polish", title: "界面打磨"}, "T15")).toBe(0);
    });

    test("按相关度稳定排序；同分时 Work、Task、产物、会话依次在前，再保持原来的顺序", () => {
        const matches = [
            {kind: "task", workId: "w1", taskId: "t01-a", title: "旧的 panel 记录"},
            {kind: "session", key: "claude:abc", label: "panel 会话"},
            {kind: "task", workId: "w1", taskId: "t02-b", title: "panel 外壳"},
            {kind: "work", workId: "w00022-dev-panel", title: "开发者面板"},
            {kind: "work", workId: "w2", title: "Panel 重做"},
            {kind: "task", workId: "w2", taskId: "t03-c", title: "另一个 panel"},
        ];
        expect(rankRecordMatches(matches, "panel").map((match) => match.title ?? match.label)).toEqual(["Panel 重做", "panel 外壳", "panel 会话", "旧的 panel 记录", "另一个 panel", "开发者面板"]);
    });
});
