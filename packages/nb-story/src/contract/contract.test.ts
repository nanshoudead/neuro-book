/**
 * 查询接口的 schema 随包公开（docs/specs/story/queries.md 方法清单第 4 条）：包外经包名就能拿到方法清单与合同。
 */

import {expect, test} from "bun:test";

import {STORY_METHODS, storyContract} from "@notnotype/nb-story/contract";

test("经包名的 ./contract 拿到全部方法的 schema 与插件通道用的合同", () => {
    expect(Object.keys(STORY_METHODS)).toContain("graph.relations");
    expect(storyContract.id).toBe("nb-story/queries");
    expect(Object.keys(storyContract.methods)).toEqual(Object.keys(STORY_METHODS));
});
