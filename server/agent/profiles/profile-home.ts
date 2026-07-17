import fs from "node:fs/promises";
import path from "node:path";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {
    absoluteFsPath,
    assertRealParentContained,
    assertRealPathContained,
    resolveContainedFilePath,
    type AbsoluteFsPath,
} from "nbook/server/runtime/paths/file-path";
import {
    resolveProjectWorkspaceInput,
} from "nbook/server/workspace-files/project-path";

export type ProfileHomeWriteMode = "create" | "overwrite";

export type ProfileHomeWriteResult = {
    written: boolean;
};

export type ProfileHomeScope = "global" | "project";

export type ProfileHomeListItem = {
    name: string;
    path: string;
    kind: "file" | "directory";
};

export type ProfileHomeFacade = {
    root: string;
    readText(filePath: string): Promise<string>;
    writeText(filePath: string, content: string, options?: {mode?: ProfileHomeWriteMode}): Promise<ProfileHomeWriteResult>;
    readJson(filePath: string): Promise<JsonValue>;
    writeJson(filePath: string, value: JsonValue, options?: {mode?: ProfileHomeWriteMode}): Promise<ProfileHomeWriteResult>;
    exists(filePath: string): Promise<boolean>;
    list(directoryPath?: string): Promise<ProfileHomeListItem[]>;
    move(fromPath: string, toPath: string, options?: {mode?: ProfileHomeWriteMode}): Promise<ProfileHomeWriteResult>;
    remove(filePath: string): Promise<void>;
    clear(): Promise<void>;
};

export type ProfileHomeContext = {
    profileKey: string;
    profileVersion: number;
    scope: ProfileHomeScope;
    root: string;
    /** global profile home所属的Workspace Root `.nbook`物理目录。 */
    workspaceNbookRoot?: string;
    projectRoot: string;
    home: ProfileHomeFacade;
};

export type ProfileHomeDefinition = {
    init?: (ctx: ProfileHomeContext) => Promise<void> | void;
    upgrade?: (ctx: ProfileHomeContext, oldVersion: number, targetVersion: number) => Promise<void> | void;
    reset?: (ctx: ProfileHomeContext) => Promise<void> | void;
};

type ProfileHomeMetadata = {
    profileKey: string;
    version: number;
    initializedAt: string;
    updatedAt: string;
};

/**
 * 定义 profile home 生命周期。目录由运行时决定，profile 只维护目录内容。
 */
export function defineProfileHome(definition: ProfileHomeDefinition): ProfileHomeDefinition {
    return definition;
}

/**
 * 计算 Project Workspace 下某个 profile 的 home 根目录。
 */
export function profileHomeRoot(projectRoot: string, profileKey: string): string {
    return path.join(projectRoot, "agents", safeProfileId(profileKey));
}

/**
 * 计算 Workspace Root `.nbook` 下某个全局 profile home 根目录。
 */
export function globalProfileHomeRoot(workspaceNbookRoot: string, profileKey: string): string {
    return path.join(workspaceNbookRoot, "agents", safeProfileId(profileKey));
}

/**
 * 将 session/config 中的 projectPath 解析为 Project Workspace 绝对路径。
 *
 * managed Workspace Root由调用方所在的Runtime Adapter决定；本Module不读取
 * cwd、State Root或进程环境。
 */
export function resolveProjectRootForProfileHome(
    workspaceRoot: AbsoluteFsPath,
    projectPath: string | undefined,
): string | null {
    if (!projectPath) {
        return null;
    }
    return resolveProjectWorkspaceInput(workspaceRoot, projectPath);
}

/**
 * 创建受限 profile home 文件 facade。
 */
export function createProfileHomeFacade(projectRoot: string, profileKey: string): ProfileHomeFacade {
    const containmentRoot = absoluteFsPath(path.resolve(projectRoot));
    const root = resolveContainedFilePath(containmentRoot, path.posix.join("agents", safeProfileId(profileKey)));
    return createProfileHomeFacadeAtRoot(containmentRoot, root);
}

/**
 * 创建全局 profile home 文件 facade。
 */
export function createGlobalProfileHomeFacade(workspaceNbookRoot: string, profileKey: string): ProfileHomeFacade {
    const containmentRoot = absoluteFsPath(path.resolve(workspaceNbookRoot));
    const root = resolveContainedFilePath(containmentRoot, path.posix.join("agents", safeProfileId(profileKey)));
    return createProfileHomeFacadeAtRoot(containmentRoot, root);
}

/**
 * 创建按 Project 优先、Global 兜底读取的 profile home facade。写入类操作只写 primary。
 */
