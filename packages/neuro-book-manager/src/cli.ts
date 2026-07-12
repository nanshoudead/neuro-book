import {homedir} from "node:os";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import * as p from "@clack/prompts";
import {Command} from "commander";

import {createAdmin, startApplication} from "#manager/app-commands";
import {install, installPlan} from "#manager/installer";
import {doctor, installationStatus, maintainRuntime, maintainTool} from "#manager/maintenance";
import {readInstallationManifest} from "#manager/manifest-store";
import {discoverInstallationRoot, installationPaths} from "#manager/paths";
import {parseProfile, profileNames} from "#manager/profiles";
import type {ComponentId, InstallProfile, ReleaseChannel} from "#manager/types";
import {updateInstallation} from "#manager/updater";
import {MANAGER_VERSION} from "#manager/version-info";

const program = new Command()
    .name("neuro-book")
    .version(MANAGER_VERSION)
    .description("NeuroBook installation, runtime, toolchain and update manager.")
    .showHelpAfterError();

program.command("install")
    .description("安装或接管 NeuroBook Installation Root。")
    .option("--profile <profile>", `安装 Profile：${profileNames().join(", ")}`)
    .option("--dir <path>", "Installation Root。", join(homedir(), "neuro-book"))
    .option("--version <version>", "指定 NeuroBook Release 版本。")
    .option("--channel <channel>", "Release channel：stable 或 canary。", parseChannel, "stable")
    .option("--port <port>", "Web 端口。", parsePort, 3000)
    .option("--auth <mode>", "密码保护：enabled 或 disabled。Windows Portable 默认 disabled，其他 Profile 默认 enabled。", parseAuth)
    .option("--yes", "使用默认值，不进入交互。", false)
    .option("--dry-run", "只打印操作计划。", false)
    .action(async (options: {
        profile?: string;
        dir: string;
        version?: string;
        channel: ReleaseChannel;
        port: number;
        auth?: boolean;
        yes: boolean;
        dryRun: boolean;
    }) => {
        const profile = await resolveProfile(options.profile, options.yes);
        const input = {
            root: resolve(options.dir),
            profile,
            channel: options.channel,
            version: options.version,
            port: options.port,
            authEnabled: options.auth ?? profile !== "windows-portable",
            dryRun: options.dryRun,
            managerExecutable: fileURLToPath(import.meta.url),
        };
        if (options.dryRun) {
            printJson(installPlan(input));
            return;
        }
        p.intro("NeuroBook Manager");
        const manifest = await install(input);
        p.outro(`安装完成：${input.root}\nProfile: ${manifest.profile}\nVersion: ${manifest.appVersion}`);
    });

program.command("update")
    .description("事务更新当前安装。")
    .option("--component <components...>", "更新组件：source product runtime tools。", collectComponent, [])
    .option("--version <version>", "指定 NeuroBook Release 版本。")
    .option("--channel <channel>", "切换 Release channel。", parseChannel)
    .option("--dry-run", "只打印更新目标。", false)
    .action(async (options: {component?: ComponentId[]; version?: string; channel?: ReleaseChannel; dryRun: boolean}) => {
        const {root, manifest} = await currentInstallation();
        if (options.dryRun) {
            printJson({action: "update", root, profile: manifest.profile, components: options.component ?? "profile-default", version: options.version ?? "latest"});
            return;
        }
        const next = await updateInstallation({
            root,
            manifest,
            components: options.component?.length ? options.component : undefined,
            version: options.version,
            channel: options.channel,
            managerExecutable: fileURLToPath(import.meta.url),
        });
        p.outro(`更新完成：${next.appVersion}`);
    });

program.command("start")
    .description("启动当前安装。")
    .action(async () => {
        const {root, manifest} = await currentInstallation();
        await startApplication(root, manifest);
    });

program.command("status")
    .description("查看安装状态。")
    .option("--json", "输出 JSON。", false)
    .action(async (options: {json: boolean}) => {
        const {root, manifest} = await currentInstallation();
        const status = await installationStatus(root, manifest);
        options.json ? printJson(status) : printObject(status);
    });

program.command("doctor")
    .description("诊断安装目录、Product 与外部命令。")
    .option("--json", "输出 JSON。", false)
    .action(async (options: {json: boolean}) => {
        const {root, manifest} = await currentInstallation();
        const result = await doctor(root, manifest);
        options.json ? printJson(result) : printObject(result);
    });

