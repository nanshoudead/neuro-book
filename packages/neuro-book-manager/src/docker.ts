import {readFile} from "node:fs/promises";
import {dirname, join, relative} from "node:path";
import {Type, type Static} from "typebox";
import {Value} from "typebox/value";
import {parse, stringify} from "yaml";

import {resolveStateDatabaseUrl} from "#manager/config";
import {writeTextAtomic} from "#manager/files";
import {statePort} from "#manager/health";
import {commandAvailable, run, runCapture} from "#manager/process";
import type {ContainerEngine, InstallProfile} from "#manager/types";
import {resolveAppSqliteLocation} from "nbook/server/runtime/app-sqlite-location";

const ComposeSchema = Type.Object({
    services: Type.Object({
        app: Type.Object({image: Type.String({minLength: 1})}, {additionalProperties: true}),
    }, {additionalProperties: true}),
}, {additionalProperties: true});

type ComposeValue = Static<typeof ComposeSchema>;

/** Docker app容器的轻量运行状态，不执行HTTP健康检查。 */
export type DockerApplicationInspection = {
    configuredImage: string;
    /** 尚未创建容器时为空。 */
    containerId?: string;
    /** 容器存在时由docker inspect返回。 */
    actualImage?: string;
    /** 容器存在时由docker inspect返回。 */
    status?: string;
    /** 容器退出时用于区分正常停止与崩溃。 */
    exitCode?: number;
    /** Compose未声明healthcheck时为空。 */
    health?: string;
};

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
    image: string;
    port: number;
    output?: string;
    /** staging 写入时按最终 Compose 位置计算相对 volume。 */
    layoutPath?: string;
}): Promise<string> {
    const composePath = input.output ?? join(input.root, ".deploy", "docker-compose.generated.yml");
    const stateRelative = relative(dirname(input.layoutPath ?? composePath), input.stateRoot).replaceAll("\\", "/") || ".";
    const database = resolveAppSqliteLocation(await resolveStateDatabaseUrl(input.stateRoot), input.stateRoot);
    if (!database.containerUrl) throw new Error("Docker Profile的App SQLite必须位于State Root内。" );
    const service = input.profile === "ghcr"
        ? {
            image: input.image,
            environment: commonEnvironment(input.port, database.containerUrl),
            ports: [`${input.port}:${input.port}`],
            volumes: [
                `${stateRelative}/workspace:/app/workspace`,
                `${stateRelative}/config.yaml:/app/config.yaml`,
                `${stateRelative}/.env:/app/.env`,
                `${stateRelative}/logs:/app/logs`,
            ],
            restart: "unless-stopped",
        }
        : {
            image: input.image,
            environment: commonEnvironment(input.port, database.containerUrl),
            ports: [`${input.port}:${input.port}`],
            volumes: [
                `${stateRelative}/workspace:/app/workspace`,
                `${stateRelative}/config.yaml:/app/config.yaml`,
                `${stateRelative}/.env:/app/.env`,
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

/** 启动 Docker Profile，并等待真实HTTP版本健康。 */
export async function startDocker(engine: ContainerEngine, root: string, stateRoot: string, profile: InstallProfile, expectedVersion: string): Promise<void> {
    const compose = join(root, ".deploy", "docker-compose.generated.yml");
    const args = ["compose", "--env-file", join(stateRoot, ".env"), "-f", compose];
    if (profile === "ghcr") {
        await run(engine, [...args, "pull", "app"], {cwd: root});
        await run(engine, [...args, "up", "-d"], {cwd: root});
    } else {
        await run(engine, [...args, "up", "-d"], {cwd: root});
    }
    await verifyDockerApplication(await statePort(stateRoot), expectedVersion);
}

/** 读取generated Compose中的固定app镜像，不依赖宿主Docker。 */
export async function readDockerComposeImage(root: string): Promise<string> {
    const composePath = join(root, ".deploy", "docker-compose.generated.yml");
    // YAML是外部文件，必须先作为unknown通过TypeBox门禁后才能读取字段。
    const value: unknown = parse(await readFile(composePath, "utf8"));
    if (!Value.Check(ComposeSchema, value)) {
        throw new Error(`generated Compose缺少services.app.image：${composePath}`);
    }
    return (value as ComposeValue).services.app.image;
}

/** 读取Compose配置与app容器状态；容器未创建是合法结果。 */
export async function inspectDockerApplication(engine: ContainerEngine, root: string, stateRoot: string): Promise<DockerApplicationInspection> {
    const configuredImages = (await runCapture(engine, [...composeArgs(root, stateRoot), "config", "--images"], {cwd: root}))
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
    if (configuredImages.length !== 1 || !configuredImages[0]) {
        throw new Error(`Compose必须只配置一个app镜像，实际为：${configuredImages.join(", ") || "<missing>"}`);
    }
    const configuredImage = configuredImages[0];
    const containerId = (await runCapture(engine, [...composeArgs(root, stateRoot), "ps", "--all", "--quiet", "app"], {cwd: root})).trim();
    if (!containerId) return {configuredImage};
    const [actualImage, status, exitCodeText, health] = await Promise.all([
        runCapture(engine, ["inspect", "--format", "{{.Config.Image}}", containerId], {cwd: root}).then((value) => value.trim()),
        runCapture(engine, ["inspect", "--format", "{{.State.Status}}", containerId], {cwd: root}).then((value) => value.trim()),
        runCapture(engine, ["inspect", "--format", "{{.State.ExitCode}}", containerId], {cwd: root}).then((value) => value.trim()),
        runCapture(engine, ["inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{end}}", containerId], {cwd: root}).then((value) => value.trim()),
    ]);
    const exitCode = Number(exitCodeText);
    return {
        configuredImage,
        containerId,
        actualImage,
        status,
        ...(Number.isInteger(exitCode) ? {exitCode} : {}),
        ...(health ? {health} : {}),
    };
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

/** 在当前Compose的app镜像中执行一次性命令，不启动依赖或长期服务。 */
export async function runDockerApplicationCommand(
    engine: ContainerEngine,
    root: string,
    stateRoot: string,
    command: string[],
): Promise<string> {
    const [entrypoint, ...args] = command;
    if (!entrypoint) throw new Error("Docker一次性应用命令不能为空。");
    return runCapture(engine, [
        ...composeArgs(root, stateRoot),
        "run",
        "--rm",
        "--no-deps",
        // Product镜像的正式ENTRYPOINT负责迁移并启动长期服务；维护命令必须显式绕过它。
        "--entrypoint",
        entrypoint,
        "app",
        ...args,
    ], {cwd: root});
}

/** 从 staged Git worktree 构建带 revision tag 的 Source Docker image。 */
export async function buildSourceDockerImage(engine: ContainerEngine, sourceRoot: string, image: string): Promise<void> {
    await run(engine, ["build", "--file", join(sourceRoot, "Dockerfile"), "--tag", image, sourceRoot], {cwd: sourceRoot});
}

/** 生成所有Docker生命周期命令共用的Compose参数。 */
function composeArgs(root: string, stateRoot: string): string[] {
    return ["compose", "--env-file", join(stateRoot, ".env"), "-f", join(root, ".deploy", "docker-compose.generated.yml")];
}

function commonEnvironment(port: number, databaseUrl: string): Record<string, string> {
    return {
        HOST: "0.0.0.0",
        PORT: String(port),
        NUXT_PORT: String(port),
        DATABASE_KIND: "sqlite",
        DATABASE_URL: databaseUrl,
        NEURO_BOOK_STATE_ROOT: "/app",
    };
}

/** rootless Podman已把容器root映射为宿主用户，不能再次注入宿主UID。 */
async function isRootlessPodman(engine: ContainerEngine): Promise<boolean> {
    if (engine !== "podman") return false;
    return (await runCapture(engine, ["info", "--format", "{{.Host.Security.Rootless}}"])).trim() === "true";
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
    if (!await commandAvailable(engine)) throw new Error(`系统中未找到${engine}命令。`);
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