export function createLayeredProfileHomeFacade(primary: ProfileHomeFacade, fallback: ProfileHomeFacade | undefined): ProfileHomeFacade {
    if (!fallback) {
        return primary;
    }
    return {
        root: primary.root,
        async readText(filePath) {
            try {
                return await primary.readText(filePath);
            } catch (error) {
                if (isNotFoundError(error)) {
                    return fallback.readText(filePath);
                }
                throw error;
            }
        },
        writeText: (filePath, content, options) => primary.writeText(filePath, content, options),
        async readJson(filePath) {
            try {
                return await primary.readJson(filePath);
            } catch (error) {
                if (isNotFoundError(error)) {
                    return fallback.readJson(filePath);
                }
                throw error;
            }
        },
        writeJson: (filePath, value, options) => primary.writeJson(filePath, value, options),
        exists: async (filePath) => await primary.exists(filePath) || await fallback.exists(filePath),
        async list(directoryPath = "") {
            const itemsByPath = new Map<string, ProfileHomeListItem>();
            for (const item of await fallback.list(directoryPath)) {
                itemsByPath.set(item.path, item);
            }
            for (const item of await primary.list(directoryPath)) {
                itemsByPath.set(item.path, item);
            }
            return [...itemsByPath.values()].sort((left, right) => left.path.localeCompare(right.path));
        },
        move: (fromPath, toPath, options) => primary.move(fromPath, toPath, options),
        remove: (filePath) => primary.remove(filePath),
        clear: () => primary.clear(),
    };
}

function createProfileHomeFacadeAtRoot(containmentRoot: AbsoluteFsPath, root: AbsoluteFsPath): ProfileHomeFacade {
    return {
        root,
        readText: async (filePath) => {
            const target = resolveHomePath(root, filePath);
            await assertRealPathContained(root, target);
            return fs.readFile(target, "utf-8");
        },
        writeText: async (filePath, content, options) => writeText(containmentRoot, root, filePath, content, options),
        readJson: async (filePath) => {
            const target = resolveHomePath(root, filePath);
            await assertRealPathContained(root, target);
            return JSON.parse(await fs.readFile(target, "utf-8")) as JsonValue;
        },
        writeJson: async (filePath, value, options) => writeText(containmentRoot, root, filePath, `${JSON.stringify(value, null, 4)}\n`, options),
        exists: async (filePath) => {
            const target = resolveHomePath(root, filePath);
            try {
                await assertRealPathContained(root, target);
                await fs.access(target);
                return true;
            } catch (error) {
                if (isNotFoundError(error)) {
                    return false;
                }
                throw error;
            }
        },
        list: async (directoryPath = "") => {
            const dir = directoryPath.trim() ? resolveHomePath(root, directoryPath) : root;
            await assertRealPathContained(root, absoluteFsPath(dir));
            const entries = await fs.readdir(dir, {withFileTypes: true}).catch((error) => {
                if (isNotFoundError(error)) return [];
                throw error;
            });
            return entries
                .filter((entry) => entry.isFile() || entry.isDirectory())
                .map((entry) => ({
                    name: entry.name,
                    path: normalizeRelativePath(path.posix.join(toPosixPath(directoryPath), entry.name)),
                    kind: entry.isDirectory() ? "directory" as const : "file" as const,
                }));
        },
        move: async (fromPath, toPath, options) => movePath(containmentRoot, root, fromPath, toPath, options),
        remove: async (filePath) => {
            const target = resolveHomePath(root, filePath);
            await assertRealParentContained(root, target);
            await fs.rm(target, {force: true, recursive: true});
        },
        clear: async () => {
            await assertRealParentContained(containmentRoot, root);
            await fs.rm(root, {force: true, recursive: true});
            await prepareProfileHomeRoot(containmentRoot, root);
        },
    };
}

/**
 * 确保 profile home 已按 profile version 初始化或升级。
 */
export async function ensureProfileHome(input: {
    projectRoot: string;
    profileKey: string;
    profileVersion: number;
    definition?: ProfileHomeDefinition;
}): Promise<ProfileHomeFacade> {
    const home = createProfileHomeFacade(input.projectRoot, input.profileKey);
    return ensureProfileHomeFacade({
        scope: "project",
        containmentRoot: absoluteFsPath(path.resolve(input.projectRoot)),
        root: home.root,
        projectRoot: input.projectRoot,
        profileKey: input.profileKey,
        profileVersion: input.profileVersion,
        definition: input.definition,
        home,
    });
}

/**
 * 确保全局 profile home 已按 profile version 初始化或升级。
 */
