/**
 * `nbooke create`（docs/specs/runtime/plugin-api.md 的“作者工具”）：把模板写成一个能直接构建、类型检查并安装的插件目录。
 *
 * 模板在 SDK 包的 `template/` 里（仓库里是 `plugin-sdk/template/`，`build:sdk` 复制时填上依赖的版本范围）。文本文件里
 * 的 `__ID__`、`__PUBLISHER__`、`__NAME__`、`__DISPLAY_NAME__` 换成这个插件的；`_package.json`、`_gitignore` 写成去掉下划线的
 * 名字：模板目录里有真的 `package.json` 会被当成一个包，`.gitignore` 会被打包丢掉。
 *
 * 作者通常用 `bunx -p @notnotype/nb-plugin-sdk nbooke create <目录>` 建新目录，SDK 依赖写成 `^<SDK 版本>`。也可以先在目录里
 * 装好 SDK（例如 `bun add -d <SDK 的 tarball>` 试未发布的改动）再运行 `create .`：所以目录里只有 `package.json`、锁文件与
 * `node_modules` 时也可以写，已有的 `package.json` 合并：保留它已有的字段与依赖（作者钉的 SDK 写法就在这里），只补缺的。
 *
 * 先把每个文件的内容都算好（填占位符、合并 `package.json`）再写；写到一半失败（权限、磁盘满）时删掉这次写下的文件与新建的
 * 目录、把 `package.json` 写回原样，目录回到运行前的样子，作者修好原因后重跑即可。
 */

