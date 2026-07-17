import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {dirname} from "node:path";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {applyVariableJsonPatch} from "nbook/server/agent/variables/json-patch";
import type {VariableJsonPatchOperation, VariableNamespace} from "nbook/server/agent/variables/types";
import {
    assertRealPathContained,
    resolveContainedFilePath,
    type AbsoluteFsPath,
} from "nbook/server/runtime/paths/file-path";
import {resolveProjectWorkspaceInput} from "nbook/server/workspace-files/project-path";

type VariableFile = {
    schemaVersion: 1;
    variables: Record<string, JsonValue>;
};

type VariableFileLocation = Readonly<{
    root: AbsoluteFsPath;
    path: AbsoluteFsPath;
}>;

const locks = new Map<string, Promise<void>>();

/**
 * Workspace Root / Project Workspace 变量文件存储。
 */
export class VariableFileStorage {
    constructor(private readonly globalWorkspaceRoot: AbsoluteFsPath) {}

    /**
     * 读取 namespace 变量文件。缺失文件等价于空 variables。
     */
    async read(namespace: Extract<VariableNamespace, "global" | "project">, projectWorkspace?: string | null): Promise<Record<string, JsonValue>> {
        const location = this.fileLocation(namespace, projectWorkspace);
        await assertRealPathContained(location.root, location.path);
        const text = await readFile(location.path, "utf8").catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") {
                return null;
            }
            throw error;
        });
        if (!text) {
            return {};
        }
        const parsed = JSON.parse(text) as Partial<VariableFile>;
        if (parsed.schemaVersion !== 1 || !parsed.variables || typeof parsed.variables !== "object" || Array.isArray(parsed.variables)) {
            throw new Error(`变量文件格式非法：${location.path}`);
        }
        return parsed.variables;
    }

    /**
     * 对变量文件执行原子 patch。
     */
    async patch(namespace: Extract<VariableNamespace, "global" | "project">, variablePath: string, operations: VariableJsonPatchOperation[], projectWorkspace?: string | null, guard?: {
        expectedFingerprint?: string;
        fingerprintValue?: (value: JsonValue | undefined) => string;
        expectedValue?: JsonValue;
    }): Promise<JsonValue | undefined> {
        const location = this.fileLocation(namespace, projectWorkspace);
        await withFileLock(location.path, async () => {
            const variables = await this.read(namespace, projectWorkspace);
            const current = readDotPath(variables, variablePath);
            const comparableCurrent = current === undefined ? guard?.expectedValue : current;
            if (guard?.expectedFingerprint && guard.fingerprintValue && guard.fingerprintValue(comparableCurrent) !== guard.expectedFingerprint) {
                throw new Error(`变量 ${namespace}.${variablePath} 在上次读取后已经变化，请重新调用 variable_read 后再 patch。`);
            }
            const next = applyVariableJsonPatch(current, operations);
            writeDotPath(variables, variablePath, next);
            await writeVariableFile(location, {
                schemaVersion: 1,
                variables,
            });
        });
        const variables = await this.read(namespace, projectWorkspace);
        return readDotPath(variables, variablePath);
    }

    private fileLocation(namespace: Extract<VariableNamespace, "global" | "project">, projectWorkspace?: string | null): VariableFileLocation {
        if (namespace === "global") {
            return {
                root: this.globalWorkspaceRoot,
                path: resolveContainedFilePath(this.globalWorkspaceRoot, ".nbook/agent/variables.json"),
            };
        }
        if (!projectWorkspace) {
            throw new Error("project.* 变量需要本轮 client.currentProjectWorkspace。");
        }
        const projectRoot = resolveProjectWorkspaceInput(this.globalWorkspaceRoot, projectWorkspace);
        return {
            root: projectRoot,
            path: resolveContainedFilePath(projectRoot, ".nbook/agent/variables.json"),
        };
    }
}

export function readDotPath(value: Record<string, JsonValue>, path: string): JsonValue | undefined {
    const segments = path.split(".").filter(Boolean);
    let current: JsonValue | Record<string, JsonValue> | undefined = value;
    for (const segment of segments) {
        if (!current || typeof current !== "object" || Array.isArray(current) || !(segment in current)) {
            return undefined;
        }
        current = current[segment];
    }
    return current as JsonValue;
}

export function writeDotPath(value: Record<string, JsonValue>, path: string, next: JsonValue): void {
    const segments = path.split(".").filter(Boolean);
    let current: Record<string, JsonValue> = value;
    for (const segment of segments.slice(0, -1)) {
        const child = current[segment];
        if (!child || typeof child !== "object" || Array.isArray(child)) {
            current[segment] = {};
        }
        current = current[segment] as Record<string, JsonValue>;
    }
    const leaf = segments.at(-1);
    if (!leaf) {
        throw new Error("变量 path 不能为空。");
    }
    current[leaf] = next;
}

async function writeVariableFile(location: VariableFileLocation, file: VariableFile): Promise<void> {
    await assertRealPathContained(location.root, location.path);
    await mkdir(dirname(location.path), {recursive: true});
    const tempPath = `${location.path}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    await rename(tempPath, location.path);
}

async function withFileLock(path: string, action: () => Promise<void>): Promise<void> {
    const previous = locks.get(path) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolveLock) => {
        release = resolveLock;
    });
    const tail = previous.then(() => current);
    locks.set(path, tail);
    try {
        await previous;
        await action();
    } finally {
        release();
        if (locks.get(path) === tail) {
            locks.delete(path);
        }
    }
}

/** 测试专用：确认已完成的变量文件队列不会永久滞留。 */
export function pendingVariableFileLockCountForTest(): number {
    return locks.size;
}
