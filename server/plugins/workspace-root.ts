import fs from "node:fs/promises";
import {defineNitroPlugin} from "nitropack/runtime";
import {appLogger} from "nbook/server/app-logs/logger";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {inspectStateRootIntegrity, stateRootIntegrityFailed} from "nbook/server/runtime/state-root-integrity";

export default defineNitroPlugin(async () => {
    const runtimePaths = runtimePathsFromEnv();
    await fs.mkdir(runtimePaths.workspaceRoot, {recursive: true});
    const stateIntegrity = await inspectStateRootIntegrity({
        installationRoot: runtimePaths.applicationRoot,
        stateRoot: runtimePaths.stateRoot,
    });
    if (stateRootIntegrityFailed(stateIntegrity)) {
        void appLogger.warn(
            "runtime.stateRoot.integrityFailed",
            {stateIntegrity},
            stateIntegrity.kind === "shadow-workspace"
                ? "检测到Installation Root与State Root存在Workspace Root数据分叉；应用不会自动处理用户数据"
                : "无法验证Installation Root与State Root的Workspace Root关系；应用不会自动处理用户数据",
        );
    }
});
