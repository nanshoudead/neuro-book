import {cp, mkdir, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";

import {afterAll, beforeAll, describe, expect, it} from "vitest";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {communityFileFailures} from "#scripts/ci/community-files";

const REPOSITORY = resolve(import.meta.dirname, "../..");
let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("scripts", "community-files");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 复制仓库的 `.github/labels.yml` 与表单到临时仓库根，再写入要改的文件。 */
async function repositoryWith(name: string, files: Record<string, string>): Promise<string> {
    const root = join(tmp, name);
    await mkdir(join(root, ".github"), {recursive: true});
    await cp(join(REPOSITORY, ".github/labels.yml"), join(root, ".github/labels.yml"));
    await cp(join(REPOSITORY, ".github/ISSUE_TEMPLATE"), join(root, ".github/ISSUE_TEMPLATE"), {recursive: true});
    for (const [path, text] of Object.entries(files)) await writeFile(join(root, path), text);
    return root;
}

describe("Issue 表单与标签", () => {
    it("仓库里的表单与标签通过", async () => {
        expect(await communityFileFailures(REPOSITORY)).toEqual([]);
    });

    it("表单引用了没登记的标签、YAML 写坏、缺 name：逐条报出", async () => {
        const root = await repositoryWith("broken", {
            ".github/ISSUE_TEMPLATE/05-extra.yml": "name: 额外\ndescription: d\nlabels: [\"type: nonexistent\"]\nbody: []\n",
            ".github/ISSUE_TEMPLATE/06-bad.yml": "name: [unclosed\n",
            ".github/ISSUE_TEMPLATE/07-nameless.yml": "description: d\nbody: []\n",
        });
        const failures = await communityFileFailures(root);
        expect(failures).toHaveLength(3);
        expect(failures[0]).toContain("type: nonexistent");
        expect(failures[1]).toContain("06-bad.yml 不是合法的 YAML");
        expect(failures[2]).toContain("07-nameless.yml 缺少 name");
    });
});
