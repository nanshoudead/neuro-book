import {describe, expect, it} from "vitest";
import {PlotFacade} from "nbook/server/plot/facade/plot.facade";
import {WorldEngineFacade} from "nbook/server/world-engine";
import {ProjectNotOpenError} from "nbook/server/workspace-files/project-session";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";

describe("PlotFacade ProjectSession 守卫", () => {
    it("未 open 的 Project 拒绝创建 Plot Prisma client", async () => {
        const workspaceRoot = resolveRuntimeWorkspaceRoot();
        const facade = new PlotFacade(workspaceRoot, new WorldEngineFacade(workspaceRoot));

        await expect(facade.getStoryDto("workspace/not-open")).rejects.toBeInstanceOf(ProjectNotOpenError);
    });
});
