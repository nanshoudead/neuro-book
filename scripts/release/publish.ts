#!/usr/bin/env bun
/**
 * 把发布清单里的包发到 npm（`bun run release:publish`，ADR 0029、0033）。缺省只做检查并列出要发的包；带 `--yes` 才发布，
 * 由开发者在 `npm login` 之后执行（远端写入要开发者授权，见 docs/standards/repository-workflow.md 的“发布授权”）。
 *
 * 发的是 `release:smoke` 打好、验过的 tarball（`dist/release/`），不在这里重新打包：发出去的字节就是冒烟验过的那份。
 * 发出去的版本号不能再用，所以先过门禁，任何一条失败都在发布前停下：会发布的目录（源码包、生成包的源码目录与根
 * LICENSE）没有未提交的改动或未跟踪的文件、在 master 上、冒烟用的提交已推到 origin/master（README 里的图片用 GitHub 上的地址）、
 * 冒烟以来会发布的目录没改过（`release-manifest.json` 的提交与 HEAD 比，别的目录的提交不算）且每个 tarball 的 SHA-256 对得上、源码包的发布清单检查、要发的包的 typecheck。只看
 * 会发布的目录，是因为主工作区常有别的会话的改动，它们不进包。单测与 e2e 不在这里重跑，它们是合入 master 的门禁。
 *
 * 中途失败就停，打印已发与没发的包；再跑一次会跳过已经在 registry 上的版本，所以可以接着发。
 */

import {existsSync} from "node:fs";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

import {integrityOf, RELEASE_DIRECTORY, RELEASE_MANIFEST, releaseFilesChangedSince, sha256Of, type ReleaseManifest} from "#scripts/release/manifest";
import {BUILT_PACKAGES, checkReleasePackages, loadBuiltPackages, loadReleasePackages, releaseDirectories, type ReleasePackage} from "#scripts/release/packages";

// 不用 import.meta.dir：测试在 Node 里导入本文件。
const REPOSITORY = fileURLToPath(new URL("../../", import.meta.url));
const RELEASE_BRANCH = "master";

export type PublishedState = "published" | "unpublished";

/**
 * 读 `npm view <名>@<版本> version --json` 的结果。只有 registry 明确回答“没有”（`E404`，包或版本不存在）才算没发布；
 * 网络、权限、5xx 等其它失败都抛出，不能当成“可以发”。
 */
export function publishedState(result: {code: number; stdout: string}): PublishedState {
    const text = result.stdout.trim();
    if (result.code === 0) {
        if (text === "") throw new Error("npm view 成功退出但没有输出，分不清这个版本发没发过");
        return "published";
    }
    let code: unknown;
    try {
        code = (JSON.parse(text) as {error?: {code?: unknown}}).error?.code;
    } catch {
        throw new Error(`npm view 失败（退出码 ${result.code}），输出不是 JSON：${text || "（空）"}`);
    }
    if (code === "E404") return "unpublished";
    throw new Error(`npm view 失败（${String(code ?? `退出码 ${result.code}`)}）：${text}`);
}

type Options = {yes: boolean; publishArgs: string[]};

export function parsePublishArguments(argv: readonly string[]): Options {
    const options: Options = {yes: false, publishArgs: []};
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index] as string;
        const value = argv[index + 1];
        if (argument === "--yes") options.yes = true;
        else if ((argument === "--otp" || argument === "--auth-type") && value !== undefined) {
            if (argument === "--auth-type" && value !== "web" && value !== "legacy") throw new UsageError(`--auth-type 只能是 web 或 legacy：${value}`);
            options.publishArgs.push(`${argument}=${value}`);
            index += 1;
        } else throw new UsageError(`未知参数或缺少值：${argument}（用法：release:publish [--yes] [--otp <码>] [--auth-type web|legacy]）`);
    }
    return options;
}

class UsageError extends Error {}
class GateFailure extends Error {}

async function run(argv: readonly string[], cwd: string, inherit = false): Promise<{code: number; stdout: string; stderr: string}> {
    const child = Bun.spawn([...argv], {cwd, stdin: inherit ? "inherit" : "ignore", stdout: inherit ? "inherit" : "pipe", stderr: inherit ? "inherit" : "pipe"});
    const [stdout, stderr, code] = await Promise.all([
        inherit ? Promise.resolve("") : new Response(child.stdout as ReadableStream).text(),
        inherit ? Promise.resolve("") : new Response(child.stderr as ReadableStream).text(),
        child.exited,
    ]);
    return {code, stdout, stderr};
}

/**
 * 清单与当前代码、磁盘上的 tarball 对不对得上；返回问题列表，空表示通过。`changedSinceSmoke` 是冒烟的提交以来会发布的目录
 * 改过的文件（master 被几个会话共用，别处的提交不算）；`digests` 是按 tarball 文件名算出的 SHA-256，文件不在时没有这一项。
 */
