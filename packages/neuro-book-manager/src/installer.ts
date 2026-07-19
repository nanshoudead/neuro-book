import {randomUUID} from "node:crypto";
import {copyFile, readFile, readdir, rename} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, relative, resolve} from "node:path";

import {applyJournaledApplicationMigrations} from "#manager/migration-operation";
import {
    stageReleaseProduct,
    stageReleaseSource,
    switchProduct,
    switchReleaseSource,
    type StagedProduct,
    type StagedReleaseSource,
} from "#manager/component";
import {ensureStateFiles} from "#manager/config";
import {buildSourceDockerImage, inspectDockerApplication, resolveContainerEngine, startDocker, stopDocker, writeDockerCompose} from "#manager/docker";
import {ensureDirectory, pathExists, removePath} from "#manager/files";
import {assertCleanWorktree, createStagedWorktree, materializeRepository, removeStagedWorktree, repositoryRevision} from "#manager/git";
import {assertNativeProductStopped, backupApplicationDatabase, verifyNativeProduct} from "#manager/health";
import {withInstallLock} from "#manager/lock";
import {assertInstallPreflight, inspectInstallPreflight, type InstallPreflightResult} from "#manager/install-preflight";
import {readInstallationManifest, resolveReleaseManifest, writeInstallationManifest} from "#manager/manifest-store";
import {
    completeRuntimeWrapperSwitch,
    commitOperation,
    createOperation,
    pathCreateEffect,
    pathRetireEffect,
    prepareRuntimeWrapperSwitch,
    recoverInterruptedOperations,
    setOperationEffect,
    updateOperation,
} from "#manager/operation";
import {assertProfileSupported, currentProductPlatform} from "#manager/platform";
import {installationPaths} from "#manager/paths";
import {portableLaunchers, writePortableLaunchers} from "#manager/portable-launchers";
import {buildSourceProduct, installSourceDependencies} from "#manager/product";
import {profileDefinition} from "#manager/profiles";
import {parseInstallationManifest} from "#manager/schema";
import {sourceDockerImageName} from "#manager/source-docker-image";
import {commandAvailable, runCapture} from "#manager/process";
import {installManagerExecutable, resolveManagerRuntime, runtimeExecutable, writeManagerWrapper, writeRuntimeWrapper} from "#manager/runtime";
import {activateManagedTools, installManagedTool, writeManagedToolWrappers} from "#manager/tools";
import type {
    ApplicationRuntimeComponent,
    InstallProfile,
    InstallationComponents,
    InstallationManifest,
    ManagerRuntimeComponent,
    OperationJournal,
    OperationPlan,
    ReleaseChannel,
    ReleaseManifest,
    SourceComponent,
    SystemToolComponent,
    ToolComponents,
} from "#manager/types";
import {lt} from "semver";

import {MANAGER_VERSION} from "#manager/version-info";

export type InstallOptions = {
    root: string;
    profile: InstallProfile;
    channel: ReleaseChannel;
    version?: string;
    releaseManifest?: string;
    port: number;
    authEnabled: boolean;
    dryRun: boolean;
    managerExecutable: string;
};

export type AdoptSourceOptions = Omit<InstallOptions, "profile"> & {profile: "source-dev" | "source-product" | "source-docker"};

/** 构造安装计划，预检和物化 Source 均早于 State Root 创建。 */
export function installPlan(options: InstallOptions): OperationPlan {
    const definition = profileDefinition(options.profile);
    const steps = [
        `预检 Installation Root：${options.root}`,
        `准备 Manager Host Runtime：${options.profile === "windows-portable" ? "managed" : "system/stage0"}`,
        `准备 Source：${definition.source}`,
    ];
    if (definition.product !== "none") steps.push(`准备 Product：${definition.product}`);
    steps.push(`初始化 State Root：${options.profile === "windows-portable" ? "data" : "."}`);
    if (definition.docker) steps.push("生成 Docker Compose");
    steps.push("迁移与健康检查", "提交 installation.json 与稳定 wrapper");
    return {action: "install", root: options.root, profile: options.profile, steps};
}

/** 执行 Fresh Install；失败只回滚本次创建的 Manager-owned 路径。 */
export async function install(options: InstallOptions): Promise<InstallationManifest> {
    const preflight = await inspectInstallPreflight(options);
    return installWithPreflight(options, preflight);
}

