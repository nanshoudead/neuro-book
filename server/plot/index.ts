import {PlotFacade} from "nbook/server/plot/facade/plot.facade";
import {
    disposeWorldEngineFacade,
    disposeWorldEngineFacades,
    worldEngineFacadeForWorkspaceRoot,
} from "nbook/server/world-engine";
import {registerProjectResourceOwner} from "nbook/server/workspace-files/project-session";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    requirePhaseId,
    requirePlotId,
    requireSceneId,
    requireStoryThreadId,
} from "nbook/server/plot/http/plot-route";

const facades = new Map<AbsoluteFsPath, PlotFacade>();

/**
 * 返回绑定到明确 Workspace Root 的 Plot 门面。
 *
 * Plot 的 Prisma client 生命周期跟随物理 Workspace Root 分区；同一进程管理多个
 * NeuroBook 实例时不会把 Project SQLite 或 World Engine 连接到另一个 State Root。
 */
export function plotFacadeForWorkspaceRoot(workspaceRoot: AbsoluteFsPath): PlotFacade {
    const normalizedRoot = absoluteFsPath(workspaceRoot);
    const existing = facades.get(normalizedRoot);
    if (existing) {
        return existing;
    }
    const facade = new PlotFacade(normalizedRoot, worldEngineFacadeForWorkspaceRoot(normalizedRoot));
    facades.set(normalizedRoot, facade);
    return facade;
}

/**
 * 释放一个 Workspace Root 下的 Plot 与共享 World Engine runtime。
 *
 * 先从 registry 移除再关闭连接，避免关闭期间的新调用拿到正在销毁的实例。
 */
export async function disposePlotFacade(workspaceRoot: AbsoluteFsPath): Promise<void> {
    const normalizedRoot = absoluteFsPath(workspaceRoot);
    const facade = facades.get(normalizedRoot);
    if (!facade) {
        disposeWorldEngineFacade(normalizedRoot);
        return;
    }
    facades.delete(normalizedRoot);
    try {
        await facade.closeAllProjects();
    } finally {
        disposeWorldEngineFacade(normalizedRoot);
    }
}

/** 释放全部 Plot/World Engine runtime；供进程关闭与测试隔离使用。 */
export async function disposePlotFacades(): Promise<void> {
    const activeFacades = [...facades.values()];
    facades.clear();
    try {
        await Promise.all(activeFacades.map((facade) => facade.closeAllProjects()));
    } finally {
        disposeWorldEngineFacades();
    }
}

// Project 资源生命周期：Plot 的 Project PrismaClient 缓存交由统一注册表关闭（删除/空闲/关停）。
registerProjectResourceOwner({
    name: "plot-facade",
    async close(projectPath) {
        await Promise.all([...facades.values()].map((facade) => facade.closeProject(projectPath)));
    },
    async closeAll() {
        await disposePlotFacades();
    },
});

export {
    requirePhaseId,
    requirePlotId,
    requireSceneId,
    requireStoryThreadId,
};
