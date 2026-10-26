import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {mkdir, mkdtemp, readdir, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, relative, resolve} from "node:path";
import {NbdevError} from "../core/errors.js";
import {AGENT_LOCAL_ROOT} from "../core/registry.js";
import type {RepoContext} from "../core/repo.js";
import {listRuns, readPackageScripts, resolveDevTarget, reusable, urlReady} from "./dev-ops.js";

/**
 * `nbdev shot`（t14）：只做薄包装，把三件事交给目标 checkout 自己的 `lab:shot`（带 `--page <路径>` 时是 `page:shot`，t18）：
 * - 地址：`--url`，没有就取这个 checkout 上能复用（组长还在）、已就绪、地址此刻连得上的服务的地址（判据同 `dev start` 的复用）；
 * - 输出目录：`.local/agent/works/<W>/tasks/<T>/shots/<UTC 时间>/`，不带 Task 时是 `.local/agent/shots/<UTC 时间>/`；
 * - `TMPDIR`：指到 `/dev/shm/nbdev-shot-<随机>`，跑完删掉。`/tmp` 是带配额的内存盘，Chrome 的临时数据曾把它占满、浏览器崩溃。
 * 不注入浏览器路径：两种 `lab:shot` 缺省用 `channel: "chrome"`（t14 设计审查 S10）。截图逻辑全在包脚本里，这里不另写：
 * 页面怎样算就绪只有应用自己知道，`--page` 只把路径作 `--path` 交给 `page:shot`。
 */

export type ShotInput = {checkoutRef: string | null; packageDir: string; url: string | null; page: string | null; task: {workId: string; taskId: string} | null; passthrough: string[]};
export type ShotResult = {url: string; outDir: string; files: string[]; exitCode: number};

const SHM = "/dev/shm";

async function listFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, {recursive: true, withFileTypes: true});
    return entries.filter((entry) => entry.isFile()).map((entry) => relative(dir, join(entry.parentPath, entry.name))).sort();
}

export async function runShot(context: RepoContext, cwd: string, input: ShotInput, env: NodeJS.ProcessEnv): Promise<ShotResult> {
    const target = await resolveDevTarget(context, input.checkoutRef, input.packageDir, "dev", cwd);
    const packageRoot = join(target.checkout.root, target.packageDir);
    const scripts = await readPackageScripts(packageRoot);
    const script = input.page === null ? "lab:shot" : "page:shot";
    if (typeof scripts[script] !== "string") throw new NbdevError("shot_unavailable", `${packageRoot}/package.json 里没有 ${script}`, {details: {package: packageRoot, script}});
    let url = input.url;
    if (url === null) {
        const {runs} = await listRuns(context.mainRoot);
        const ready = runs.filter((run) => run.checkout === target.checkout.root && reusable(run) && run.url && run.readyAt).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        for (const run of ready) {
            if (!await urlReady(run.url!)) continue;
            url = run.url;
            break;
        }
    }
    if (url === null) throw new NbdevError("dev_not_running", `${target.key} 上没有经 nbdev 起、已就绪且地址连得上的开发服务：先 nbdev dev start，或用 --url 指定`, {details: {checkout: target.checkout.root}});
    const stamp = new Date().toISOString().replace(/[-:]/gu, "").replace(/\.\d+Z$/u, "Z");
    const outDir = input.task
        ? resolve(context.mainRoot, AGENT_LOCAL_ROOT, "works", input.task.workId, "tasks", input.task.taskId, "shots", stamp)
        : resolve(context.mainRoot, AGENT_LOCAL_ROOT, "shots", stamp);
    await mkdir(outDir, {recursive: true});
    const scratch = await mkdtemp(join(existsSync(SHM) ? SHM : tmpdir(), "nbdev-shot-"));
    try {
        const wrapped = input.page === null ? ["--url", url, "--out", outDir] : ["--url", url, "--path", input.page, "--out", outDir];
        const child = spawn(process.execPath, ["run", script, "--", ...wrapped, ...input.passthrough], {cwd: packageRoot, env: {...env, TMPDIR: scratch}, stdio: ["ignore", "pipe", "pipe"]});
        let stderr = "";
        child.stdout!.resume();
        child.stderr!.on("data", (chunk: Buffer) => {
            stderr = (stderr + chunk.toString("utf8")).slice(-4_000);
        });
        const exitCode = await new Promise<number>((done, fail) => {
            child.on("error", fail);
            child.on("close", (code, signal) => done(code ?? (signal ? 128 : 1)));
        });
        const files = await listFiles(outDir);
        if (exitCode !== 0) throw new NbdevError("shot_failed", `${script} 以 ${exitCode} 退出：${stderr.trim().split("\n").slice(-10).join("\n")}`, {details: {exitCode, outDir, files}});
        return {url, outDir, files, exitCode};
    } finally {
        await rm(scratch, {recursive: true, force: true});
    }
}
