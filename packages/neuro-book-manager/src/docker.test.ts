import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {parse} from "yaml";

import {resolveContainerEngine, runDockerApplicationCommand, writeDockerCompose} from "#manager/docker";

const processCommands = vi.hoisted(() => ({
    available: vi.fn(),
    capture: vi.fn(),
    run: vi.fn(),
}));

vi.mock("#manager/process", () => ({
    commandAvailable: processCommands.available,
    runCapture: processCommands.capture,
    run: processCommands.run,
}));

const roots: string[] = [];
beforeEach(() => {
    vi.clearAllMocks();
    processCommands.available.mockResolvedValue(true);
});
afterEach(async () => {
    delete process.env.NEURO_BOOK_CONTAINER_ENGINE;
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Docker Compose部署合同", () => {
    it("Docker验证失败时选择完整可用的Podman", async () => {
        processCommands.capture.mockImplementation(async (command: string, args: string[]) => {
            if (command === "docker" && args[0] === "compose") throw new Error("compose missing");
            return "ok\n";
        });
        await expect(resolveContainerEngine()).resolves.toBe("podman");
        expect(processCommands.capture).toHaveBeenCalledWith("podman", ["compose", "version"], {
            env: expect.objectContaining({PODMAN_COMPOSE_PROVIDER: "podman-compose"}),
        });
        expect(processCommands.capture).toHaveBeenCalledWith("podman", ["info"]);
    });

    it("显式engine在info失败时不静默切换", async () => {
        processCommands.capture.mockImplementation(async (command: string, args: string[]) => {
            if (command === "docker" && args[0] === "info") throw new Error("daemon unavailable");
            return "ok\n";
        });
        await expect(resolveContainerEngine("docker")).rejects.toThrow("daemon或machine不可用");
        expect(processCommands.available).not.toHaveBeenCalledWith("podman");
    });

    it("环境变量只接受docker或podman", async () => {
        process.env.NEURO_BOOK_CONTAINER_ENGINE = "nerdctl";
        await expect(resolveContainerEngine()).rejects.toThrow("只接受docker或podman");
        expect(processCommands.available).not.toHaveBeenCalled();
    });

    it("POSIX容器使用当前用户写入State Root", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-compose-"));
        roots.push(root);
        const output = await writeDockerCompose({engine: "docker", root, stateRoot: root, profile: "source-docker", image: "neuro-book:test", port: 3000});
        const compose = parse(await readFile(output, "utf8")) as {services: {app: {user?: string; volumes: string[]}}};
        if (process.platform === "win32") expect(compose.services.app.user).toBeUndefined();
        else expect(compose.services.app.user).toBe(`${process.getuid?.()}:${process.getgid?.()}`);
        expect(compose.services.app.volumes).toContain("../.env:/app/.env");
    });

    it("rootless Podman不重复注入宿主UID", async () => {
        processCommands.capture.mockResolvedValue("true\n");
        const root = await mkdtemp(join(tmpdir(), "nbook-compose-podman-"));
        roots.push(root);
        const output = await writeDockerCompose({engine: "podman", root, stateRoot: root, profile: "source-docker", image: "neuro-book:test", port: 3000});
        const compose = parse(await readFile(output, "utf8")) as {services: {app: {user?: string}}};
        expect(compose.services.app.user).toBeUndefined();
    });

    it("一次性应用命令覆盖Product ENTRYPOINT并保留参数边界", async () => {
        processCommands.capture.mockResolvedValue("migration-report");
        const root = "/tmp/neuro-book";
        const stateRoot = "/tmp/neuro-book-state";

        await expect(runDockerApplicationCommand("docker", root, stateRoot, [
            "bun",
            ".output/server/scripts/db/migrate-agent-attachments.ts",
            "--dry-run",
            "--run-id",
            "operation-attachment",
        ])).resolves.toBe("migration-report");

        expect(processCommands.capture).toHaveBeenCalledWith("docker", [
            "compose",
            "--env-file",
            join(stateRoot, ".env"),
            "-f",
            join(root, ".deploy", "docker-compose.generated.yml"),
            "run",
            "--rm",
            "--no-deps",
            "--entrypoint",
            "bun",
            "app",
            ".output/server/scripts/db/migrate-agent-attachments.ts",
            "--dry-run",
            "--run-id",
            "operation-attachment",
        ], {cwd: root});
    });

    it("Podman Compose固定使用podman-compose provider", async () => {
        processCommands.capture.mockResolvedValue("migration-report");
        const root = "/tmp/neuro-book";
        const stateRoot = "/tmp/neuro-book-state";

        await runDockerApplicationCommand("podman", root, stateRoot, ["bun", "migration.ts"]);

        expect(processCommands.capture).toHaveBeenCalledWith("podman", [
            "compose",
            "--env-file",
            join(stateRoot, ".env"),
            "-f",
            join(root, ".deploy", "docker-compose.generated.yml"),
            "run",
            "--rm",
            "--no-deps",
            "--entrypoint",
            "bun",
            "app",
            "migration.ts",
        ], {
            cwd: root,
            env: expect.objectContaining({PODMAN_COMPOSE_PROVIDER: "podman-compose"}),
        });
    });

    it("一次性应用命令拒绝空命令", async () => {
        await expect(runDockerApplicationCommand("docker", "/tmp/neuro-book", "/tmp/neuro-book-state", []))
            .rejects.toThrow("Docker一次性应用命令不能为空");
        expect(processCommands.capture).not.toHaveBeenCalled();
    });
});