const runtime = program.command("runtime").description("管理 Bun Runtime。");
runtime.command("list").action(async () => {
    const {manifest} = await currentInstallation();
    printJson({
        managerRuntime: manifest.components.managerRuntime,
        applicationRuntime: manifest.components.applicationRuntime,
    });
});
runtime.command("install")
    .argument("<runtime>", "当前只支持 bun。")
    .option("--version <version>")
    .action(async (runtimeName: string, options: {version?: string}) => {
        if (runtimeName !== "bun") throw new Error(`不支持的 Runtime：${runtimeName}`);
        const {root, manifest} = await currentInstallation();
        await maintainRuntime(root, manifest, fileURLToPath(import.meta.url), options.version);
    });
runtime.command("update")
    .argument("<runtime>", "当前只支持 bun。")
    .action(async (runtimeName: string) => {
        if (runtimeName !== "bun") throw new Error(`不支持的 Runtime：${runtimeName}`);
        const {root, manifest} = await currentInstallation();
        await maintainRuntime(root, manifest, fileURLToPath(import.meta.url));
    });

const tools = program.command("tools").description("管理 Agent 工具链。");
tools.command("list").action(async () => {
    const {manifest} = await currentInstallation();
    printJson(manifest.components.tools);
});
tools.command("install")
    .argument("<tool>", "rg 或 git。")
    .action(async (tool: string) => {
        assertTool(tool);
        const {root, manifest} = await currentInstallation();
        await maintainTool(root, manifest, tool, fileURLToPath(import.meta.url));
    });
tools.command("update")
    .argument("[tool]", "rg 或 git；省略时更新全部 managed tools。")
    .action(async (tool?: string) => {
        const {root, manifest} = await currentInstallation();
        if (tool) {
            assertTool(tool);
            await maintainTool(root, manifest, tool, fileURLToPath(import.meta.url));
            return;
        }
        let next = await maintainTool(root, manifest, "rg", fileURLToPath(import.meta.url));
        if (process.platform === "win32") next = await maintainTool(root, next, "git", fileURLToPath(import.meta.url));
    });
tools.command("path")
    .argument("<tool>", "rg 或 git。")
    .action(async (tool: string) => {
        assertTool(tool);
        const {root, manifest} = await currentInstallation();
        const component = manifest.components.tools[tool];
        if (!component || component.provider !== "managed") throw new Error(`${tool} 不是 managed tool。`);
        console.log(resolve(root, component.path));
    });

const admin = program.command("admin").description("管理员操作。");
admin.command("create")
    .argument("[username]")
    .action(async (username?: string) => {
        const {root, manifest} = await currentInstallation();
        await createAdmin(root, manifest, username);
    });

await program.parseAsync(process.argv).catch((error: unknown) => {
    p.log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});

async function currentInstallation(): Promise<{root: string; manifest: NonNullable<Awaited<ReturnType<typeof readInstallationManifest>>>}> {
    const root = discoverInstallationRoot();
    const paths = installationPaths(root);
    const manifest = await readInstallationManifest(paths.manifest);
    if (!manifest) {
        throw new Error(`当前目录不属于 NeuroBook Manager 安装：${root}`);
    }
    return {root, manifest};
}

async function resolveProfile(input: string | undefined, yes: boolean): Promise<InstallProfile> {
    if (input) return parseProfile(input);
    const recommended: InstallProfile = process.platform === "win32" ? "windows-portable" : "ghcr";
    if (yes || !process.stdin.isTTY) return recommended;
    const answer = await p.select({
        message: "安装 Profile",
        initialValue: recommended,
        options: profileNames().map((profile) => ({value: profile, label: profile})),
    });
    if (p.isCancel(answer)) throw new Error("已取消安装。");
    return answer;
}

function parseChannel(value: string): ReleaseChannel {
    if (value === "stable" || value === "canary") return value;
    throw new Error(`channel 只支持 stable 或 canary：${value}`);
}

function parsePort(value: string): number {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`端口必须是 1-65535：${value}`);
    return port;
}

function parseAuth(value: string): boolean {
    if (value === "enabled") return true;
    if (value === "disabled") return false;
    throw new Error(`auth 只支持 enabled 或 disabled：${value}`);
}

function collectComponent(value: string, previous: ComponentId[]): ComponentId[] {
    const allowed: ComponentId[] = ["source", "product", "runtime", "tools"];
    if (!allowed.includes(value as ComponentId)) throw new Error(`不支持的组件：${value}`);
    return [...previous, value as ComponentId];
}

function assertTool(value: string): asserts value is "rg" | "git" {
    if (value !== "rg" && value !== "git") throw new Error(`不支持的工具：${value}`);
}

function printJson(value: unknown): void {
    console.log(JSON.stringify(value, null, 4));
}

function printObject(value: object): void {
    for (const [key, item] of Object.entries(value)) {
        console.log(`${key}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`);
    }
}
