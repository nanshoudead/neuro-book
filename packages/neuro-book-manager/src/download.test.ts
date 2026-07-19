import {mkdtemp, readFile, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {strToU8, zipSync} from "fflate";
import {afterEach, describe, expect, it} from "vitest";

import {extractZip} from "#manager/download";

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true}))));

describe("Archive Extraction Adapter", () => {
    it("保留标准ZIP目录条目并解压其文件", async () => {
        const root = await fixtureRoot();
        const archive = join(root, "bun.zip");
        const target = join(root, "target");
        await writeFile(archive, zipSync({
            "bun-windows-x64/": new Uint8Array(),
            "bun-windows-x64/bun.exe": strToU8("bun-runtime"),
        }));

        await extractZip(archive, target);

        expect((await stat(join(target, "bun-windows-x64"))).isDirectory()).toBe(true);
        expect(await readFile(join(target, "bun-windows-x64", "bun.exe"), "utf8")).toBe("bun-runtime");
    });

    it("继续拒绝ZIP路径穿越", async () => {
        const root = await fixtureRoot();
        const archive = join(root, "unsafe.zip");
        const target = join(root, "target");
        await writeFile(archive, zipSync({"../outside.txt": strToU8("unsafe")}));

        await expect(extractZip(archive, target)).rejects.toThrow("Installation Root");
        await expect(stat(join(root, "outside.txt"))).rejects.toMatchObject({code: "ENOENT"});
    });
});

/** 创建每项测试独占的归档根。 */
async function fixtureRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "nbook-manager-download-"));
    roots.push(root);
    return root;
}