export async function ensureGlobalProfileHome(input: {
    /** 当前Runtime Workspace Root；调用方必须在进入本Module前完成环境投影。 */
    workspaceRoot: AbsoluteFsPath;
    profileKey: string;
    profileVersion: number;
    definition?: ProfileHomeDefinition;
}): Promise<ProfileHomeFacade> {
    const workspaceNbookRoot = resolveContainedFilePath(input.workspaceRoot, ".nbook");
    await prepareProfileHomeRoot(input.workspaceRoot, workspaceNbookRoot);
    const home = createGlobalProfileHomeFacade(workspaceNbookRoot, input.profileKey);
    return ensureProfileHomeFacade({
        scope: "global",
        containmentRoot: workspaceNbookRoot,
        root: home.root,
        workspaceNbookRoot,
        projectRoot: workspaceNbookRoot,
        profileKey: input.profileKey,
        profileVersion: input.profileVersion,
        definition: input.definition,
        home,
    });
}

async function ensureProfileHomeFacade(input: {
    scope: ProfileHomeScope;
    containmentRoot: AbsoluteFsPath;
    root: string;
    workspaceNbookRoot?: string;
    projectRoot: string;
    profileKey: string;
    profileVersion: number;
    definition?: ProfileHomeDefinition;
    home: ProfileHomeFacade;
}): Promise<ProfileHomeFacade> {
    const home = input.home;
    await prepareProfileHomeRoot(input.containmentRoot, absoluteFsPath(home.root));
    const now = new Date().toISOString();
    const metadata = await readMetadata(home);
    const ctx: ProfileHomeContext = {
        profileKey: input.profileKey,
        profileVersion: input.profileVersion,
        scope: input.scope,
        root: input.root,
        ...(input.workspaceNbookRoot ? {workspaceNbookRoot: input.workspaceNbookRoot} : {}),
        projectRoot: input.projectRoot,
        home,
    };
    if (!metadata) {
        await input.definition?.init?.(ctx);
        await writeMetadata(home, {
            profileKey: input.profileKey,
            version: input.profileVersion,
            initializedAt: now,
            updatedAt: now,
        });
        return home;
    }
    if (metadata.version < input.profileVersion) {
        await input.definition?.upgrade?.(ctx, metadata.version, input.profileVersion);
        await writeMetadata(home, {
            ...metadata,
            profileKey: input.profileKey,
            version: input.profileVersion,
            updatedAt: now,
        });
    }
    return home;
}

/**
 * 重置 profile home，并刷新 home metadata。
 */
export async function resetProfileHome(input: {
    projectRoot: string;
    profileKey: string;
    profileVersion: number;
    definition?: ProfileHomeDefinition;
}): Promise<ProfileHomeFacade> {
    const home = createProfileHomeFacade(input.projectRoot, input.profileKey);
    return resetProfileHomeFacade({
        scope: "project",
        containmentRoot: absoluteFsPath(path.resolve(input.projectRoot)),
        root: home.root,
        projectRoot: input.projectRoot,
        profileKey: input.profileKey,
        profileVersion: input.profileVersion,
        definition: input.definition,
        home,
    });
}

/**
 * 重置全局 profile home，并刷新 home metadata。
 */
export async function resetGlobalProfileHome(input: {
    /** 当前Runtime Workspace Root；调用方必须在进入本Module前完成环境投影。 */
    workspaceRoot: AbsoluteFsPath;
    profileKey: string;
    profileVersion: number;
    definition?: ProfileHomeDefinition;
}): Promise<ProfileHomeFacade> {
    const workspaceNbookRoot = resolveContainedFilePath(input.workspaceRoot, ".nbook");
    await prepareProfileHomeRoot(input.workspaceRoot, workspaceNbookRoot);
    const home = createGlobalProfileHomeFacade(workspaceNbookRoot, input.profileKey);
    return resetProfileHomeFacade({
        scope: "global",
        containmentRoot: workspaceNbookRoot,
        root: home.root,
        workspaceNbookRoot,
        projectRoot: workspaceNbookRoot,
        profileKey: input.profileKey,
        profileVersion: input.profileVersion,
        definition: input.definition,
        home,
    });
}