import {existsSync} from "node:fs";
import {mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {basename, dirname, join, relative, resolve} from "node:path";

import {ID_SEGMENT_RULE, isIdSegment} from "@notnotype/nb-runtime/plugin-manifest";

import {manifestFormat} from "../src/plugin-platform-profile";

const SDK_PACKAGE = "@notnotype/nb-plugin-sdk";

/**
 * 刚装完 SDK（或 `git init` 之后）的目录里会有的东西；有别的文件就不写，免得盖掉作者已有的代码。模板里的文件
 * （例如 `.gitignore`）已经存在时同样拒绝，不覆盖。
 */
const ALLOWED_EXISTING = new Set(["package.json", "bun.lock", "bun.lockb", "node_modules", ".git", ".npmrc"]);

const RENAMED: Readonly<Record<string, string>> = {"_package.json": "package.json", "_gitignore": ".gitignore"};

export class PluginCreateError extends Error {
    constructor(message: string, options?: {readonly cause?: unknown}) {
        super(message, options);
        this.name = "PluginCreateError";
    }
}

export interface CreatePluginOptions {
    readonly directory: string;
    /** 缺省 `my`。 */
    readonly publisher?: string;
    /** 缺省取已有 `package.json` 的 `name`，再缺省取目录名。 */
    readonly name?: string;
    /** 模板目录（SDK 包里的 `template/`）。 */
    readonly templateDir: string;
    /** SDK 的版本：没有已有的 SDK 依赖、也没给 `sdk` 时写 `^<版本>`。 */
    readonly sdkVersion: string;
    /** SDK 依赖的写法（例如 tarball 的 `file:` 路径），覆盖已有的与缺省的。 */
    readonly sdk?: string;
}

export interface CreatePluginResult {
    readonly id: string;
    readonly directory: string;
    /** 相对插件目录、写下或改过的文件。 */
    readonly files: ReadonlyArray<string>;
}

type PackageJson = Record<string, unknown>;

export async function createPlugin(options: CreatePluginOptions): Promise<CreatePluginResult> {
    const directory = resolve(options.directory);
    const existingText = await existingPackage(directory);
    const existing = existingText === null ? null : parsePackage(directory, existingText);
    const publisher = options.publisher ?? "my";
    const name = options.name ?? (typeof existing?.name === "string" ? existing.name : segmentOf(basename(directory)));
    for (const [field, value] of [["publisher", publisher], ["name", name]] as const) {
        if (!isIdSegment(value)) throw new PluginCreateError(`${field} 不合规：${value}（${ID_SEGMENT_RULE}；插件 id 是 publisher.name，definePlugin 用它拼出各项贡献的 id）；用 --${field} 指定`);
    }
    if (manifestFormat.isReservedPublisher(publisher)) throw new PluginCreateError(`publisher 不能是 ${publisher}：它留给内置插件；用 --publisher 指定别的`);
    const id = `${publisher}.${name}`;
    const replacements: Readonly<Record<string, string>> = {
        __ID__: id,
        __PUBLISHER__: publisher,
        __NAME__: name,
        __DISPLAY_NAME__: displayNameOf(name),
        __SDK_VERSION__: options.sdkVersion,
    };
    const fill = (text: string): string => text.replace(/__(?:ID|PUBLISHER|NAME|DISPLAY_NAME|SDK_VERSION)__/gu, (token) => replacements[token]!);

    const planned: Array<{readonly target: string; readonly content: string}> = [];
    for (const source of await templateFiles(options.templateDir)) {
        const relativePath = relative(options.templateDir, source);
        const target = join(directory, dirname(relativePath), RENAMED[basename(relativePath)] ?? basename(relativePath));
        const text = fill(await readFile(source, "utf8"));
        let content = text;
        if (basename(relativePath) === "_package.json") {
            content = `${JSON.stringify(mergePackage(JSON.parse(text) as PackageJson, existing, options.sdk), null, 4)}\n`;
        }
        planned.push({target, content});
    }
    await writeAll(directory, planned, existingText);
    return {id, directory, files: planned.map(({target}) => relative(directory, target)).sort()};
}

/** 依次写下；失败时撤掉这次写下的（见文件头），再以 `PluginCreateError` 报出原因。 */
async function writeAll(directory: string, planned: ReadonlyArray<{readonly target: string; readonly content: string}>, existingPackageText: string | null): Promise<void> {
    const createdDirectories: string[] = [];
    const written: string[] = [];
    try {
        for (const {target, content} of planned) {
            const created = await mkdir(dirname(target), {recursive: true});
            if (created !== undefined) createdDirectories.push(created);
            await writeFile(target, content);
            written.push(target);
        }
    } catch (error) {
        const leftovers: string[] = [];
        const undo = async (action: () => Promise<void>, path: string): Promise<void> => {
            try {
                await action();
            } catch {
                leftovers.push(path);
            }
        };
        for (const target of written.reverse()) {
            const isPackage = target === join(directory, "package.json");
            await undo(() => (isPackage && existingPackageText !== null ? writeFile(target, existingPackageText) : rm(target, {force: true})), target);
        }
        // `mkdir` 返回它新建的最外层目录；里面只有这次写下的文件，已经删掉了。
        for (const created of createdDirectories.reverse()) await undo(() => rm(created, {recursive: true, force: true}), created);
        const reason = error instanceof Error ? error.message : String(error);
        const rest = leftovers.length === 0 ? "已撤掉这次写下的文件" : `撤不掉这些，要手动删：${leftovers.map((path) => relative(directory, path) || path).join("、")}`;
        throw new PluginCreateError(`写插件目录失败：${reason}；${rest}`, {cause: error});
    }
}

/** 目录不存在、为空，或只有刚装完 SDK 会有的东西时返回已有的 `package.json` 原文（没有为 null）；否则拒绝。 */
async function existingPackage(directory: string): Promise<string | null> {
    if (!existsSync(directory)) return null;
    const names = await readdir(directory);
    const others = names.filter((item) => !ALLOWED_EXISTING.has(item));
    if (others.length > 0) throw new PluginCreateError(`目录 ${directory} 里已经有别的文件（${others.slice(0, 5).join("、")}），不写；换一个空目录，或只留 package.json、锁文件与 node_modules`);
    if (!names.includes("package.json")) return null;
    try {
        return await readFile(join(directory, "package.json"), "utf8");
    } catch (error) {
        throw new PluginCreateError(`读不了 ${join(directory, "package.json")}：${error instanceof Error ? error.message : String(error)}`, {cause: error});
    }
}

function parsePackage(directory: string, text: string): PackageJson {
    try {
        const value: unknown = JSON.parse(text);
        if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("不是 JSON 对象");
        return value as PackageJson;
    } catch (error) {
        throw new PluginCreateError(`读不了 ${join(directory, "package.json")}：${error instanceof Error ? error.message : String(error)}`, {cause: error});
    }
}

/**
 * 模板的 `package.json` 与已有的合并：已有的字段与依赖不动（作者装 SDK 时写下的 `file:` 路径、自己加的依赖），模板只补缺的
 * 字段、脚本与开发依赖。已经在 `dependencies` 里的包不再加进 `devDependencies`。`publisher`、`name`、`version` 用模板的：
 * 它们组成插件 id 与版本，要与写出的 `plugin.ts` 一致，构建时会核对；`type` 也用模板的（已有的 `commonjs` 会让模板的 ESM
 * 写法读不了）。给了 `sdk` 时 SDK 依赖按它写。
 */
function mergePackage(template: PackageJson, existing: PackageJson | null, sdk: string | undefined): PackageJson {
    const merged = existing === null ? template : mergeExisting(template, existing);
    if (sdk === undefined) return merged;
    const dependencies = merged.dependencies as Record<string, unknown> | undefined;
    if (dependencies !== undefined && SDK_PACKAGE in dependencies) return {...merged, dependencies: {...dependencies, [SDK_PACKAGE]: sdk}};
    return {...merged, devDependencies: {...merged.devDependencies as Record<string, unknown>, [SDK_PACKAGE]: sdk}};
}

function mergeExisting(template: PackageJson, existing: PackageJson): PackageJson {
    const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {});
    const dependencies = record(existing.dependencies);
    const devDependencies = Object.fromEntries(Object.entries(record(template.devDependencies)).filter(([name]) => !(name in dependencies)));
    return {
        ...template,
        ...existing,
        publisher: template.publisher,
        name: template.name,
        version: template.version,
        type: template.type,
        scripts: {...record(template.scripts), ...record(existing.scripts)},
        devDependencies: {...devDependencies, ...record(existing.devDependencies)},
    };
}

async function templateFiles(directory: string): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await readdir(directory, {withFileTypes: true})) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await templateFiles(path));
        else files.push(path);
    }
    return files;
}

/** 目录名转成 id 段：转小写，别的字符换成连字符。结果仍不合规（例如数字开头）时由调用方报错，不猜。 */
function segmentOf(directoryName: string): string {
    return directoryName.toLowerCase().replace(/[^a-z0-9-]+/gu, "-").replace(/-+/gu, "-").replace(/^-|-$/gu, "");
}

function displayNameOf(name: string): string {
    return name.split("-").filter((part) => part !== "").map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" ");
}