/** 使用同一次Clack/CLI预检结果执行Fresh Install。 */
export async function installWithPreflight(options: InstallOptions, preflight: InstallPreflightResult): Promise<InstallationManifest> {
    assertMatchingPreflight(options, preflight);
    assertInstallPreflight(preflight);
    return installInternal(options, "fresh", preflight);
}

/** 接管已验证Git checkout；Source准备始终先在detached worktree完成。 */
export async function installSourceAdoption(options: AdoptSourceOptions): Promise<InstallationManifest> {
    return installInternal(options, "adopt");
}

async function installInternal(options: InstallOptions, mode: "fresh" | "adopt", preflight?: InstallPreflightResult): Promise<InstallationManifest> {
    if (options.dryRun) throw new Error("dry-run 应通过 installPlan 输出，不应调用 install。" );
    assertProfileSupported(options.profile);
    const definition = profileDefinition(options.profile);
    const containerEngine = definition.docker
        ? mode === "fresh" ? preflight?.report.containerEngine ?? null : await resolveContainerEngine()
        : null;
    if (definition.docker && !containerEngine) throw new Error(`${options.profile}预检没有选择可用的Container Engine。`);
    const portable = options.profile === "windows-portable";
    const paths = installationPaths(options.root, portable);
    if (mode === "adopt") await preflightAdoptionRoot(paths.root, options.profile);
    await ensureDirectory(paths.root);
    await ensureDirectory(paths.deploy);
    return withInstallLock(join(paths.deploy, "install.lock"), async () => {
        await recoverInterruptedOperations(paths.root);
        if (await readInstallationManifest(paths.manifest)) {
            throw new Error("Installation Root 已由 NeuroBook Manager 管理，请使用 neuro-book update。" );
        }
        const id = randomUUID();
        const staging = join(paths.staging, id);
        const backup = join(paths.backups, id);
        let journal = await createOperation({
            id,
            action: "install",
            root: paths.root,
            containerEngine,
            effects: [pathCreateEffect(relative(paths.root, staging).replaceAll("\\", "/"))],
            backupRoot: backup,
            previousManifest: null,
            nextManifest: null,
        });
        await ensureDirectory(staging);
        journal = await setOperationEffect(journal, pathCreateEffect(relative(paths.root, staging).replaceAll("\\", "/"), "applied"));
        const createdComponents: string[] = [];
        const retiredComponents: string[] = [];
        let stagedWorktree: string | null = null;
        try {
            if (mode === "adopt" && (options.profile === "source-product" || options.profile === "source-docker")) {
                await assertNativeProductStopped(paths.state);
                const database = await backupApplicationDatabase(paths.state, backup, async (intent) => {
                    journal = await setOperationEffect(journal, {
                        kind: "sqlite-backup",
                        state: "planned",
                        owner: "app-sqlite",
                        configuredUrl: intent.configuredUrl,
                        stateRoot: intent.stateRoot,
                        hostPath: intent.databasePath,
                        backupPath: intent.backupPath,
                        checkpoint: {busy: 0, log: -1, checkpointed: -1},
                    });
                });
                if (database) journal = await setOperationEffect(journal, {
                    kind: "sqlite-backup",
                    state: "applied",
                    owner: "app-sqlite",
                    configuredUrl: database.configuredUrl,
                    stateRoot: paths.state,
                    hostPath: database.databasePath,
                    backupPath: database.backupPath,
                    checkpoint: database.checkpoint,
                });
            }
            const result = await prepareInstallation(options, journal, staging, backup, createdComponents, retiredComponents, mode, preflight?.release ?? null);
            stagedWorktree = result.stagedWorktree;
            journal = result.journal;
            journal = await prepareRuntimeWrapperSwitch(journal);
            if (result.manifest.components.managerRuntime.provider === "managed") {
                await writeRuntimeWrapper(paths.root, result.manifest.components.managerRuntime);
            }
            await writeManagedToolWrappers(paths.root, result.manifest.components.tools);
            await writeManagerWrapper(paths.root, result.manifest.components.manager, result.manifest.components.managerRuntime);
            journal = await completeRuntimeWrapperSwitch(journal);
            journal = await setOperationEffect(journal, {kind: "manifest-switch", state: "planned", owner: "manifest"});
            await writeInstallationManifest(paths.manifest, result.manifest);
            journal = await setOperationEffect(journal, {kind: "manifest-switch", state: "applied", owner: "manifest"});
            await commitOperation(journal);
            if (stagedWorktree) await removeStagedWorktree(paths.root, stagedWorktree);
            await removePath(staging);
            return result.manifest;
        } catch (error) {
            if (stagedWorktree || mode === "adopt") await removeStagedWorktree(paths.root, stagedWorktree ?? join(tmpdir(), `nbook-adopt-worktree-${id}`)).catch(() => undefined);
            await recoverInterruptedOperations(paths.root).catch(() => undefined);
            throw error;
        }
    });
}

