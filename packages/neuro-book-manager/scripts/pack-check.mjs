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
    await run([
        "bun",
        join(temporaryRoot, "node_modules", "@notnotype", "neuro-book-manager", "dist", "neuro-book.mjs"),
        "--version",
    ], temporaryRoot);
} finally {
    await rm(temporaryRoot, {recursive: true, force: true});
}

async function run(command, cwd) {
    const process = Bun.spawn(command, {cwd, stdout: "inherit", stderr: "inherit"});
    const exitCode = await process.exited;
    if (exitCode !== 0) throw new Error(`${command.join(" ")} 退出码 ${exitCode}`);
}
