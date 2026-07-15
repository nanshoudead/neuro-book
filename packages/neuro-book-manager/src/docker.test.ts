import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {parse} from "yaml";

const processMocks = vi.hoisted(() => ({
    commandAvailable: vi.fn(async () => true),
    run: vi.fn(async () => undefined),
    runCapture: vi.fn(async () => "false\n"),
}));

vi.mock("#manager/process", () => processMocks);

const roots: string[] = [];
beforeEach(() => {
    vi.resetModules();
    processMocks.commandAvailable.mockClear();
    processMocks.run.mockClear();
    processMocks.runCapture.mockReset().mockResolvedValue("false\n");
});
afterEach(async () => {
    delete process.env.NEURO_BOOK_CONTAINER_ENGINE;
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Docker Compose部署合同", () => {
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
        const output = await writeDockerCompose({root, stateRoot: root, profile: "source-docker", image: "neuro-book:test", port: 3000});
        const compose = parse(await readFile(output, "utf8")) as {services: {app: {user?: string}}};
        if (process.platform === "win32" || !expectsUser) expect(compose.services.app.user).toBeUndefined();
        else expect(compose.services.app.user).toBe(`${process.getuid?.()}:${process.getgid?.()}`);
    });
});
