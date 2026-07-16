import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {parse} from "yaml";

const processMocks = vi.hoisted(() => ({
    commandAvailable: vi.fn(async (_command: string) => true),
    run: vi.fn(async (_command: string, _args: string[]) => undefined),
    runCapture: vi.fn(async (_command: string, _args: string[]) => "false\n"),
}));

vi.mock("#manager/process", () => processMocks);

const roots: string[] = [];
beforeEach(() => {
    vi.resetModules();
    processMocks.commandAvailable.mockReset().mockResolvedValue(true);
    processMocks.run.mockClear();
    processMocks.runCapture.mockReset().mockResolvedValue("false\n");
});
afterEach(async () => {
    delete process.env.NEURO_BOOK_CONTAINER_ENGINE;
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Docker Compose部署合同", () => {
    it("Docker验证失败时选择完整可用的Podman", async () => {
        processMocks.runCapture.mockImplementation(async (command: string, args: string[]) => {
            if (command === "docker" && args[0] === "compose") throw new Error("compose missing");
            return "ok\n";
        });
        const {resolveContainerEngine} = await import("#manager/docker");
        await expect(resolveContainerEngine()).resolves.toBe("podman");
        expect(processMocks.runCapture).toHaveBeenCalledWith("podman", ["compose", "version"]);
        expect(processMocks.runCapture).toHaveBeenCalledWith("podman", ["info"]);
    });

    it("显式engine在info失败时不静默切换", async () => {
        processMocks.runCapture.mockImplementation(async (command: string, args: string[]) => {
            if (command === "docker" && args[0] === "info") throw new Error("daemon unavailable");
            return "ok\n";
        });
        const {resolveContainerEngine} = await import("#manager/docker");
        await expect(resolveContainerEngine("docker")).rejects.toThrow("daemon或machine不可用");
        expect(processMocks.commandAvailable).not.toHaveBeenCalledWith("podman");
    });

    it("环境变量只接受docker或podman", async () => {
        process.env.NEURO_BOOK_CONTAINER_ENGINE = "nerdctl";
        const {resolveContainerEngine} = await import("#manager/docker");
        await expect(resolveContainerEngine()).rejects.toThrow("只接受docker或podman");
        expect(processMocks.commandAvailable).not.toHaveBeenCalled();
    });

    it.each([
        ["docker", "false\n", true],
        ["podman", "false\n", true],
        ["podman", "true\n", false],
    ] as const)("%s rootless=%s 的容器用户映射正确", async (engine, rootless, expectsUser) => {
        process.env.NEURO_BOOK_CONTAINER_ENGINE = engine;
        processMocks.runCapture.mockResolvedValue(rootless);
        const {writeDockerCompose} = await import("#manager/docker");
        const root = await mkdtemp(join(tmpdir(), "nbook-compose-"));
        roots.push(root);
        const output = await writeDockerCompose({engine, root, stateRoot: root, profile: "source-docker", image: "neuro-book:test", port: 3000});
        const compose = parse(await readFile(output, "utf8")) as {services: {app: {user?: string}}};
        if (process.platform === "win32" || !expectsUser) expect(compose.services.app.user).toBeUndefined();
        else expect(compose.services.app.user).toBe(`${process.getuid?.()}:${process.getgid?.()}`);
    });
});