async function resetProfileHomeFacade(input: {
    scope: ProfileHomeScope;
    containmentRoot: AbsoluteFsPath;
    root: string;
    workspaceNbookRoot?: string;
    projectRoot: string;
    profileKey: string;
    profileVersion: number;
    definition?: ProfileHomeDefinition;
    home: ProfileHomeFacade;
}): Promise<ProfileHomeFacade> {
    const home = input.home;
    await prepareProfileHomeRoot(input.containmentRoot, absoluteFsPath(home.root));
    const ctx: ProfileHomeContext = {
        profileKey: input.profileKey,
        profileVersion: input.profileVersion,
        scope: input.scope,
        root: input.root,
        ...(input.workspaceNbookRoot ? {workspaceNbookRoot: input.workspaceNbookRoot} : {}),
        projectRoot: input.projectRoot,
        home,
    };
    await input.definition?.reset?.(ctx);
    const now = new Date().toISOString();
    await writeMetadata(home, {
        profileKey: input.profileKey,
        version: input.profileVersion,
        initializedAt: now,
        updatedAt: now,
    });
    return home;
}

function safeProfileId(profileKey: string): string {
    if (!/^[A-Za-z0-9._-]+$/u.test(profileKey)) {
        throw new Error(`profile key 不能作为 profile home 目录名：${profileKey}`);
    }
    return profileKey;
}

async function writeText(
    containmentRoot: AbsoluteFsPath,
    root: AbsoluteFsPath,
    filePath: string,
    content: string,
    options: {mode?: ProfileHomeWriteMode} = {},
): Promise<ProfileHomeWriteResult> {
    const mode = options.mode ?? "create";
    await prepareProfileHomeRoot(containmentRoot, root);
    const target = resolveHomePath(root, filePath);
    await assertRealPathContained(root, target);
    await fs.mkdir(path.dirname(target), {recursive: true});
    if (mode === "create" && await existsAbsolute(target)) {
        return {written: false};
    }
    await fs.writeFile(target, content, "utf-8");
    return {written: true};
}

async function movePath(
    containmentRoot: AbsoluteFsPath,
    root: AbsoluteFsPath,
    fromPath: string,
    toPath: string,
    options: {mode?: ProfileHomeWriteMode} = {},
): Promise<ProfileHomeWriteResult> {
    const mode = options.mode ?? "create";
    await prepareProfileHomeRoot(containmentRoot, root);
    const from = resolveHomePath(root, fromPath);
    const to = resolveHomePath(root, toPath);
    await assertRealParentContained(root, from);
    await assertRealParentContained(root, to);
    if (mode === "create" && await existsAbsolute(to)) {
        return {written: false};
    }
    await fs.mkdir(path.dirname(to), {recursive: true});
    if (mode === "overwrite") {
        await fs.rm(to, {force: true, recursive: true});
    }
    await fs.rename(from, to);
    return {written: true};
}

function resolveHomePath(root: AbsoluteFsPath, filePath: string): AbsoluteFsPath {
    const normalized = normalizeRelativePath(filePath);
    try {
        return resolveContainedFilePath(root, normalized);
    } catch {
        throw new Error(`profile home 路径越界：${filePath}`);
    }
}

function normalizeRelativePath(filePath: string): string {
    const normalized = toPosixPath(filePath).replace(/^\/+/u, "").replace(/\/+$/u, "");
    if (!normalized || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
        throw new Error(`非法 profile home 路径：${filePath}`);
    }
    return normalized;
}

function toPosixPath(filePath: string): string {
    return filePath.trim().replaceAll("\\", "/");
}

async function readMetadata(home: ProfileHomeFacade): Promise<ProfileHomeMetadata | null> {
    try {
        const parsed = JSON.parse(await home.readText("home.json")) as Partial<ProfileHomeMetadata>;
        if (typeof parsed.profileKey === "string" && typeof parsed.version === "number") {
            return {
                profileKey: parsed.profileKey,
                version: parsed.version,
                initializedAt: parsed.initializedAt ?? new Date(0).toISOString(),
                updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
            };
        }
    } catch (error) {
        if (!isNotFoundError(error)) {
            throw error;
        }
    }
    return null;
}

async function writeMetadata(home: ProfileHomeFacade, metadata: ProfileHomeMetadata): Promise<void> {
    await home.writeText("home.json", `${JSON.stringify(metadata, null, 4)}\n`, {mode: "overwrite"});
}

/** 安全创建Profile Home根，并确认父级链接没有逃出所属Project/Global根。 */
async function prepareProfileHomeRoot(containmentRoot: AbsoluteFsPath, root: AbsoluteFsPath): Promise<void> {
    await assertRealPathContained(containmentRoot, root);
    await fs.mkdir(root, {recursive: true});
    await assertRealPathContained(containmentRoot, root);
}

async function existsAbsolute(target: string): Promise<boolean> {
    try {
        await fs.access(target);
        return true;
    } catch (error) {
        if (isNotFoundError(error)) {
            return false;
        }
        throw error;
    }
}

function isNotFoundError(error: unknown): boolean {
    return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
