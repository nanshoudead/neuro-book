#!/usr/bin/env bun
/**
 * 把发布清单里的包发到 npm（`bun run release:publish`，ADR 0029）。缺省只做检查并列出要发的包；带 `--yes` 才发布，
 * 由开发者在 `npm login` 之后执行（远端写入要开发者授权，见 docs/standards/repository-workflow.md 的“发布授权”）。
 *
 * 发出去的版本号不能再用，所以先过门禁，任何一条失败都在发布前停下：会发布的目录（9 个包与根 LICENSE）没有
 * 未提交的改动或未跟踪的文件、在 master 上、发布清单检查、9 个包的 typecheck、`release:smoke`。只看会发布的目录，
 * 是因为主工作区常有别的会话的改动，它们不进包。单测与 e2e 不在这里重跑，它们是合入 master 的门禁。
 *
 * 中途失败就停，打印已发与没发的包；再跑一次会跳过已经在 registry 上的版本，所以可以接着发。
 */

import {join} from "node:path";
import {fileURLToPath} from "node:url";

import {checkReleasePackages, loadReleasePackages, publishOrder, type ReleasePackage} from "#scripts/release/packages";

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

async function gates(packages: readonly ReleasePackage[]): Promise<void> {
    const published = ["LICENSE", ...packages.map((entry) => join("packages", entry.dir))];
    const status = await run(["git", "status", "--porcelain", "--untracked-files=all", "--", ...published], REPOSITORY);
    if (status.code !== 0 || status.stdout.trim() !== "") throw new GateFailure(`会发布的目录里有未提交的改动或未跟踪的文件，先提交或清掉：\n${status.stdout || status.stderr}`);
    const branch = (await run(["git", "rev-parse", "--abbrev-ref", "HEAD"], REPOSITORY)).stdout.trim();
    if (branch !== RELEASE_BRANCH) throw new GateFailure(`要在 ${RELEASE_BRANCH} 上发布，现在是 ${branch}`);
    console.log(`✓ 会发布的目录没有未提交的改动，在 ${RELEASE_BRANCH} 上`);

    const findings = checkReleasePackages(REPOSITORY, packages);
    if (findings.length > 0) throw new GateFailure(`发布清单检查失败：\n${findings.map((finding) => `${finding.package} [${finding.code}] ${finding.message}`).join("\n")}`);
    console.log("✓ 发布清单检查");

    for (const entry of packages) {
        const result = await run(["bun", "run", "typecheck"], entry.path);
        if (result.code !== 0) throw new GateFailure(`${entry.manifest.name} 的 typecheck 失败：\n${result.stdout}${result.stderr}`);
    }
    console.log(`✓ ${packages.length} 个包的 typecheck`);

    const smoke = await run(["bun", join(REPOSITORY, "scripts", "release", "pack-smoke.ts")], REPOSITORY, true);
    if (smoke.code !== 0) throw new GateFailure("release:smoke 失败（输出见上）");
}

async function main(): Promise<number> {
    const options = parsePublishArguments(Bun.argv.slice(2));
    const packages = publishOrder(loadReleasePackages(REPOSITORY));
    await gates(packages);

    const whoami = await run(["npm", "whoami"], REPOSITORY);
    if (whoami.code !== 0) throw new GateFailure("npm 没有登录：先运行 npm login，再重跑本命令");
    console.log(`✓ npm 已登录：${whoami.stdout.trim()}`);

    const pending: ReleasePackage[] = [];
    for (const entry of packages) {
        const {name, version} = entry.manifest;
        const state = publishedState(await run(["npm", "view", `${name}@${version}`, "version", "--json"], REPOSITORY));
        console.log(`  ${state === "published" ? "已发布，跳过" : "要发布"}  ${name}@${version}`);
        if (state === "unpublished") pending.push(entry);
    }
    if (pending.length === 0) {
        console.log("全部版本都已在 registry 上，没有要发的");
        return 0;
    }
    if (!options.yes) {
        console.log(`要发 ${pending.length} 个包；确认后带 --yes 重跑（开了两步验证时加 --auth-type web，或 --otp <码>）`);
        return 0;
    }

    const done: string[] = [];
    for (const entry of pending) {
        const label = `${entry.manifest.name}@${entry.manifest.version}`;
        const result = await run(["bun", "publish", "--access", "public", ...options.publishArgs], entry.path, true);
        if (result.code !== 0) {
            const rest = pending.slice(done.length).map((item) => `${item.manifest.name}@${item.manifest.version}`);
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