async function prepareInstallation(
    options: InstallOptions,
    initialJournal: OperationJournal,
    staging: string,
    backup: string,
    createdComponents: string[],
    retiredComponents: string[],
    mode: "fresh" | "adopt",
    preflightRelease: ReleaseManifest | null,
): Promise<{manifest: InstallationManifest; journal: OperationJournal; stagedWorktree: string | null}> {
    const portable = options.profile === "windows-portable";
    const paths = installationPaths(options.root, portable);
    const definition = profileDefinition(options.profile);
    let journal = initialJournal;
    journal = await setOperationEffect(journal, {kind: "component-switch", state: "planned", owner: "managed-assets"});
    const recordCreated = async (path: string): Promise<void> => {
        journal = await setOperationEffect(journal, pathCreateEffect(path));
    };
    const recordCreatedApplied = async (path: string): Promise<void> => {
        journal = await setOperationEffect(journal, pathCreateEffect(path, "applied"));
    };
    const recordRetired = async (path: string): Promise<void> => {
        journal = await setOperationEffect(journal, pathRetireEffect(path));
    };
    const managerRuntime = await resolveManagerRuntime(paths.root, portable, createdComponents, recordCreated, recordCreatedApplied, retiredComponents, recordRetired);
    const manager = await installManagerExecutable(paths.root, MANAGER_VERSION, options.managerExecutable, createdComponents, recordCreated, recordCreatedApplied);
    const preparedTools = await prepareTools(paths.root, options.profile, createdComponents, retiredComponents, journal);
    const tools = preparedTools.tools;
    journal = preparedTools.journal;
    journal = await setOperationEffect(journal, {kind: "component-switch", state: "applied", owner: "managed-assets"});
    activateManagedTools(paths.root, tools);
    let appVersion = options.version?.replace(/^v/u, "") ?? "0.0.0";
    let sourceRevision = "";
    let source: SourceComponent;
    let stagedSource: StagedReleaseSource | null = null;
    let stagedProduct: StagedProduct | null = null;
    let stagedWorktree: string | null = null;
    const release = mode === "fresh"
        ? preflightRelease
        : definition.source === "release" || definition.source === "container"
            ? await resolveReleaseManifest(options.channel, options.version, options.releaseManifest)
            : null;
    if (!release && (options.version || options.releaseManifest)) {
        throw new Error(`Profile ${options.profile}使用Git Source，不接受--version或--release-manifest。`);
    }
    if (release) {
        assertManagerVersion(release.minManagerVersion, paths.root, options.channel);
        appVersion = release.version;
        sourceRevision = release.sourceRevision;
    }
    if (definition.source === "git") {
        if (mode === "fresh") {
            if (await pathExists(join(paths.root, ".git"))) {
                throw new Error("Fresh Install目标已存在Git checkout，请改用adopt。" );
            }
            journal = await setOperationEffect(journal, {kind: "git-checkout", state: "planned", owner: "source"});
        }
        await materializeRepository(paths.root);
        if (mode === "fresh") {
            journal = await setOperationEffect(journal, {kind: "git-checkout", state: "applied", owner: "source"});
        }
        sourceRevision = await repositoryRevision(paths.root);
        appVersion = await sourcePackageVersion(paths.root);
        source = {
            provider: "git",
            version: appVersion,
            revision: sourceRevision,
            path: ".",
            repository: "https://github.com/notnotype/neuro-book.git",
            branch: "master",
        };
        if (mode === "adopt") {
            stagedWorktree = join(tmpdir(), `nbook-adopt-worktree-${initialJournal.id}`);
            await createStagedWorktree(paths.root, stagedWorktree, sourceRevision);
        }
    } else if (definition.source === "release" && release) {
        stagedSource = await stageReleaseSource({
            root: paths.root,
            staging,
            asset: release.source,
            version: release.version,
            revision: release.sourceRevision,
        });
        source = stagedSource.component;
    } else if (release) {
        source = {provider: "container", version: release.version, revision: release.sourceRevision, path: "/app"};
    } else {
        throw new Error(`Profile ${options.profile} 无法解析 Source。`);
    }
    const applicationRuntime: ApplicationRuntimeComponent = definition.applicationRuntime === "container"
        ? {provider: "container", version: appVersion}
        : managerRuntime;
    const bun = applicationRuntime.provider === "container" ? null : runtimeExecutable(paths.root, applicationRuntime);
    let product: InstallationComponents["product"];
    if (options.profile === "source-dev") {
        if (!bun) throw new Error("Source Dev 缺少 Application Runtime。" );
        if (stagedWorktree) await installSourceDependencies(stagedWorktree, bun);
        const createsNodeModules = !await pathExists(join(paths.root, "node_modules"));
        if (createsNodeModules) journal = await setOperationEffect(journal, pathCreateEffect("node_modules"));
        await installSourceDependencies(paths.root, bun);
        if (createsNodeModules) {
            journal = await setOperationEffect(journal, pathCreateEffect("node_modules", "applied"));
        }
    } else if (options.profile === "source-product") {
        if (!bun) throw new Error("Source Product 缺少 Application Runtime。" );
        await installSourceDependencies(stagedWorktree ?? paths.root, bun);
        stagedProduct = await buildSourceProduct({
            root: paths.root,
            sourceRoot: stagedWorktree ?? undefined,
            staging: join(staging, "build"),
            version: appVersion,
            revision: sourceRevision,
            stateRoot: paths.state,
            bun,
        });
        product = stagedProduct.component;
    } else if ((options.profile === "product-bun" || options.profile === "windows-portable") && release) {
        const platform = currentProductPlatform();
        const asset = release.products.find((item) => item.platform === platform);
        if (!asset) throw new Error(`Release ${release.version} 缺少 ${platform} Product。`);
        stagedProduct = await stageReleaseProduct({
            staging,
            asset,
            version: release.version,
            revision: release.sourceRevision,
        });
        product = stagedProduct.component;
    } else if (options.profile === "source-docker") {
        if (!journal.containerEngine) throw new Error("Source Docker安装缺少Container Engine。" );
        const engine = journal.containerEngine;
        product = {provider: "container", version: appVersion, revision: sourceRevision, image: sourceDockerImageName(sourceRevision, journal.id)};
        journal = await setOperationEffect(journal, {kind: "docker-image", state: "planned", owner: "product", image: product.image});
        await buildSourceDockerImage(engine, stagedWorktree ?? paths.root, product.image);
        journal = await setOperationEffect(journal, {kind: "docker-image", state: "applied", owner: "product", image: product.image});
    } else if (options.profile === "ghcr" && release) {
        product = {
            provider: "container",
            version: release.version,
            revision: release.sourceRevision,
            image: release.ghcr.ref,
            digest: release.ghcr.digest,
        };
    }
    journal = await updateOperation(journal, "staged");
    const components: InstallationComponents = {source, product, manager, managerRuntime, applicationRuntime, tools};
    const now = new Date().toISOString();
    const manifest: InstallationManifest = {
        schemaVersion: 4,
        profile: options.profile,
        containerEngine: journal.containerEngine,
        managerVersion: MANAGER_VERSION,
        appVersion,
        channel: options.channel,
        sourceRevision,
        stateRoot: portable ? "data" : ".",
        components,
        installedAt: now,
        updatedAt: now,
    };
    parseInstallationManifest(manifest);
    journal = await updateOperation(journal, "validated", {nextManifest: manifest});
    if (stagedSource) {
        await switchReleaseSource({
            root: paths.root,
            staged: stagedSource,
            backup: join(backup, "source"),
            previousFiles: [],
            onSwitchIntent: async () => {
                journal = await setOperationEffect(journal, {kind: "component-switch", state: "planned", owner: "source"});
            },
        });
        journal = await setOperationEffect(journal, {kind: "component-switch", state: "applied", owner: "source"});
    }
    if (stagedProduct) {
        await switchProduct(paths.root, stagedProduct.outputRoot, join(backup, "product"), async () => {
            journal = await setOperationEffect(journal, {kind: "component-switch", state: "planned", owner: "product"});
        });
        journal = await setOperationEffect(journal, {kind: "component-switch", state: "applied", owner: "product"});
    }
    if (options.profile === "source-docker" && product?.provider === "container"
        || options.profile === "ghcr" && product?.provider === "container" && product.digest) {
        const finalCompose = join(paths.deploy, "docker-compose.generated.yml");
        const composeCreated = !await pathExists(finalCompose);
        const previousCompose = composeCreated ? undefined : join(backup, "docker-compose.generated.yml");
        const engine = journal.containerEngine;
        if (!engine) throw new Error(`${options.profile}安装缺少Container Engine。`);
        const previousInspection = composeCreated ? null : await inspectDockerApplication(engine, paths.root, paths.state);
        const previousState = !previousInspection?.containerId
            ? "missing" as const
            : previousInspection.status === "running" ? "running" as const : "stopped" as const;
        journal = await setOperationEffect(journal, {
            kind: "compose",
            state: "planned",
            owner: "compose",
            previousState,
            stopped: previousState === "running",
            previousCompose,
            created: composeCreated,
            previousImage: previousInspection?.configuredImage,
            targetImage: options.profile === "ghcr" ? `${product.image}@${product.digest}` : product.image,
        });
        if (previousCompose) {
            await ensureDirectory(backup);
            await copyFile(finalCompose, previousCompose);
        }
        const stagedCompose = await writeDockerCompose({
            engine,
            root: paths.root,
            stateRoot: paths.state,
            profile: options.profile,
            image: options.profile === "ghcr" ? `${product.image}@${product.digest}` : product.image,
            port: options.port,
            output: join(staging, "docker-compose.generated.yml"),
            layoutPath: finalCompose,
        });
        if (previousState === "running") await stopDocker(engine, paths.root, paths.state);
        await removePath(finalCompose);
        await rename(stagedCompose, finalCompose);
        journal = await setOperationEffect(journal, {
            kind: "compose",
            state: "applied",
            owner: "compose",
            previousState,
            stopped: previousState === "running",
            previousCompose,
            created: composeCreated,
            previousImage: previousInspection?.configuredImage,
            targetImage: options.profile === "ghcr" ? `${product.image}@${product.digest}` : product.image,
        });
    }
    journal = await updateOperation(journal, "switched");
    const createdStatePaths = await ensureStateFiles(paths.state, options.port, options.authEnabled, async (path) => {
        const ownedPath = relative(paths.root, path).replaceAll("\\", "/");
        journal = await setOperationEffect(journal, {kind: "path-create", state: "planned", owner: "state", path: ownedPath});
    });
    for (const path of createdStatePaths) {
        journal = await setOperationEffect(journal, {kind: "path-create", state: "applied", owner: "state", path: relative(paths.root, path).replaceAll("\\", "/")});
    }
    journal = await applyJournaledApplicationMigrations(paths.root, manifest, journal);
    journal = await updateOperation(journal, "migrated");
    if (options.profile === "source-product" || options.profile === "product-bun" || options.profile === "windows-portable") {
        await assertNativeProductStopped(paths.state);
        if (!bun) throw new Error("原生 Product 健康检查缺少 Application Runtime。" );
        await verifyNativeProduct(paths.root, paths.state, bun, appVersion);
    } else if (options.profile === "ghcr" || options.profile === "source-docker") {
        if (!journal.containerEngine) throw new Error(`${options.profile}启动缺少Container Engine。`);
        await startDocker(journal.containerEngine, paths.root, paths.state, options.profile, appVersion);
    }
    if (portable) {
        await writePortableLaunchers(paths.root, async (path) => {
            journal = await setOperationEffect(journal, pathCreateEffect(relative(paths.root, path).replaceAll("\\", "/")));
        });
        for (const launcher of portableLaunchers()) {
            journal = await setOperationEffect(journal, pathCreateEffect(launcher.name, "applied"));
        }
    }
    journal = await updateOperation(journal, "healthy");
    if (mode === "adopt") {
        await assertCleanWorktree(paths.root, [".deploy", ".runtime", ".output", "workspace", "config.yaml", ".env", "logs", "node_modules"]);
        if (await repositoryRevision(paths.root) !== sourceRevision) throw new Error("接管期间Git HEAD发生变化，停止提交Manifest。" );
    }
    return {manifest, journal, stagedWorktree};
}

