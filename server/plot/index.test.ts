import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    disposePlotFacade,
    disposePlotFacades,
    plotFacadeForWorkspaceRoot,
} from "nbook/server/plot";
import {worldEngineFacadeForWorkspaceRoot} from "nbook/server/world-engine";

describe("Plot 与 World Engine root runtime registry", () => {
    afterEach(async () => {
        await disposePlotFacades();
    });

    it("规范化同一 Workspace Root 并复用 facade，不跨 root 共享", () => {
        const firstRoot = absoluteFsPath(path.resolve(".agent", "plot-runtime", "first"));
        const equivalentRoot = absoluteFsPath(path.join(firstRoot, "..", path.basename(firstRoot)));
        const secondRoot = absoluteFsPath(path.resolve(".agent", "plot-runtime", "second"));

        expect(plotFacadeForWorkspaceRoot(firstRoot)).toBe(plotFacadeForWorkspaceRoot(equivalentRoot));
        expect(worldEngineFacadeForWorkspaceRoot(firstRoot)).toBe(worldEngineFacadeForWorkspaceRoot(equivalentRoot));
        expect(plotFacadeForWorkspaceRoot(firstRoot)).not.toBe(plotFacadeForWorkspaceRoot(secondRoot));
        expect(worldEngineFacadeForWorkspaceRoot(firstRoot)).not.toBe(worldEngineFacadeForWorkspaceRoot(secondRoot));
    });

    it("释放单个 root 后创建全新且仍配对的 Plot/World Engine runtime", async () => {
        const workspaceRoot = absoluteFsPath(path.resolve(".agent", "plot-runtime", "dispose-one"));
        const originalPlot = plotFacadeForWorkspaceRoot(workspaceRoot);
        const originalWorld = worldEngineFacadeForWorkspaceRoot(workspaceRoot);

        await disposePlotFacade(workspaceRoot);

        expect(plotFacadeForWorkspaceRoot(workspaceRoot)).not.toBe(originalPlot);
        expect(worldEngineFacadeForWorkspaceRoot(workspaceRoot)).not.toBe(originalWorld);
    });

    it("释放全部 runtime 后不复用任何旧 facade", async () => {
        const workspaceRoot = absoluteFsPath(path.resolve(".agent", "plot-runtime", "dispose-all"));
        const originalPlot = plotFacadeForWorkspaceRoot(workspaceRoot);
        const originalWorld = worldEngineFacadeForWorkspaceRoot(workspaceRoot);

        await disposePlotFacades();

        expect(plotFacadeForWorkspaceRoot(workspaceRoot)).not.toBe(originalPlot);
        expect(worldEngineFacadeForWorkspaceRoot(workspaceRoot)).not.toBe(originalWorld);
    });
});