export function releaseManifestProblems(manifest: ReleaseManifest, changedSinceSmoke: readonly string[], digests: ReadonlyMap<string, string>): string[] {
    const problems: string[] = [];
    if (changedSinceSmoke.length > 0) problems.push(`冒烟（${manifest.commit.slice(0, 12)}）之后会发布的目录又改过：${changedSinceSmoke.slice(0, 5).join("、")}；重跑 bun run release:smoke`);
    for (const entry of manifest.packages) {
        const actual = digests.get(entry.tarball);
        if (actual === undefined) problems.push(`${entry.name}@${entry.version} 的 ${entry.tarball} 不在 dist/release/ 里：重跑 bun run release:smoke`);
        else if (actual !== entry.sha256) problems.push(`${entry.tarball} 在冒烟之后被改过（SHA-256 对不上）：重跑 bun run release:smoke`);
    }
    return problems;
}

/**
 * 已发的版本里与这次验过的字节不同、又被要发的包（直接或间接）依赖的：用户装上要发的包时会配上 registry 上那份没验过的，
 * 这时不能发。没人依赖的只是“源码改了没提版本”，提醒即可（例如应用与 SDK 把依赖打进了 bundle，不依赖任何源码包）。
 */
export function blockingStalePackages(pending: readonly string[], stale: readonly string[], dependenciesOf: ReadonlyMap<string, readonly string[]>): string[] {
    const reached = new Set<string>();
    const queue = [...pending];
    for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
        for (const dependency of dependenciesOf.get(name) ?? []) {
            if (reached.has(dependency)) continue;
            reached.add(dependency);
            queue.push(dependency);
        }
    }
    return stale.filter((name) => reached.has(name));
}

function runtimeDependencies(entry: ReleasePackage): string[] {
    return [...Object.keys(entry.manifest.dependencies ?? {}), ...Object.keys(entry.manifest.peerDependencies ?? {})];
}

async function gates(): Promise<ReleaseManifest> {
    const sources = loadReleasePackages(REPOSITORY);
    const status = await run(["git", "status", "--porcelain", "--untracked-files=all", "--", ...releaseDirectories()], REPOSITORY);
    if (status.code !== 0 || status.stdout.trim() !== "") throw new GateFailure(`会发布的目录里有未提交的改动或未跟踪的文件，先提交或清掉：\n${status.stdout || status.stderr}`);
    const branch = (await run(["git", "rev-parse", "--abbrev-ref", "HEAD"], REPOSITORY)).stdout.trim();
    if (branch !== RELEASE_BRANCH) throw new GateFailure(`要在 ${RELEASE_BRANCH} 上发布，现在是 ${branch}`);
    console.log(`✓ 会发布的目录没有未提交的改动，在 ${RELEASE_BRANCH} 上`);

    let manifest: ReleaseManifest;
    try {
        manifest = JSON.parse(await readFile(RELEASE_MANIFEST, "utf8")) as ReleaseManifest;
    } catch {
        throw new GateFailure("dist/release/release-manifest.json 读不到：先跑 bun run release:smoke（它生成并验过要发的 tarball）");
    }
    // README 的图片用 GitHub 上的地址：冒烟用的那个提交要已经推上去。看的是它而不是 HEAD：master 被几个会话共用，
    // HEAD 上可能有别处还没推的提交，只要会发布的目录自冒烟以来没变（下面核对），推上去的就是要发的内容。
    const fetched = await run(["git", "fetch", "--quiet", "origin", RELEASE_BRANCH], REPOSITORY);
    if (fetched.code !== 0) throw new GateFailure(`取不到 origin/${RELEASE_BRANCH}：${fetched.stderr}`);
    if ((await run(["git", "merge-base", "--is-ancestor", manifest.commit, `origin/${RELEASE_BRANCH}`], REPOSITORY)).code !== 0) {
        throw new GateFailure(`冒烟用的提交 ${manifest.commit.slice(0, 12)} 还没推到 origin/${RELEASE_BRANCH}：先推送（README 的图片用 GitHub 上的地址，没推送时 npm 页面看不到）`);
    }
    console.log(`✓ 冒烟用的提交已在 origin/${RELEASE_BRANCH} 上`);

    let changed: string[];
    try {
        changed = releaseFilesChangedSince(manifest.commit, releaseDirectories());
    } catch (error) {
        throw new GateFailure(`${(error as Error).message}：重跑 bun run release:smoke`);
    }
    const digests = new Map<string, string>();
    for (const entry of manifest.packages) {
        const path = join(RELEASE_DIRECTORY, entry.tarball);
        if (existsSync(path)) digests.set(entry.tarball, await sha256Of(path));
    }
    const problems = releaseManifestProblems(manifest, changed, digests);
    if (problems.length > 0) throw new GateFailure(problems.join("\n"));
    console.log(`✓ ${manifest.packages.length} 个 tarball 冒烟之后没被改过，会发布的目录与冒烟时（${manifest.commit.slice(0, 12)}）相同`);

    const findings = checkReleasePackages(REPOSITORY, sources);
    if (findings.length > 0) throw new GateFailure(`发布清单检查失败：\n${findings.map((finding) => `${finding.package} [${finding.code}] ${finding.message}`).join("\n")}`);
    console.log("✓ 发布清单检查");
    return manifest;
}