/** Source Adoption专用目标身份门禁；Fresh Install由Install Preflight Module负责。 */
async function preflightAdoptionRoot(root: string, profile: InstallProfile): Promise<void> {
    const entries = await readdir(root);
    if (entries.includes(".git")) {
        if (!profile.startsWith("source-")) throw new Error("已有Git checkout只支持Source Profile接管。" );
        return;
    }
    throw new Error("Source Adoption目标不是Git checkout。" );
}

/** 防止调用方把其他选择生成的预检报告用于当前安装。 */
function assertMatchingPreflight(options: InstallOptions, preflight: InstallPreflightResult): void {
    const report = preflight.report;
    if (report.targetRoot !== resolve(options.root)
        || report.profile !== options.profile
        || report.port !== options.port
        || (report.release && report.release.channel !== options.channel)) {
        throw new Error("安装参数与预检报告不一致；拒绝复用过期预检结果。" );
    }
    if (options.version && report.release?.version !== options.version.replace(/^v/u, "")) {
        throw new Error("安装版本与预检Release不一致；拒绝复用过期预检结果。" );
    }
}

async function prepareTools(
    root: string,
    profile: InstallProfile,
    createdPaths: string[],
    retiredPaths: string[],
    initialJournal: OperationJournal,
): Promise<{tools: ToolComponents; journal: OperationJournal}> {
    let journal = initialJournal;
    const record = async (path: string): Promise<void> => {
        journal = await setOperationEffect(journal, pathCreateEffect(path));
    };
    const applied = async (path: string): Promise<void> => {
        journal = await setOperationEffect(journal, pathCreateEffect(path, "applied"));
    };
    const retire = async (path: string): Promise<void> => {
        journal = await setOperationEffect(journal, pathRetireEffect(path));
    };
    if (profile === "ghcr" || profile === "source-docker") {
        const version = profile;
        return {tools: {
            rg: {provider: "container", version},
            git: {provider: "container", version},
            python: {provider: "container", version},
        }, journal};
    }
    if (profile === "windows-portable") {
        const rg = await installManagedTool(root, "rg", {createdPaths, recordCreated: record, recordCreatedApplied: applied, retiredPaths, recordRetired: retire});
        const git = await installManagedTool(root, "git", {createdPaths, recordCreated: record, recordCreatedApplied: applied, retiredPaths, recordRetired: retire});
        return {tools: {rg, git}, journal};
    }
    if (profile === "source-dev" || profile === "source-product") {
        if (await commandAvailable("git")) return {tools: {git: await systemTool("git")}, journal};
        if (process.platform === "win32") {
            const git = await installManagedTool(root, "git", {createdPaths, recordCreated: record, recordCreatedApplied: applied, retiredPaths, recordRetired: retire});
            return {tools: {git}, journal};
        }
        throw new Error("缺少 Git。Linux 请先通过系统包管理器安装 Git。" );
    }
    return {tools: {}, journal};
}

async function systemTool(command: string): Promise<SystemToolComponent> {
    const version = (await runCapture(command, ["--version"])).split(/\r?\n/u)[0]?.trim() || "unknown";
    return {provider: "system", version, executable: command};
}

async function sourcePackageVersion(root: string): Promise<string> {
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {version?: string};
    return packageJson.version ?? "0.0.0";
}

function assertManagerVersion(minimum: string, root: string, channel: ReleaseChannel): void {
    if (!lt(MANAGER_VERSION, minimum)) return;
    const tag = channel === "stable" ? "latest" : "canary";
    throw new Error(`当前 Manager ${MANAGER_VERSION} 低于 Release 要求 ${minimum}。请执行：\ncd ${JSON.stringify(resolve(root))}\nbunx --bun @notnotype/neuro-book-manager@${tag} update`);
}
