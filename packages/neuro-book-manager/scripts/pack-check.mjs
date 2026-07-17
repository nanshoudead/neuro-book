import {mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const temporaryRoot = await mkdtemp(join(tmpdir(), "neuro-book-manager-pack-"));

try {
    await run(["bun", "pm", "pack", "--destination", temporaryRoot], packageRoot);
    const archiveName = (await readdir(temporaryRoot)).find((name) => name.endsWith(".tgz"));
    if (!archiveName) throw new Error("bun pm pack 没有生成 tgz。" );
    const archive = join(temporaryRoot, archiveName);
    await writeFile(join(temporaryRoot, "package.json"), "{\"private\":true}\n", "utf8");
    await run(["bun", "add", archive, "--cwd", temporaryRoot], temporaryRoot);
    const packageJson = JSON.parse(await readFile(join(temporaryRoot, "node_modules", "@notnotype", "neuro-book-manager", "package.json"), "utf8"));
    const forbidden = ["nuxt", "vue", "prisma", "@tiptap/core"];
    for (const name of forbidden) {
        if (packageJson.dependencies?.[name] || packageJson.devDependencies?.[name]) {
            throw new Error(`Manager npm 包错误包含应用依赖：${name}`);
        }
    }
    const managerVersion = await runCapture([
        "bun",
        join(temporaryRoot, "node_modules", "@notnotype", "neuro-book-manager", "dist", "neuro-book.mjs"),
        "--version",
    ], temporaryRoot);
    if (managerVersion.trim() !== packageJson.version) {
        throw new Error(`Manager --version输出错误：${managerVersion.trim()}`);
    }
    await run([
        "bun",
        join(temporaryRoot, "node_modules", "@notnotype", "neuro-book-manager", "dist", "neuro-book.mjs"),
        "status",
        "--help",
    ], temporaryRoot);
    await run([
        "bun",
        join(temporaryRoot, "node_modules", "@notnotype", "neuro-book-manager", "dist", "neuro-book.mjs"),
        "instances",
        "config",
    ], temporaryRoot, {
        ...process.env,
        NEURO_BOOK_MANAGER_CONFIG: join(temporaryRoot, "manager-home", "config.json"),
    });
    const installPlanOutput = await runCapture([
        "bun",
        join(temporaryRoot, "node_modules", "@notnotype", "neuro-book-manager", "dist", "neuro-book.mjs"),
        "install",
        "--profile",
        "ghcr",
        "--dir",
        join(temporaryRoot, "dry-run-instance"),
        "--version",
        "0.8.2-canary.cli-route",
        "--yes",
        "--dry-run",
    ], temporaryRoot, {
        ...process.env,
        NEURO_BOOK_MANAGER_CONFIG: join(temporaryRoot, "manager-home", "config.json"),
    });
    const installPlan = JSON.parse(installPlanOutput);
    if (installPlan.action !== "install" || installPlan.profile !== "ghcr") {
        throw new Error("install --version被顶层Manager版本选项截获。" );
    }
} finally {
    await rm(temporaryRoot, {recursive: true, force: true});
}

async function run(command, cwd, env = process.env) {
    const child = Bun.spawn(command, {cwd, env, stdout: "inherit", stderr: "inherit"});
    const exitCode = await child.exited;
    if (exitCode !== 0) throw new Error(`${command.join(" ")} 退出码 ${exitCode}`);
}

/** 执行真实packed CLI并返回标准输出，用于验证Commander参数路由。 */
async function runCapture(command, cwd, env = process.env) {
    const child = Bun.spawn(command, {cwd, env, stdout: "pipe", stderr: "pipe"});
    const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ]);
    if (exitCode !== 0) throw new Error(`${command.join(" ")} 退出码 ${exitCode}：${stderr || stdout}`);
    return stdout;
}
