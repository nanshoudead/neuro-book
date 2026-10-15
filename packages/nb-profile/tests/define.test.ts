import {describe, expect, test} from "bun:test";
import {Type} from "typebox";
import {defineProfile, optional, ProfilePrompt, ProfileError, toolRef, toolset, type ProfileManifest} from "../src";

const manifest: ProfileManifest = {key: "story-qa", version: "1", name: "剧情问答", description: "按阅读位置回答问题"};
const initialSchema = Type.Object({book: Type.String(), at: Type.Object({chapter: Type.Integer({minimum: 1})})});

function codeOf(run: () => unknown): string | null {
    try {
        run();
        return null;
    } catch (error) {
        return error instanceof ProfileError ? error.code : "other";
    }
}

describe("defineProfile", () => {
    test("初始输入按 initialSchema 校验：合则原样返回，不合报 invalid_initial 并列出路径", () => {
        const profile = defineProfile({manifest, initialSchema, tools: [], context: () => ProfilePrompt({})});

        expect(profile.parseInitial({book: "b1", at: {chapter: 38}})).toEqual({book: "b1", at: {chapter: 38}});
        expect(codeOf(() => profile.parseInitial({book: "b1", at: {chapter: 0}}))).toBe("invalid_initial");
        try {
            profile.parseInitial({book: 1});
        } catch (error) {
            expect((error as ProfileError).details.join("\n")).toMatch(/book/u);
        }
    });

    test("同一 Profile 里同一工具 id 不能出现两次（含 optional 包着的）", () => {
        expect(codeOf(() => toolset(toolRef("story.search"), optional(toolRef("story.search"))))).toBe("profile_invalid");
        expect(codeOf(() => defineProfile({manifest, initialSchema, tools: [toolRef("a"), toolRef("a")], context: () => ProfilePrompt({})}))).toBe("profile_invalid");
    });

    test("manifest 缺字段报 profile_invalid", () => {
        expect(codeOf(() => defineProfile({manifest: {...manifest, version: ""}, initialSchema, tools: [], context: () => ProfilePrompt({})}))).toBe("profile_invalid");
    });
});
