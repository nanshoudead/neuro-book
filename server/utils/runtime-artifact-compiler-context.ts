import {existsSync, readFileSync} from "node:fs";
import {join, resolve} from "node:path";

/** Runtime artifact 编译时使用的唯一源码与依赖上下文。 */
export type RuntimeArtifactCompilerContext = Readonly<{
    root: string;
    productRuntime: boolean;
    nbookRoot: string;
    nodeModulesRoot: string;
    packageRequireRoot: string;
    tsconfigPath: string;
}>;

/**
 * 解析 Profile、Variable 等 Runtime artifact 的编译上下文。
 *
 * Source 开发直接使用 checkout；Product 必须完全绑定 `.output/server`，禁止
 * freshness manifest 记录最终安装包中不存在的根 `node_modules` 或生成源码。
 */
export function resolveRuntimeArtifactCompilerContext(
    root = process.cwd(),
    env: NodeJS.ProcessEnv = process.env,
): RuntimeArtifactCompilerContext {
    const absoluteRoot = resolve(root);
    const outputRoot = resolve(absoluteRoot, ".output", "server");
    const outputEntry = resolve(outputRoot, "index.mjs");
    const rootPackage = resolve(absoluteRoot, "package.json");
    const outputPackage = resolve(outputRoot, "package.json");
    const productRuntime = existsSync(outputEntry) && (
        packageManifestName(rootPackage) === "neuro-book-product"
        || packageManifestName(outputPackage) === "neuro-book-output"
            && (env.NEURO_BOOK_PRODUCT_BUILD === "1" || !existsSync(resolve(absoluteRoot, "node_modules")))
    );

    if (!productRuntime) {
        return Object.freeze({
            root: absoluteRoot,
            productRuntime: false,
            nbookRoot: absoluteRoot,
            nodeModulesRoot: resolve(absoluteRoot, "node_modules"),
            packageRequireRoot: rootPackage,
            tsconfigPath: resolve(absoluteRoot, "tsconfig.json"),
        });
    }

    const tsconfigPath = resolve(outputRoot, "tsconfig.json");
    if (!existsSync(tsconfigPath)) {
        throw new Error(`Product runtime 缺少 artifact 编译 tsconfig：${tsconfigPath}`);
    }
    return Object.freeze({
        root: absoluteRoot,
        productRuntime: true,
        nbookRoot: resolve(outputRoot, "node_modules", "nbook"),
        nodeModulesRoot: resolve(outputRoot, "node_modules"),
        packageRequireRoot: outputEntry,
        tsconfigPath,
    });
}

/** 从当前编译上下文解析 `nbook/*` 包级源码。 */
export function resolveRuntimeArtifactNbookPath(
    context: RuntimeArtifactCompilerContext,
    relativePath: string,
): string {
    const basePath = resolve(context.nbookRoot, relativePath);
    const candidates = [
        join(basePath, "index.ts"),
        join(basePath, "index.tsx"),
        join(basePath, "index.js"),
        join(basePath, "index.mjs"),
        `${basePath}.ts`,
        `${basePath}.tsx`,
        `${basePath}.js`,
        `${basePath}.mjs`,
        basePath,
    ];
    const resolvedPath = candidates.find((candidate) => existsSync(candidate));
    if (!resolvedPath) {
        const source = context.productRuntime ? "Product .output/server/node_modules/nbook" : "Source checkout";
        throw new Error(`${source} 无法解析 nbook 包级 import：${relativePath}`);
    }
    return resolvedPath;
}

/** 读取 package name；损坏或缺失时返回 null。 */
function packageManifestName(path: string): string | null {
    try {
        const manifest = JSON.parse(readFileSync(path, "utf8")) as {name?: string};
        return typeof manifest.name === "string" ? manifest.name : null;
    } catch {
        return null;
    }
}
