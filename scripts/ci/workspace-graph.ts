/**
 * workspace 包之间的依赖图：`test:affected` 按它把改动的包扩到依赖它们的包（CI 与本地同一套选包）。
 * 依赖关系取各包 `package.json` 的 `dependencies` 与 `devDependencies` 里指向其它 workspace 包的条目。
 */

import {existsSync, readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";

type PackageManifest = {
    name?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
};

/** 按包目录名索引的 workspace 依赖图。 */
export type DependencyGraph = {
    dirByName: ReadonlyMap<string, string>;
    consumersOf: ReadonlyMap<string, ReadonlySet<string>>;
};

/** 读 `packagesRoot` 下各包目录的 `package.json`，建出“谁依赖谁”的反向表。没有 `package.json` 的目录不算包。 */
export function workspaceDependencyGraph(packagesRoot: string): DependencyGraph {
    const manifestByDir = new Map<string, PackageManifest>();
    const dirByName = new Map<string, string>();
    for (const dirent of readdirSync(packagesRoot, {withFileTypes: true})) {
        if (!dirent.isDirectory()) continue;
        const manifestPath = join(packagesRoot, dirent.name, "package.json");
        if (!existsSync(manifestPath)) continue;
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
        manifestByDir.set(dirent.name, manifest);
        if (typeof manifest.name === "string") dirByName.set(manifest.name, dirent.name);
    }
    const consumersOf = new Map<string, Set<string>>();
    for (const [directory, manifest] of manifestByDir) {
        for (const dependency of Object.keys({...manifest.dependencies, ...manifest.devDependencies})) {
            const dependencyDir = dirByName.get(dependency);
            if (dependencyDir === undefined) continue;
            let consumers = consumersOf.get(dependencyDir);
            if (consumers === undefined) {
                consumers = new Set<string>();
                consumersOf.set(dependencyDir, consumers);
            }
            consumers.add(directory);
        }
    }
    return {dirByName, consumersOf};
}

/** 从直接改动的包出发，加入所有直接或间接依赖它们的包。 */
export function expandConsumerClosure(direct: ReadonlySet<string>, consumersOf: ReadonlyMap<string, ReadonlySet<string>>): Set<string> {
    const selected = new Set(direct);
    const pending = [...direct];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
        for (const consumer of consumersOf.get(next) ?? []) {
            if (selected.has(consumer)) continue;
            selected.add(consumer);
            pending.push(consumer);
        }
    }
    return selected;
}
