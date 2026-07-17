import {access, mkdir, mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";

const warn = vi.hoisted(() => vi.fn());

vi.mock("nitropack/runtime", () => ({
    defineNitroPlugin: (plugin: unknown) => plugin,
}));

vi.mock("nbook/server/app-logs/logger", () => ({
    appLogger: {warn},
}));

import workspaceRootPlugin from "nbook/server/plugins/workspace-root";

const roots: string[] = [];
const originalApplicationRoot = process.env.NEURO_BOOK_APPLICATION_ROOT;
const originalStateRoot = process.env.NEURO_BOOK_STATE_ROOT;

afterEach(async () => {
    warn.mockReset();
    restoreEnv("NEURO_BOOK_APPLICATION_ROOT", originalApplicationRoot);
    restoreEnv("NEURO_BOOK_STATE_ROOT", originalStateRoot);
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Workspace Root bootstrap", () => {
    it("先创建真实Workspace Root，再完成无副作用完整性检查", async () => {
        const root = await fixtureRoot();
        process.env.NEURO_BOOK_APPLICATION_ROOT = root;
        process.env.NEURO_BOOK_STATE_ROOT = "data";

        await runPlugin();

        await expect(access(path.join(root, "data", "workspace"))).resolves.toBeUndefined();
        expect(warn).not.toHaveBeenCalled();
    });

    it("检测到影子Workspace Root时只记录警告并保留两个目录", async () => {
        const root = await fixtureRoot();
        const shadowWorkspace = path.join(root, "workspace");
        process.env.NEURO_BOOK_APPLICATION_ROOT = root;
        process.env.NEURO_BOOK_STATE_ROOT = "data";
        await mkdir(shadowWorkspace, {recursive: true});

        await runPlugin();

        await expect(access(shadowWorkspace)).resolves.toBeUndefined();
        await expect(access(path.join(root, "data", "workspace"))).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledWith(
            "runtime.stateRoot.integrityFailed",
            {stateIntegrity: expect.objectContaining({kind: "shadow-workspace"})},
            expect.stringContaining("不会自动处理用户数据"),
        );
    });
});

/** 执行被Nitro注册的Workspace Root plugin。 */
async function runPlugin(): Promise<void> {
    await (workspaceRootPlugin as unknown as () => Promise<void>)();
}

/** 创建隔离Application Root。 */
async function fixtureRoot(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), "nbook-workspace-plugin-"));
    roots.push(root);
    return root;
}

/** 恢复单个运行时环境变量。 */
function restoreEnv(name: "NEURO_BOOK_APPLICATION_ROOT" | "NEURO_BOOK_STATE_ROOT", value: string | undefined): void {
    if (value === undefined) {
        delete process.env[name];
        return;
    }
    process.env[name] = value;
}
