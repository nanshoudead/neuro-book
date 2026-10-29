/**
 * 组件文档的 `state:inject` 标签检查（docs/standards/code/components.md 的“能力标签”）：由 `governance:check` 调用，也可以单独运行。
 * 组件经 provide/inject 取宿主注入的翻译端口是一条隐藏通道，调用方从属性上看不出它，同名 `.md` 的 frontmatter「标签」要写
 * `state:inject`。漏写时没有运行期症状（没有宿主时取到缺省端口、显示键名），只能靠这里机检。
 *
 * 认作“取翻译端口”的写法（在 `.vue` 去掉注释之后的源码里找）：
 * - `useText(`、`useUiText(` 与插件或包的 `useXxxText(`（`use` 开头、`Text` 结尾的函数调用）；
 * - `inject(TEXT_PORT_KEY`；
 * - 共享包根组件的 `provideFormText(`、`provideAgentText(`、`provideMarkdownText(`（nb-form、nb-agent-ui、nb-markdown）：它们先读注入的
 *   端口，没有时才自己建。Lab 夹具的 `provideXxxText(` 只建端口、provide 给子树，不读注入，所以不认通配的 `provide…Text(`。
 * 别的 provide/inject（服务、状态）不在这里查，仍按规范靠评审核对。
 *
 * 只查有同名 `.md` 的组件：没有文档的组件是否该有文档由 `docs:check`（受管组件）与评审管，这里不重复报。文档没有 frontmatter
 * 或「标签」不是数组时也报一条，因为这样就无从写下 `state:inject`。只读的旧应用、归档文档与 `.agents/` 不查。
 */

import {readFileSync} from "node:fs";
import {join} from "node:path";

import {parse as parseYaml} from "yaml";

import {git} from "#scripts/ci/agent-governance-contract";
import {readChangeScopeArguments} from "#scripts/ci/change-scope";

const SKIPPED_ROOTS: readonly string[] = ["packages/neuro-book-legacy/", "docs/archived/", ".agents/"];

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;

/** 取翻译端口的写法，见文件头。 */
const TEXT_PORT_PATTERN = /\buse[A-Za-z]*Text\s*\(|\binject\s*\(\s*TEXT_PORT_KEY\b|\bprovide(?:Form|Agent|Markdown)Text\s*\(/u;

/**
 * 去掉注释：块注释、HTML 注释与行注释。行注释只认行首或空白之后的 `//`，免得把字符串里的 URL（`https://…`）后半截当成注释；
 * 字符串里恰好有 ` //` 的那一行后半截会被忽略，对“有没有这种调用”的判断影响可以忽略。
 */
function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/<!--[\s\S]*?-->/gu, "").replace(/(^|\s)\/\/.*$/gmu, "$1");
}

/** 组件源码里第一处取翻译端口的写法；没有时为 null。 */
export function textPortUse(source: string): string | null {
    return TEXT_PORT_PATTERN.exec(withoutComments(source))?.[0].replace(/\s+/gu, "") ?? null;
}

/** 文档 frontmatter 的「标签」；没有 frontmatter、解析不了或不是字符串数组时为 null。 */
function tagsOf(document: string): ReadonlyArray<string> | null {
    const frontmatter = FRONTMATTER_PATTERN.exec(document)?.[1];
    if (frontmatter === undefined) return null;
    let metadata: unknown;
    try {
        metadata = parseYaml(frontmatter);
    } catch {
        return null;
    }
    const tags = metadata !== null && typeof metadata === "object" && "标签" in metadata ? (metadata as {标签: unknown}).标签 : undefined;
    return Array.isArray(tags) && tags.every((tag) => typeof tag === "string") ? tags as string[] : null;
}

/** 仓库里取翻译端口却没在同名文档里标 `state:inject` 的组件；空表示通过。 */
export function componentInjectFailures(repoRoot: string): string[] {
    const files = git(repoRoot, ["ls-files", "--cached", "--others", "--exclude-standard"]).split("\n").filter((path) => path !== "" && !SKIPPED_ROOTS.some((root) => path.startsWith(root)));
    const present = new Set(files);
    const failures: string[] = [];
    for (const component of files.filter((path) => path.startsWith("packages/") && path.endsWith(".vue")).sort()) {
        const document = `${component.slice(0, -".vue".length)}.md`;
        if (!present.has(document)) continue;
        let source: string;
        try {
            source = readFileSync(join(repoRoot, component), "utf8");
        } catch {
            // 列在 Git 里但工作区已删的文件：没有可查的源码。
            continue;
        }
        const use = textPortUse(source);
        if (use === null) continue;
        const tags = tagsOf(readFileSync(join(repoRoot, document), "utf8"));
        if (tags === null) failures.push(`${document}：${component} 经 ${use}…) 取注入的翻译端口，文档要有 frontmatter 的「标签」数组并含 state:inject`);
        else if (!tags.includes("state:inject")) failures.push(`${document}：${component} 经 ${use}…) 取注入的翻译端口，「标签」要含 state:inject`);
    }
    return failures;
}

// 单独运行：`bun scripts/ci/component-inject-tags.ts [--repo-root <目录>]`，有问题时逐条打印并以 1 退出。
if (import.meta.main) {
    const {repoRoot} = readChangeScopeArguments(import.meta.url);
    const failures = componentInjectFailures(repoRoot);
    for (const failure of failures) console.error(failure);
    if (failures.length > 0) process.exitCode = 1;
}
