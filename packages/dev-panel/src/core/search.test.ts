import {describe, expect, test} from "bun:test";
import {rankRecordMatches, recordRelevance, topRecordMatches} from "./search.js";

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

    test("产物编号长得像短号（t15-review、w00022-report）也只按完整编号比，排不过标题以搜索词开头的 Work（第 5 批服务端审查第 1 条）", () => {
        const matches = [
            {kind: "artifact", workId: "w1", taskId: null, artifactId: "t15-review", title: null},
            {kind: "artifact", workId: "w1", taskId: null, artifactId: "w00022-report", title: null},
            {kind: "work", workId: "w00099-plan", title: "t15 计划"},
            {kind: "task", workId: "w00022-dev-panel", taskId: "t15-ui-polish", title: "界面打磨"},
        ];
        expect([recordRelevance(matches[0]!, "t15"), recordRelevance(matches[1]!, "w00022"), recordRelevance(matches[2]!, "t15"), recordRelevance(matches[3]!, "t15")]).toEqual([2, 2, 1, 0]);
        expect(rankRecordMatches(matches, "T15").map((match) => match.artifactId ?? match.taskId ?? match.workId)).toEqual(["t15-ui-polish", "w00099-plan", "t15-review", "w00022-report"]);
    });

    test("命中超过 50 条：先排再截，相关度高的那条留在 50 条里", () => {
        const artifacts = Array.from({length: 51}, (_, index) => ({kind: "artifact", workId: "w1", taskId: null, artifactId: `t15-review-${index}`, title: null}));
        const work = {kind: "work", workId: "w00099-plan", title: "t15 计划"};
        const top = topRecordMatches([...artifacts, work], "t15");
        expect([top.length, top[0]]).toEqual([50, work]);
    });
});
