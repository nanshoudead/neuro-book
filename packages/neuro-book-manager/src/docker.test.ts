import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {parse} from "yaml";

import {runDockerApplicationCommand, writeDockerCompose} from "#manager/docker";

const processCommands = vi.hoisted(() => ({
    capture: vi.fn(),
    run: vi.fn(),
}));

vi.mock("#manager/process", () => ({
    runCapture: processCommands.capture,
    run: processCommands.run,
}));

const roots: string[] = [];
beforeEach(() => vi.clearAllMocks());
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true}))));

describe("Docker Compose部署合同", () => {
    it("POSIX容器使用当前用户写入State Root", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-compose-"));
        roots.push(root);
        const output = await writeDockerCompose({root, stateRoot: root, profile: "source-docker", image: "neuro-book:test", port: 3000});
        const compose = parse(await readFile(output, "utf8")) as {services: {app: {user?: string; volumes: string[]}}};
        if (process.platform === "win32") expect(compose.services.app.user).toBeUndefined();
        else expect(compose.services.app.user).toBe(`${process.getuid?.()}:${process.getgid?.()}`);
        expect(compose.services.app.volumes).toContain("../.env:/app/.env");
    });

    it("一次性应用命令覆盖Product ENTRYPOINT并保留参数边界", async () => {
        processCommands.capture.mockResolvedValue("migration-report");
        const root = "/tmp/neuro-book";
        const stateRoot = "/tmp/neuro-book-state";

        await expect(runDockerApplicationCommand(root, stateRoot, [
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

    it("一次性应用命令拒绝空命令", async () => {
        await expect(runDockerApplicationCommand("/tmp/neuro-book", "/tmp/neuro-book-state", []))
            .rejects.toThrow("Docker一次性应用命令不能为空");
        expect(processCommands.capture).not.toHaveBeenCalled();
    });
});
