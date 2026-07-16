import {dirname, join, relative} from "node:path";
import {stringify} from "yaml";

import {writeTextAtomic} from "#manager/files";
import {commandAvailable, run, runCapture} from "#manager/process";
import type {ContainerEngine, InstallProfile} from "#manager/types";

/**
 * 为新安装选择并验证Container Engine。
 *
 * 已安装实例不得调用此函数重新选择，必须使用Manifest或Journal中的固定值。
 */
export async function resolveContainerEngine(preferred?: ContainerEngine): Promise<ContainerEngine> {
    const configured = preferred ?? configuredContainerEngine();
    if (configured) {
        await validateContainerEngine(configured);
        return configured;
    }
    const failures: string[] = [];
    for (const candidate of ["docker", "podman"] as const) {
        try {
            await validateContainerEngine(candidate);
            return candidate;
        } catch (error) {
            failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    throw new Error(`未检测到可用的 Docker 或 Podman。\n${failures.join("\n")}`);
}

/** 生成完整 Docker Compose，不依赖仓库根旧模板。 */
export async function writeDockerCompose(input: {
    engine: ContainerEngine;
    root: string;
    stateRoot: string;
    profile: "source-docker" | "ghcr";
    image?: string;
    port: number;
    output?: string;
    /** staging 写入时按最终 Compose 位置计算相对 volume。 */
    layoutPath?: string;
}): Promise<string> {
    const composePath = input.output ?? join(input.root, ".deploy", "docker-compose.generated.yml");
    const stateRelative = relative(dirname(input.layoutPath ?? composePath), input.stateRoot).replaceAll("\\", "/") || ".";
    const service = input.profile === "ghcr"
        ? {
            image: input.image,
            environment: commonEnvironment(input.port),
            ports: [`${input.port}:${input.port}`],
            volumes: [
                `${stateRelative}/workspace:/app/workspace`,
                `${stateRelative}/config.yaml:/app/config.yaml`,
                `${stateRelative}/logs:/app/logs`,
            ],
            restart: "unless-stopped",
        }
        : {
            image: input.image,
            environment: commonEnvironment(input.port),
            ports: [`${input.port}:${input.port}`],
            volumes: [
                `${stateRelative}/workspace:/app/workspace`,
                `${stateRelative}/config.yaml:/app/config.yaml`,
                `${stateRelative}/logs:/app/logs`,
            ],
            restart: "unless-stopped",
        };
    if (process.platform !== "win32" && typeof process.getuid === "function" && typeof process.getgid === "function" && !await isRootlessPodman(input.engine)) {
        Object.assign(service, {user: `${process.getuid()}:${process.getgid()}`});
    }
    await writeTextAtomic(composePath, stringify({services: {app: service}}));
    return composePath;
}

/** rootless Podman 已把容器 root 映射为宿主用户，不能再次注入宿主 UID。 */
async function isRootlessPodman(engine: ContainerEngine): Promise<boolean> {
    if (engine !== "podman") return false;
    return (await runCapture(engine, ["info", "--format", "{{.Host.Security.Rootless}}"])).trim() === "true";
}

/** 验证 Docker Profile 的基础 HTTP 与版本接口。 */
export async function verifyDockerApplication(port: number, expectedVersion: string): Promise<void> {
    const deadline = Date.now() + 45_000;
    let lastError = "容器尚未响应";
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/api/app/version`, {signal: AbortSignal.timeout(1_000)});
            if (response.ok) {
                const value = await response.json() as {versionLabel?: string};
                const expected = expectedVersion.startsWith("v") ? expectedVersion : `v${expectedVersion}`;
                if (value.versionLabel !== expected) throw new Error(`容器版本为 ${value.versionLabel ?? "<missing>"}，期望 ${expected}。`);
                return;
            }
            lastError = `HTTP ${response.status}`;
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    }
    throw new Error(`Docker HTTP 健康检查超时：${lastError}`);
}

/** 启动 Docker Profile。 */
export async function startDocker(engine: ContainerEngine, root: string, stateRoot: string, profile: InstallProfile): Promise<void> {
    const compose = join(root, ".deploy", "docker-compose.generated.yml");
    const args = ["compose", "--env-file", join(stateRoot, ".env"), "-f", compose];
    if (profile === "ghcr") {
        await run(engine, [...args, "pull", "app"], {cwd: root});
        await run(engine, [...args, "up", "-d"], {cwd: root});
        return;
    }
    await run(engine, [...args, "up", "-d"], {cwd: root});
}

/** 在切换Compose或备份SQLite前停止受管app容器。 */
export async function stopDocker(engine: ContainerEngine, root: string, stateRoot: string): Promise<void> {
    await run(engine, [...composeArgs(root, stateRoot), "stop", "app"], {cwd: root});
}

/** 回滚或Fresh Install失败时移除当前Compose创建的容器与网络。 */
export async function removeDockerDeployment(engine: ContainerEngine, root: string, stateRoot: string): Promise<void> {
    await run(engine, [...composeArgs(root, stateRoot), "down", "--remove-orphans"], {cwd: root});
}

/** 删除Source Docker事务创建但未提交的本地镜像。 */
export async function removeDockerImage(engine: ContainerEngine, root: string, image: string): Promise<void> {
    await run(engine, ["image", "rm", image], {cwd: root, stdio: "ignore"});
}

/** 从 staged Git worktree 构建带 revision tag 的 Source Docker image。 */
export async function buildSourceDockerImage(engine: ContainerEngine, sourceRoot: string, image: string): Promise<void> {
    await run(engine, ["build", "--file", join(sourceRoot, "Dockerfile"), "--tag", image, sourceRoot], {cwd: sourceRoot});
}

/** 生成所有Docker生命周期命令共用的Compose参数。 */
function composeArgs(root: string, stateRoot: string): string[] {
    return ["compose", "--env-file", join(stateRoot, ".env"), "-f", join(root, ".deploy", "docker-compose.generated.yml")];
}

function commonEnvironment(port: number): Record<string, string> {
    return {
        HOST: "0.0.0.0",
        PORT: String(port),
        NUXT_PORT: String(port),
        DATABASE_KIND: "sqlite",
        DATABASE_URL: "file:./workspace/.nbook/neuro-book.sqlite",
        NEURO_BOOK_STATE_ROOT: "/app",
    };
}

/** 只接受正式支持的Container Engine名称，禁止把环境变量当任意命令入口。 */
function configuredContainerEngine(): ContainerEngine | undefined {
    const value = process.env.NEURO_BOOK_CONTAINER_ENGINE?.trim();
    if (!value) return undefined;
    if (value !== "docker" && value !== "podman") {
        throw new Error(`NEURO_BOOK_CONTAINER_ENGINE只接受docker或podman，当前值为${value}。`);
    }
    return value;
}

/** 验证CLI、Compose子命令和Engine daemon/machine均可用。 */
async function validateContainerEngine(engine: ContainerEngine): Promise<void> {
    if (!await commandAvailable(engine)) {
        throw new Error(`系统中未找到${engine}命令。`);
    }
    try {
        await runCapture(engine, ["compose", "version"]);
    } catch (error) {
        throw new Error(`${engine} compose不可用：${error instanceof Error ? error.message : String(error)}`);
    }
    try {
        await runCapture(engine, ["info"]);
    } catch (error) {
        throw new Error(`${engine} daemon或machine不可用：${error instanceof Error ? error.message : String(error)}`);
    }
}
