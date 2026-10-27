/**
 * `.github/` 的 Issue 表单与标签：GitHub 读不懂的 YAML 会让表单从选单里消失，表单引用了没登记的标签时
 * 新 Issue 不会带上它，两种情况网页上都不报错。由 `governance:check` 调用，本地与 CI 同一个检查。
 */

import {existsSync} from "node:fs";
import {readdir, readFile} from "node:fs/promises";
import {join} from "node:path";

import {parse} from "yaml";

import {readLabelManifest} from "#scripts/ci/community-labels";

type IssueForm = {name?: unknown; description?: unknown; labels?: unknown};

/** 返回问题列表，空表示通过。 */
export async function communityFileFailures(repoRoot: string): Promise<string[]> {
    const directory = join(repoRoot, ".github/ISSUE_TEMPLATE");
    // 没有 Issue 表单的仓库（例如治理检查自己的测试搭的临时仓库）没有要查的。
    if (!existsSync(directory)) return [];
    const failures: string[] = [];
    let labels: ReadonlySet<string>;
    try {
        labels = new Set((await readLabelManifest(join(repoRoot, ".github/labels.yml"))).map((label) => label.name));
    } catch (error) {
        return [`.github/labels.yml：${error instanceof Error ? error.message : String(error)}`];
    }
    for (const name of (await readdir(directory)).filter((file) => file.endsWith(".yml")).sort()) {
        const path = `.github/ISSUE_TEMPLATE/${name}`;
        let form: IssueForm;
        try {
            form = (parse(await readFile(join(directory, name), "utf8")) ?? {}) as IssueForm;
        } catch (error) {
            failures.push(`${path} 不是合法的 YAML：${error instanceof Error ? error.message : String(error)}`);
            continue;
        }
        if (name === "config.yml") continue;
        if (typeof form.name !== "string" || typeof form.description !== "string") failures.push(`${path} 缺少 name 或 description`);
        for (const label of Array.isArray(form.labels) ? form.labels : []) {
            if (!labels.has(String(label))) failures.push(`${path} 引用了 .github/labels.yml 里没有的标签：${String(label)}`);
        }
    }
    return failures;
}
