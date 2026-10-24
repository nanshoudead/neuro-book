/**
 * `nbstory skill install`（docs/specs/story/cli-skill.md 输出 16、17，F4 到 F6）：把随包的 Skill 目录装进外部 Agent
 * 的 Skill 目录。由 main.ts 动态导入；不读书库与密钥。
 *
 * 不装半份：先把内容写进目标旁边的临时目录，写完再改名到目标位置；替换时先把旧目录改名让开，新目录就位后才删旧的。
 * 临时目录与目标在同一个父目录下，改名不跨文件系统。新目录就位是提交点：之前任何一步失败，目标保持原样；之后删旧
 * 目录失败（例如里面有不可写的子目录），替换照样算成功，留下的旧目录路径交给调用方（输出 17）。
 */

import {randomUUID} from "node:crypto";
import {cp, lstat, mkdir, readdir, readFile, rename, rm} from "node:fs/promises";
import {dirname, isAbsolute, join, relative, resolve} from "node:path";

import type {CliIo} from "./main";

/** 随包的 Skill 目录。按本文件的位置找，从仓库运行与从 npm 安装都一样（与 server/serve.ts 的 WEB_ROOT 同一做法）。 */
export const SKILL_SOURCE = join(import.meta.dir, "..", "..", "skill");
const SKILL_NAME = "nbstory";

/** 外部 Agent 的用户级 Skill 目录（相对 $HOME）。Codex 读 `~/.agents/skills`（它的文档，2026-10-24 查）。 */
export const AGENT_SKILL_DIRS = {claude: [".claude", "skills"], codex: [".agents", "skills"]} as const;
export type SkillAgent = keyof typeof AGENT_SKILL_DIRS;

export type InstallState = "installed" | "unchanged" | "replaced";

export interface InstallResult {
    state: InstallState;
    /** 替换后没能删掉的旧目录与删除时的系统错误码；删掉了就没有。 */
    leftover?: {path: string; code: string};
}

export type SkillErrorCode = "skill_exists" | "skill_target_invalid" | "skill_install_failed";

export class SkillInstallError extends Error {
    constructor(
        readonly code: SkillErrorCode,
        message: string,
    ) {
        super(message);
        this.name = "SkillInstallError";
    }
}

const EXIT: Record<SkillErrorCode, number> = {skill_exists: 2, skill_target_invalid: 2, skill_install_failed: 1};

/**
 * 目标目录：`--dir` 优先，否则按 Agent 放进用户目录下的约定位置。用户目录在 Windows 上是 USERPROFILE（Claude Code
 * 与 Codex 在 Windows 上都按它找 `.claude`、`.agents`），其余平台是 HOME。为空或是相对路径时报错，不去猜：拼出来的
 * 相对路径会装进当前目录；Bun 的 `os.homedir()` 与 `os.userInfo().homedir` 也只是读这两个变量，没有可靠的后备。
 */
export function skillTarget(options: {agent?: SkillAgent; dir?: string; home?: string}): string {
    if (options.dir !== undefined) return join(resolve(options.dir), SKILL_NAME);
    const variable = process.platform === "win32" ? "USERPROFILE" : "HOME";
    const home = options.home ?? process.env[variable] ?? "";
    if (!isAbsolute(home)) throw new SkillInstallError("skill_install_failed", `${variable} 不是绝对路径（${home === "" ? "空" : home}），找不到用户级 Skill 目录；设好 ${variable}，或用 --dir 指定目录`);
    return join(home, ...AGENT_SKILL_DIRS[options.agent ?? "claude"], SKILL_NAME);
}

