import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {afterAll, beforeAll, describe, expect, it} from "vitest";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {expandConsumerClosure, workspaceDependencyGraph} from "#scripts/ci/workspace-graph";

let packagesRoot = "";

async function writePackage(directory: string, manifest: object): Promise<void> {
    await mkdir(join(packagesRoot, directory), {recursive: true});
    await writeFile(join(packagesRoot, directory, "package.json"), JSON.stringify(manifest));
}

beforeAll(async () => {
    packagesRoot = join(await createTestTmpRoot("scripts", "workspace-graph"), "packages");
    // core ← ui（dependencies）← app（devDependencies）；tool 只依赖外部包；notes 目录没有 package.json。
    await writePackage("core", {name: "@x/core"});
    await writePackage("ui", {name: "@x/ui", dependencies: {"@x/core": "workspace:*", vue: "^3"}});
    await writePackage("app", {name: "@x/app", devDependencies: {"@x/ui": "workspace:*"}});
    await writePackage("tool", {name: "@x/tool", dependencies: {commander: "^14"}});
    await mkdir(join(packagesRoot, "notes"), {recursive: true});
});

afterAll(async () => {
    if (packagesRoot !== "") await rm(join(packagesRoot, ".."), {recursive: true, force: true});
});

describe("workspace 依赖图", () => {
    it("按两种依赖字段建反向表，外部包与没有 package.json 的目录不算", () => {
        const graph = workspaceDependencyGraph(packagesRoot);
        expect(Object.fromEntries([...graph.consumersOf].map(([dir, consumers]) => [dir, [...consumers].sort()]))).toEqual({core: ["ui"], ui: ["app"]});
        expect([...graph.dirByName.values()].sort()).toEqual(["app", "core", "tool", "ui"]);
    });

    it("改动的包扩到直接与间接依赖它的包", () => {
        const {consumersOf} = workspaceDependencyGraph(packagesRoot);
        expect([...expandConsumerClosure(new Set(["core"]), consumersOf)].sort()).toEqual(["app", "core", "ui"]);
        expect([...expandConsumerClosure(new Set(["tool"]), consumersOf)]).toEqual(["tool"]);
    });
});