/**
 * 要发的包所在源码目录的 typecheck。只查这次要发的：已在 registry 上的版本一个字节也不会发出去，它们的源码坏了
 * 归它们自己的 CI 与下一次提版本管，不拦这次发布。
 */
async function typecheckPending(pending: ReleaseManifest["packages"]): Promise<void> {
    const sources = new Map(loadReleasePackages(REPOSITORY).map((entry) => [entry.manifest.name, entry.path]));
    const built = new Map<string, string>(BUILT_PACKAGES.map((entry) => [entry.name, join(REPOSITORY, "packages", entry.source)]));
    const paths = [...new Set(pending.map((entry) => sources.get(entry.name) ?? built.get(entry.name)).filter((path): path is string => path !== undefined))];
    for (const path of paths) {
        const result = await run(["bun", "run", "typecheck"], path);
        if (result.code !== 0) throw new GateFailure(`${path} 的 typecheck 失败：\n${result.stdout}${result.stderr}`);
    }
    console.log(`✓ 要发的包的 typecheck（${paths.length} 个源码目录）`);
}

async function main(): Promise<number> {
    const options = parsePublishArguments(Bun.argv.slice(2));
    const manifest = await gates();
    const whoami = await run(["npm", "whoami"], REPOSITORY);
    if (whoami.code !== 0) throw new GateFailure("npm 没有登录：先运行 npm login，再重跑本命令");
    console.log(`✓ npm 已登录：${whoami.stdout.trim()}`);

    const pending: ReleaseManifest["packages"] = [];
    const differing: string[] = [];
    for (const entry of manifest.packages) {
        const state = publishedState(await run(["npm", "view", `${entry.name}@${entry.version}`, "version", "--json"], REPOSITORY));
        if (state === "unpublished") {
            console.log(`  要发布  ${entry.name}@${entry.version}`);
            pending.push(entry);
            continue;
        }
        // 已发的版本跳过；但它要是与这次验过的 tarball 字节不同（上次发了一半、之后又改了代码重跑冒烟），跳过就等于发出去的不是验过的那份。
        const published = (await run(["npm", "view", `${entry.name}@${entry.version}`, "dist.integrity"], REPOSITORY)).stdout.trim();
        const same = published === await integrityOf(join(RELEASE_DIRECTORY, entry.tarball));
        console.log(`  已发布，跳过  ${entry.name}@${entry.version}${same ? "" : "（registry 上的与这次验过的 tarball 不同）"}`);
        if (!same) differing.push(entry.name);
    }
    const dependenciesOf = new Map([...loadReleasePackages(REPOSITORY), ...loadBuiltPackages(REPOSITORY)].map((entry) => [entry.manifest.name, runtimeDependencies(entry)]));
    const blocking = blockingStalePackages(pending.map((entry) => entry.name), differing, dependenciesOf);
    if (blocking.length > 0) throw new GateFailure(`要发的包依赖这些已发的版本，而它们与这次验过的 tarball 不同：${blocking.join("、")}。版本号不能重发，提高它们的版本号再冒烟`);
    if (differing.length > 0) console.log(`  提醒：${differing.join("、")} 的源码自上次发布以来改过但没提版本号，这次不发它们；下次发布前提版本号`);
    if (pending.length === 0) {
        console.log("全部版本都已在 registry 上，没有要发的");
        return 0;
    }
    await typecheckPending(pending);
    if (!options.yes) {
        console.log(`要发 ${pending.length} 个包；确认后带 --yes 重跑（开了两步验证时加 --auth-type web，或 --otp <码>）`);
        return 0;
    }
    const done: string[] = [];
    for (const entry of pending) {
        const label = `${entry.name}@${entry.version}`;
        const result = await run(["bun", "publish", join(RELEASE_DIRECTORY, entry.tarball), "--access", "public", ...options.publishArgs], RELEASE_DIRECTORY, true);
        if (result.code !== 0) {
            const rest = pending.slice(done.length).map((item) => `${item.name}@${item.version}`);
            console.error(`发布 ${label} 失败（退出码 ${result.code}）。已发：${done.join("、") || "无"}；没发：${rest.join("、")}。处理后重跑本命令会跳过已发的。`);
            return 1;
        }
        done.push(label);
        console.log(`✓ 已发布 ${label}`);
    }
    console.log(`发布完成：${done.join("、")}。之后跑一次 bun run release:smoke -- --from registry 作为发布证据`);
    return 0;
}

if (import.meta.main) {
    try {
        process.exitCode = await main();
    } catch (error) {
        console.error(error instanceof GateFailure || error instanceof UsageError ? error.message : error);
        process.exitCode = error instanceof UsageError ? 2 : 1;
    }
}
