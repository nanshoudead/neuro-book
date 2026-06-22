import fs from "node:fs/promises";
import path from "node:path";
import type {JsonValue} from "nbook/server/agent/messages/types";

export type ProfileHomeWriteMode = "create" | "overwrite";

export type ProfileHomeWriteResult = {
    written: boolean;
};

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
 * 将 session/config 中的 projectPath 解析为 Project Workspace 绝对路径。
 */
export function resolveProjectRootForProfileHome(projectPath: string | undefined): string | null {
    if (!projectPath) {
        return null;
    }
    return path.isAbsolute(projectPath) ? path.resolve(projectPath) : path.resolve(process.cwd(), projectPath);
}

/**
 * 创建受限 profile home 文件 facade。
 */
export function createProfileHomeFacade(projectRoot: string, profileKey: string): ProfileHomeFacade {
    const root = profileHomeRoot(projectRoot, profileKey);
    return {
        root,
        readText: async (filePath) => fs.readFile(resolveHomePath(root, filePath), "utf-8"),
        writeText: async (filePath, content, options) => writeText(root, filePath, content, options),
        readJson: async (filePath) => JSON.parse(await fs.readFile(resolveHomePath(root, filePath), "utf-8")) as JsonValue,
        writeJson: async (filePath, value, options) => writeText(root, filePath, `${JSON.stringify(value, null, 4)}\n`, options),
        exists: async (filePath) => {
            try {
                await fs.access(resolveHomePath(root, filePath));
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
        move: async (fromPath, toPath, options) => movePath(root, fromPath, toPath, options),
        remove: async (filePath) => {
            await fs.rm(resolveHomePath(root, filePath), {force: true, recursive: true});
        },
        clear: async () => {
            await fs.rm(root, {force: true, recursive: true});
            await fs.mkdir(root, {recursive: true});
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
    await fs.mkdir(home.root, {recursive: true});
    const metadataPath = path.join(home.root, "home.json");
    const now = new Date().toISOString();
    const metadata = await readMetadata(metadataPath);
    const ctx: ProfileHomeContext = {
        profileKey: input.profileKey,
        profileVersion: input.profileVersion,
        projectRoot: input.projectRoot,
        home,
    };
    if (!metadata) {
        await input.definition?.init?.(ctx);
        await writeMetadata(metadataPath, {
            profileKey: input.profileKey,
            version: input.profileVersion,
            initializedAt: now,
            updatedAt: now,
        });
        return home;
    }
    if (metadata.version < input.profileVersion) {
        await input.definition?.upgrade?.(ctx, metadata.version, input.profileVersion);
        await writeMetadata(metadataPath, {
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
    await fs.mkdir(home.root, {recursive: true});
    const ctx: ProfileHomeContext = {
        profileKey: input.profileKey,
        profileVersion: input.profileVersion,
        projectRoot: input.projectRoot,
        home,
    };
    await input.definition?.reset?.(ctx);
    const now = new Date().toISOString();
    await writeMetadata(path.join(home.root, "home.json"), {
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

async function writeText(root: string, filePath: string, content: string, options: {mode?: ProfileHomeWriteMode} = {}): Promise<ProfileHomeWriteResult> {
    const mode = options.mode ?? "create";
    const target = resolveHomePath(root, filePath);
    await fs.mkdir(path.dirname(target), {recursive: true});
    if (mode === "create" && await existsAbsolute(target)) {
        return {written: false};
    }
    await fs.writeFile(target, content, "utf-8");
    return {written: true};
}

async function movePath(root: string, fromPath: string, toPath: string, options: {mode?: ProfileHomeWriteMode} = {}): Promise<ProfileHomeWriteResult> {
    const mode = options.mode ?? "create";
    const from = resolveHomePath(root, fromPath);
    const to = resolveHomePath(root, toPath);
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

function resolveHomePath(root: string, filePath: string): string {
    const normalized = normalizeRelativePath(filePath);
    const resolved = path.resolve(root, normalized);
    const relativePath = path.relative(root, resolved);
    if (relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))) {
        return resolved;
    }
    throw new Error(`profile home 路径越界：${filePath}`);
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

async function readMetadata(metadataPath: string): Promise<ProfileHomeMetadata | null> {
    try {
        const parsed = JSON.parse(await fs.readFile(metadataPath, "utf-8")) as Partial<ProfileHomeMetadata>;
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

async function writeMetadata(metadataPath: string, metadata: ProfileHomeMetadata): Promise<void> {
    await fs.mkdir(path.dirname(metadataPath), {recursive: true});
    await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 4)}\n`, "utf-8");
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
