import {mkdir, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {afterEach, describe, expect, it} from "vitest";
import {
    resolveRuntimeArtifactCompilerContext,
    resolveRuntimeArtifactNbookPath,
} from "nbook/server/utils/runtime-artifact-compiler-context";

describe("runtime artifact compiler context", () => {
    const roots: string[] = [];

    afterEach(async () => {
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("Product build只使用.output内的tsconfig、nbook源码和node_modules", async () => {
        const root = resolve(".agent", "workspace", "artifact-context-test", randomUUID());
        roots.push(root);
        const outputRoot = join(root, ".output", "server");
        const outputNbookFile = join(outputRoot, "node_modules", "nbook", "server", "marker.ts");
        await mkdir(join(root, "node_modules"), {recursive: true});
        await mkdir(join(outputRoot, "node_modules", "nbook", "server"), {recursive: true});
        await writeFile(join(root, "package.json"), '{"name":"neuro-book"}\n', "utf8");
        await writeFile(join(root, "tsconfig.json"), "{}\n", "utf8");
        await writeFile(join(outputRoot, "package.json"), '{"name":"neuro-book-output"}\n', "utf8");
        await writeFile(join(outputRoot, "index.mjs"), "", "utf8");
        await writeFile(join(outputRoot, "tsconfig.json"), "{}\n", "utf8");
        await writeFile(outputNbookFile, "export const marker = true;\n", "utf8");

        const context = resolveRuntimeArtifactCompilerContext(root, {NEURO_BOOK_PRODUCT_BUILD: "1"});

        expect(context).toEqual(expect.objectContaining({
            productRuntime: true,
            nbookRoot: join(outputRoot, "node_modules", "nbook"),
            nodeModulesRoot: join(outputRoot, "node_modules"),
            packageRequireRoot: join(outputRoot, "index.mjs"),
            tsconfigPath: join(outputRoot, "tsconfig.json"),
        }));
        expect(resolveRuntimeArtifactNbookPath(context, "server/marker")).toBe(outputNbookFile);
    });

    it("Product缺少自包含tsconfig时拒绝回退Source根", async () => {
        const root = resolve(".agent", "workspace", "artifact-context-missing-test", randomUUID());
        roots.push(root);
        const outputRoot = join(root, ".output", "server");
        await mkdir(outputRoot, {recursive: true});
        await writeFile(join(root, "package.json"), '{"name":"neuro-book-product"}\n', "utf8");
        await writeFile(join(root, "tsconfig.json"), "{}\n", "utf8");
        await writeFile(join(outputRoot, "index.mjs"), "", "utf8");

        expect(() => resolveRuntimeArtifactCompilerContext(root)).toThrow("Product runtime 缺少 artifact 编译 tsconfig");
    });
});