export async function installSkill(source: string, target: string, force: boolean): Promise<InstallResult> {
    const parent = dirname(target);
    const staging = join(parent, `.${SKILL_NAME}-skill-${randomUUID()}`);
    try {
        const existing = await targetKind(target);
        if (existing === "invalid") throw new SkillInstallError("skill_target_invalid", `${target} 是符号链接或文件，不是 Skill 目录；不跟随、不覆盖`);
        if (existing === "directory") {
            if (await sameTree(source, target)) return {state: "unchanged"};
            if (!force) throw new SkillInstallError("skill_exists", `${target} 已存在且内容不同；加 --force 换成随包的内容（目录里多出的文件会被删掉）`);
        }
        await mkdir(parent, {recursive: true});
        await cp(source, staging, {recursive: true, errorOnExist: true, force: false});
        if (existing === "absent") {
            await rename(staging, target);
            return {state: "installed"};
        }
        const previous = join(parent, `.${SKILL_NAME}-skill-old-${randomUUID()}`);
        await rename(target, previous);
        try {
            await rename(staging, target);
        } catch (error) {
            // 新目录没能就位：把旧目录放回去，目标保持原样。
            await rename(previous, target);
            throw error;
        }
        try {
            await rm(previous, {recursive: true, force: true});
            return {state: "replaced"};
        } catch (error) {
            // 已经过了提交点：目标是新内容，只是旧目录没删干净。rm 可能删掉了一部分，所以不再尝试放回去。
            return {state: "replaced", leftover: {path: previous, code: (error as NodeJS.ErrnoException).code ?? "unknown"}};
        }
    } catch (error) {
        await rm(staging, {recursive: true, force: true});
        if (error instanceof SkillInstallError) throw error;
        const code = (error as NodeJS.ErrnoException).code ?? "unknown";
        throw new SkillInstallError("skill_install_failed", `装到 ${target} 失败（${code}）：${(error as Error).message}`);
    }
}

async function targetKind(target: string): Promise<"absent" | "directory" | "invalid"> {
    try {
        const stats = await lstat(target);
        return stats.isDirectory() ? "directory" : "invalid";
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
        throw new SkillInstallError("skill_install_failed", `读不了 ${target}（${(error as NodeJS.ErrnoException).code ?? "unknown"}）`);
    }
}

/** 两边的文件集合与每个文件的字节都相同。目录里的符号链接等非普通文件算不同。 */
async function sameTree(left: string, right: string): Promise<boolean> {
    const [leftFiles, rightFiles] = await Promise.all([listFiles(left), listFiles(right)]);
    if (leftFiles === null || rightFiles === null || leftFiles.length !== rightFiles.length) return false;
    for (let index = 0; index < leftFiles.length; index += 1) {
        const file = leftFiles[index] as string;
        if (file !== rightFiles[index]) return false;
        const [a, b] = await Promise.all([readFile(join(left, file)), readFile(join(right, file))]);
        if (!a.equals(b)) return false;
    }
    return true;
}

async function listFiles(root: string): Promise<string[] | null> {
    const files: string[] = [];
    for (const entry of await readdir(root, {recursive: true, withFileTypes: true})) {
        if (entry.isDirectory()) continue;
        if (!entry.isFile()) return null;
        files.push(relative(root, join(entry.parentPath, entry.name)));
    }
    return files.sort();
}

interface SkillOptions {
    params: Record<string, unknown>;
    json: boolean;
}

const USAGE = "用法：nbstory skill install [--agent claude|codex] [--dir <目录>] [--force] [--json]";

export async function skillCommand(options: SkillOptions, io: CliIo): Promise<number> {
    const {params, json} = options;
    if (params.action !== "install") {
        io.stderr(`${params.action === undefined ? "缺少动作" : `没有动作 ${String(params.action)}`}\n${USAGE}`);
        return 2;
    }
    if (params.agent !== undefined && params.dir !== undefined) {
        io.stderr(`--agent 与 --dir 只能给一个\n${USAGE}`);
        return 2;
    }
    try {
        const target = skillTarget({agent: params.agent as SkillAgent | undefined, dir: params.dir as string | undefined});
        const {state, leftover} = await installSkill(SKILL_SOURCE, target, params.force === true);
        const text = {installed: `已装好 Skill：${target}`, unchanged: `Skill 已是最新：${target}`, replaced: `已换成随包的 Skill：${target}`}[state];
        const note = leftover === undefined ? "" : `\n旧目录没能删掉（${leftover.code}），留在 ${leftover.path}，确认后手动删除`;
        io.stdout(json ? JSON.stringify({ok: true, data: {path: target, state, ...(leftover === undefined ? {} : {leftover: leftover.path})}}) : `${text}${note}`);
        return 0;
    } catch (error) {
        if (!(error instanceof SkillInstallError)) throw error;
        if (json) io.stdout(JSON.stringify({ok: false, error: {code: error.code, message: error.message}}));
        else io.stderr(`错误（${error.code}）：${error.message}`);
        return EXIT[error.code];
    }
}
