import path from "node:path";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

/** 一次NeuroBook进程使用的不可变物理根集合。 */
export type RuntimePaths = Readonly<{
    applicationRoot: AbsoluteFsPath;
    stateRoot: AbsoluteFsPath;
    workspaceRoot: AbsoluteFsPath;
    userNbookRoot: AbsoluteFsPath;
    bootConfigPath: AbsoluteFsPath;
    stateEnvPath: AbsoluteFsPath;
    logRoot: AbsoluteFsPath;
}>;

/**
 * 从已确定的Application Root与State Root建立Runtime Paths。
 *
 * 本函数不读取cwd或环境变量；生产、开发和测试Adapter必须在调用前决定两个根。
 */
export function createRuntimePaths(input: {
    applicationRoot: AbsoluteFsPath;
    stateRoot: AbsoluteFsPath;
}): RuntimePaths {
    return Object.freeze({
        applicationRoot: input.applicationRoot,
        stateRoot: input.stateRoot,
        workspaceRoot: absoluteFsPath(path.join(input.stateRoot, "workspace")),
        userNbookRoot: absoluteFsPath(path.join(input.stateRoot, "workspace", ".nbook")),
        bootConfigPath: absoluteFsPath(path.join(input.stateRoot, "config.yaml")),
        stateEnvPath: absoluteFsPath(path.join(input.stateRoot, ".env")),
        logRoot: absoluteFsPath(path.join(input.stateRoot, "logs")),
    });
}

/**
 * 进程环境Adapter：按Manager传入的环境变量或开发startPath建立Runtime Paths。
 *
 * `NEURO_BOOK_STATE_ROOT`相对Application Root解析；未设置时State Root等于
 * Application Root。只有本Adapter保留开发cwd默认值。
 */
export function runtimePathsFromEnv(
    startPath = process.cwd(),
    env: NodeJS.ProcessEnv = process.env,
): RuntimePaths {
    const startRoot = path.resolve(startPath);
    const applicationInput = env.NEURO_BOOK_APPLICATION_ROOT?.trim();
    const applicationRoot = absoluteFsPath(applicationInput
        ? path.isAbsolute(applicationInput)
            ? applicationInput
            : path.resolve(startRoot, applicationInput)
        : startRoot);
    const stateInput = env.NEURO_BOOK_STATE_ROOT?.trim();
    const stateRoot = absoluteFsPath(stateInput
        ? path.isAbsolute(stateInput)
            ? stateInput
            : path.resolve(applicationRoot, stateInput)
        : applicationRoot);
    return createRuntimePaths({applicationRoot, stateRoot});
}
