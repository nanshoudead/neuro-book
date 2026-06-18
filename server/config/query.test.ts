import {describe, expect, it} from "vitest";
import {validateConfigEditorSnapshotQuery} from "nbook/server/config/query";

describe("config query", () => {
    it("正确解析 editor snapshot 的 includeAgentProfileSettings 开关", () => {
        expect(validateConfigEditorSnapshotQuery({workspaceKind: "user-assets"}).includeAgentProfileSettings).toBe(false);
        expect(validateConfigEditorSnapshotQuery({
            workspaceKind: "user-assets",
            includeAgentProfileSettings: "false",
        }).includeAgentProfileSettings).toBe(false);
        expect(validateConfigEditorSnapshotQuery({
            workspaceKind: "user-assets",
            includeAgentProfileSettings: false,
        }).includeAgentProfileSettings).toBe(false);
        expect(validateConfigEditorSnapshotQuery({
            workspaceKind: "user-assets",
            includeAgentProfileSettings: "true",
        }).includeAgentProfileSettings).toBe(true);
        expect(validateConfigEditorSnapshotQuery({
            workspaceKind: "user-assets",
            includeAgentProfileSettings: true,
        }).includeAgentProfileSettings).toBe(true);
    });

    it("拒绝非法 editor snapshot includeAgentProfileSettings 值", () => {
        let thrown: unknown;
        try {
            validateConfigEditorSnapshotQuery({
                workspaceKind: "user-assets",
                includeAgentProfileSettings: "yes",
            });
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toMatchObject({statusCode: 400});
    });
});
