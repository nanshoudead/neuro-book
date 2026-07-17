import path from "node:path";
import {describe, expect, it} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    createRuntimePaths,
    runtimePathsFromEnv,
} from "nbook/server/runtime/paths/runtime-paths";

describe("Runtime Paths Module", () => {
    it("从显式Application Root与State Root建立不可变路径集合", () => {
        const applicationRoot = absoluteFsPath(path.resolve(".agent", "runtime-paths", "app"));
        const stateRoot = absoluteFsPath(path.resolve(".agent", "runtime-paths", "state"));
        const paths = createRuntimePaths({applicationRoot, stateRoot});

        expect(paths).toEqual({
            applicationRoot,
            stateRoot,
            workspaceRoot: path.join(stateRoot, "workspace"),
            userNbookRoot: path.join(stateRoot, "workspace", ".nbook"),
            bootConfigPath: path.join(stateRoot, "config.yaml"),
            stateEnvPath: path.join(stateRoot, ".env"),
            logRoot: path.join(stateRoot, "logs"),
        });
        expect(Object.isFrozen(paths)).toBe(true);
    });

    it("环境Adapter支持默认根、Portable data和绝对外部State Root", () => {
        const startRoot = path.resolve(".agent", "runtime-paths", "installation");
        expect(runtimePathsFromEnv(startRoot, {}).stateRoot).toBe(startRoot);
        expect(runtimePathsFromEnv(startRoot, {NEURO_BOOK_STATE_ROOT: "data"}).stateRoot)
            .toBe(path.join(startRoot, "data"));
        const externalStateRoot = path.resolve(".agent", "runtime-paths", "external-state");
        expect(runtimePathsFromEnv(startRoot, {NEURO_BOOK_STATE_ROOT: externalStateRoot}).stateRoot)
            .toBe(externalStateRoot);
    });

    it("相对Application Root先相对startPath解析", () => {
        const startRoot = path.resolve(".agent", "runtime-paths", "launcher");
        const paths = runtimePathsFromEnv(startRoot, {
            NEURO_BOOK_APPLICATION_ROOT: "app",
            NEURO_BOOK_STATE_ROOT: "data",
        });

        expect(paths.applicationRoot).toBe(path.join(startRoot, "app"));
        expect(paths.stateRoot).toBe(path.join(startRoot, "app", "data"));
    });
});
