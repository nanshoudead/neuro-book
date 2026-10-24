/**
 * 生成可以安装的插件 SDK 包 `@notnotype/nb-plugin-sdk`（docs/specs/runtime/plugin-api.md 的“SDK”）：
 *
 * - `index.js`、`browser.js`、`components.js`：`src/sdk/` 打包后的实现（`components` 是 nb-ui 的组件）。插件运行时用的是宿主模块表里的那一份，这两份只在作者构建插件时
 *   执行入口定义（生成清单）、以及在仓库外写测试时用；`vue`、`@vue/*`、`typebox` 不打进去，由作者的项目提供同一份。
 * - `index.d.ts`、`browser.d.ts`、`components.d.ts`：打平的类型，不含应用内部的 `nbook/*` 别名，只引用 `vue`、
 *   `@vue/reactivity` 与 `typebox`。内核、nb-form 与 nb-ui 的子路径映射到源码，类型才会被打进来：经 `node_modules` 解析到的工作区包被 TypeScript
 *   当作外部库，不生成声明。
 * - `build.js`、`build.d.ts`：构建预设（`build.ts`，绑定 NeuroBook 平台档案的那一层），在 Node 或 Bun 里运行；Vite、单文件组件编译与图标数据是它的
 *   依赖。
 * - `cli.js` 与 `template/`：作者命令 `nbook-plugin`（`cli.ts`）与 `create` 用的模板；模板 `_package.json` 里的依赖范围在这里
 *   填上，与应用自己用的一致。
 * - `package.json`：版本取产品版本；`vue`、`@vue/reactivity`、`typebox` 是 peer 依赖，构建预设的工具是普通依赖。
 * - `README.md`：作者文档（`scripts/plugin-sdk/README.md`）；`docs/components.md`、`docs/tokens.md`：从 nb-ui 的组件入口与
 *   主题文件生成的两份附表；`specs/`：作者文档链接到的 Spec 的副本。作者文档在仓库里用指向 `docs/specs/` 的相对链接写，复制时
 *   改写到包里的副本：SDK 不发布、Work 分支也不推到远端，指向仓库的链接作者打不开，副本还与这个 SDK 版本一致。
 *
 * 用法：`bun run build:sdk [输出目录]`，缺省输出到 `dist/plugin-sdk/`。输出目录只在不存在、为空或者是上次生成的 SDK 包时
 * 清空重建，否则拒绝。
 */

import {existsSync} from "node:fs";
import {chmod, cp, mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";

import vue from "@vitejs/plugin-vue";
import {build as rolldown} from "rolldown";
import {dts} from "rolldown-plugin-dts";
import {build as vite} from "vite";

import {SDK_ENTRIES, SDK_NAME} from "../../src/sdk/entries";
import type {SdkEntry} from "../../src/sdk/entries";
import {PRODUCT_VERSION} from "../../src/shared/product";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
/** 打包的入口：产物文件名（不带扩展名）→ 源文件，按 SDK 的子路径表。 */
const ENTRIES = Object.fromEntries(SDK_ENTRIES.map((entry) => [entryName(entry), join(packageRoot, "src/sdk", entry.file)]));

function entryName(entry: SdkEntry): string {
    return entry.subpath === "." ? "index" : entry.subpath.slice("./".length);
}
/** 由作者的项目提供、不打进 SDK 的包：插件运行时宿主给的是同一份。 */
const PEERS = [/^vue($|\/)/u, /^@vue\//u, /^typebox($|\/)/u];
const RUNTIME_SUBPATHS = ["lifecycle", "services", "plugins", "plugin-manifest", "application", "diagnostics", "remote"];

/** 类型打包要的路径映射：应用别名，加上内核与 nb-form 的子路径直接指到源码。 */
function typePaths(): Record<string, string[]> {
    const paths: Record<string, string[]> = {"nbook/*": ["./src/*"]};
    for (const name of RUNTIME_SUBPATHS) paths[`@notnotype/nb-runtime/${name}`] = [`../nb-runtime/src/${name}/${name}.ts`];
    paths["@notnotype/nb-form"] = ["../nb-form/src/index.ts"];
    paths["@notnotype/nb-form/vue"] = ["../nb-form/src/vue/index.ts"];
    paths["@notnotype/nb-ui/components"] = ["../nb-ui/src/components/index.ts"];
    return paths;
}

/** 构建预设在作者机器上运行时要的包；版本跟应用自己用的一致。 */
const BUILD_DEPENDENCIES = ["vite", "@vitejs/plugin-vue", "@iconify/utils", "@iconify-json/lucide", "semver"];

async function dependencyRanges(names: ReadonlyArray<string>): Promise<Record<string, string>> {
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {dependencies: Record<string, string>; devDependencies: Record<string, string>};
    return Object.fromEntries(names.map((name) => {
        const value = manifest.dependencies[name] ?? manifest.devDependencies[name];
        if (value === undefined) throw new Error(`应用的 package.json 里没有 ${name}`);
        return [name, value];
    }));
}

/**
 * 清空上次生成的 SDK 包。输出目录来自命令行，传错了（`.`、项目目录）不能被递归删除：只认不存在、为空，或者 `package.json`
 * 的 `name` 是 SDK 包名的目录。
 */
async function clearPreviousSdk(outDir: string): Promise<void> {
    if (!existsSync(outDir) || (await readdir(outDir)).length === 0) return;
    const manifest = join(outDir, "package.json");
    let name: unknown = null;
    if (existsSync(manifest)) {
        try {
            name = (JSON.parse(await readFile(manifest, "utf8")) as {name?: unknown} | null)?.name;
        } catch (error) {
            throw new Error(`输出目录 ${outDir} 的 package.json 读不了，不清理`, {cause: error});
        }
    }
    if (name !== SDK_NAME) throw new Error(`输出目录 ${outDir} 不是空的，也不是上次生成的 ${SDK_NAME}，不清理`);
    await rm(outDir, {recursive: true});
}

const AUTHOR_README = join(packageRoot, "scripts/plugin-sdk/README.md");
const SPECS_ROOT = join(packageRoot, "../../docs/specs");
/** nb-ui 的源码只当数据读（组件入口、主题文件），不导入：它的模块要 DOM，构建脚本的类型检查没有 DOM。 */
const NB_UI_SOURCE = join(packageRoot, "../nb-ui/src");

/** 作者文档、两份附表与 Spec 副本。 */
async function writeAuthorDocs(outDir: string): Promise<void> {
    const specs = new Set<string>();
    // 只认行内链接 `[文字](地址)`：作者文档里不写引用式链接，代码块里也不写这个形状（会被当成链接改写）。
    const readme = (await readFile(AUTHOR_README, "utf8")).replace(/\]\(([^()\s]+)\)/gu, (_link, url: string) => `](${packageLink(url, specs)})`);
    await writeFile(join(outDir, "README.md"), readme);
    for (const spec of specs) {
        await mkdir(dirname(join(outDir, "specs", spec)), {recursive: true});
        await writeFile(join(outDir, "specs", spec), specCopy(spec, await readFile(join(SPECS_ROOT, spec), "utf8"), specs));
    }
    await mkdir(join(outDir, "docs"), {recursive: true});
    await writeFile(join(outDir, "docs/components.md"), await componentsDoc());
    await writeFile(join(outDir, "docs/tokens.md"), await tokensDoc());
}

/**
 * 作者文档里一个链接在包里的写法。绝对地址与页内锚点不动；指向 `docs/specs/` 的改到包里 `specs/` 下的副本，并记下要复制的
 * Spec。指向仓库别处的相对链接在包里打不开，构建失败：作者文档要引用示例这类包外的东西时写成文字，不写链接。
 */
function packageLink(url: string, specs: Set<string>): string {
    if (/^[a-z][a-z0-9+.-]*:/iu.test(url) || url.startsWith("#")) return url;
    const hash = url.indexOf("#");
    const path = hash < 0 ? url : url.slice(0, hash);
    const target = resolve(dirname(AUTHOR_README), decodeURIComponent(path));
    const spec = relative(SPECS_ROOT, target);
    if (spec.startsWith("..") || isAbsolute(spec) || !spec.endsWith(".md") || !existsSync(target)) {
        throw new Error(`作者文档的链接 ${url} 不指向 docs/specs/ 下的 Spec：SDK 包里没有它`);
    }
    specs.add(spec);
    return `specs/${spec.split(sep).join("/")}${hash < 0 ? "" : url.slice(hash)}`;
}

/**
 * Spec 副本：指向别的副本的链接不动；指向没有随包的文件的相对链接改成“文字（仓库里的 `路径`）”，作者在包里点到的链接
 * 都能打开，也知道包外的那份在哪里。副本只随作者文档引用的那几份，不顺着链接把整个 `docs/` 带进包。
 */
function specCopy(spec: string, text: string, copied: ReadonlySet<string>): string {
    const repoRoot = resolve(SPECS_ROOT, "../..");
    return text.replace(/\[([^\]]*)\]\(([^()\s]+)\)/gu, (link, label: string, url: string) => {
        if (/^[a-z][a-z0-9+.-]*:/iu.test(url) || url.startsWith("#")) return link;
        const hash = url.indexOf("#");
        const target = resolve(dirname(join(SPECS_ROOT, spec)), decodeURIComponent(hash < 0 ? url : url.slice(0, hash)));
        if (copied.has(relative(SPECS_ROOT, target))) return link;
        return `${label}（仓库里的 \`${relative(repoRoot, target).split(sep).join("/")}\`）`;
    });
}

/** nb-ui 组件目录对应的分组标题。不认识的目录用目录名作标题，新加的目录不会漏掉组件。 */
const COMPONENT_GROUPS: Readonly<Record<string, string>> = {controls: "控件", form: "表单", display: "展示", feedback: "反馈与浮层", popup: "弹出与菜单", layout: "布局", navigation: "导航"};

/**
 * 组件清单：nb-ui 组件入口里单文件组件的默认导出（`export {default as Button} from "./controls/Button.vue"`），按所在目录分组。
 * 只认 `.vue`：入口里还有首字母大写的常量（`NB_FIELD_CONTEXT_KEY`）与布局工具函数，它们不是组件。
 */
async function componentsDoc(): Promise<string> {
    const source = await readFile(join(NB_UI_SOURCE, "components/index.ts"), "utf8");
    const groups = new Map<string, string[]>();
    for (const match of source.matchAll(/^export\s*\{\s*default as (\w+)\s*\}\s*from\s*"\.\/([^/"]+)\/[^"]+\.vue"/gmu)) {
        const directory = match[2]!;
        groups.set(directory, [...groups.get(directory) ?? [], match[1]!]);
    }
    if (groups.size === 0) throw new Error("nb-ui 的组件入口里没有找到 `export {default as X} from \"./目录/X.vue\"` 形式的组件导出，组件清单的读法要跟着改");
    // 换了写法的组件（单引号、跨行、同一行带类型导出、不在子目录）上面的读法认不出来：用宽松的读法再数一遍，对不上就报错，
    // 免得它从作者的清单里悄悄消失。
    const strict = new Set([...groups.values()].flat());
    const loose = [...source.matchAll(/default\s+as\s+(\w+)[^;]*?\.vue["']/gu)].map((match) => match[1]!);
    const missed = loose.filter((name) => !strict.has(name));
    if (missed.length > 0) throw new Error(`nb-ui 的组件入口里这些组件的导出写法组件清单认不出来：${missed.join("、")}；改成 \`export {default as X} from "./目录/X.vue";\` 单独一行，或者改组件清单的读法`);
    const order = [...Object.keys(COMPONENT_GROUPS), ...[...groups.keys()].filter((name) => !(name in COMPONENT_GROUPS)).sort()];
    const sections = order.filter((name) => groups.has(name)).map((name) => {
        const items = groups.get(name)!.sort().map((component) => `- \`${component}\``);
        return `## ${COMPONENT_GROUPS[name] ?? name}\n\n${items.join("\n")}\n`;
    });
    return `# 组件

由 SDK 的构建从 NeuroBook 的组件入口生成，不要手改。

插件的界面只用这里的组件，从 \`@notnotype/nb-plugin-sdk/components\` 导入：

\`\`\`ts
import {Button} from "@notnotype/nb-plugin-sdk/components";
\`\`\`

属性、事件与插槽看包里的 \`components.d.ts\`（编辑器里跳转到定义即可）。插件运行时用的是 NeuroBook 自己的那一份组件，外观随用户的主题变化。

${sections.join("\n")}`;
}

interface TokenGroup {
    readonly title: string;
    readonly pattern: RegExp;
}

/** 颜色变量按前缀分组；没有命中的进“其它”。 */
const COLOR_GROUPS: ReadonlyArray<TokenGroup> = [
    {title: "背景", pattern: /^--bg-/u},
    {title: "文字", pattern: /^--text-/u},
    {title: "边框", pattern: /^--border-/u},
    {title: "强调：选中、当前项、主操作", pattern: /^--accent-/u},
    {title: "状态：info 说明、success 完成、warning 提醒、danger 错误", pattern: /^--status-/u},
];

/** 不随配色变化的变量按前缀分组，先命中的算；没有命中的进“其它”，nb-ui 加了新前缀也不会漏掉。 */
const DESIGN_GROUPS: ReadonlyArray<TokenGroup> = [
    {title: "排版：字体、字号、行高、字重", pattern: /^--(?:font|text|leading|weight|tracking)-/u},
    {title: "间距", pattern: /^--space-/u},
    {title: "控件与容器的尺寸", pattern: /^--(?:control-h-|control-px$|menu-|panel-p$|stack-gap$|border-w$)/u},
    {title: "圆角", pattern: /^--radius-/u},
    {title: "阴影与焦点", pattern: /^--(?:elevation-|surface-raise$|inset-shadow$|focus-)/u},
    {title: "面与线的角色：控件、面板、浮层取哪个颜色", pattern: /-(?:surface|outline)$|^--overlay-|^--divider$/u},
    {title: "动效", pattern: /^--(?:motion|ease)-/u},
    {title: "滚动条", pattern: /^--scrollbar-/u},
    {title: "拖动与落点的反馈", pattern: /^--(?:sash-|drop-area-)/u},
];

/** 一份样式表里声明的自定义属性与它第一次出现时的值（`prefers-reduced-motion` 里的重声明不算）。 */
async function cssTokens(file: string): Promise<Map<string, string>> {
    const text = (await readFile(file, "utf8")).replace(/\/\*[\s\S]*?\*\//gu, "");
    const tokens = new Map<string, string>();
    for (const match of text.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gu)) {
        if (!tokens.has(match[1]!)) tokens.set(match[1]!, match[2]!.replace(/\s+/gu, " ").trim());
    }
    return tokens;
}

function grouped<T extends string>(names: ReadonlyArray<T>, groups: ReadonlyArray<TokenGroup>): Array<{readonly title: string; readonly names: T[]}> {
    const result = [...groups, {title: "其它", pattern: /(?:)/u}].map((group) => ({title: group.title, pattern: group.pattern, names: [] as T[]}));
    for (const name of names) result.find((group) => group.pattern.test(name))!.names.push(name);
    return result.filter((group) => group.names.length > 0);
}

/**
 * 主题变量清单：颜色取 nb-ui 的配色合同（`colorway-contract.ts` 的 `nbColorwayVarKeys`），其余取 `tokens.css` 与 `theme.css`
 * 里声明的变量与缺省值。
 */
async function tokensDoc(): Promise<string> {
    const contract = await readFile(join(NB_UI_SOURCE, "colorway/colorway-contract.ts"), "utf8");
    const list = /nbColorwayVarKeys\s*=\s*\[([\s\S]*?)\]\s*as const/u.exec(contract)?.[1];
    const colors = [...(list ?? "").matchAll(/"(--[a-z0-9-]+)"/gu)].map((match) => match[1]!);
    if (colors.length === 0) throw new Error("nb-ui 的配色合同里没有找到 nbColorwayVarKeys，主题变量清单的读法要跟着改");
    // 只认逐个写出的双引号字面量；展开、单引号或常量引用会让一部分颜色读不到。
    const unread = (list ?? "").replace(/\/\/[^\n]*/gu, "").replace(/"--[a-z0-9-]+"/gu, "").replace(/[\s,]/gu, "");
    if (unread !== "") throw new Error(`nb-ui 的配色合同 nbColorwayVarKeys 里有读不了的写法：${unread.slice(0, 60)}；主题变量清单的读法要跟着改`);
    const design = new Map([...await cssTokens(join(NB_UI_SOURCE, "theme.css")), ...await cssTokens(join(NB_UI_SOURCE, "tokens.css"))]);
    for (const color of colors) design.delete(color);
    if (design.size === 0) throw new Error("nb-ui 的 tokens.css 与 theme.css 里没有找到变量声明");
    const cell = (value: string): string => (value.length <= 48 ? `\`${value.replaceAll("|", "\\|")}\`` : "（组合值，略）");
    const colorSections = grouped(colors, COLOR_GROUPS).map((group) => `### ${group.title}\n\n${group.names.map((name) => `- \`${name}\``).join("\n")}\n`);
    const designSections = grouped([...design.keys()], DESIGN_GROUPS).map((group) => `### ${group.title}\n\n| 变量 | 缺省值 |\n|---|---|\n${group.names.map((name) => `| \`${name}\` | ${cell(design.get(name)!)} |`).join("\n")}\n`);
    return `# 主题变量

由 SDK 的构建从 NeuroBook 的主题文件生成，不要手改。

插件的样式用 \`var(--名字)\` 取这些变量，不写字面的颜色、尺寸与字号：用户换主题、换配色、切明暗时，插件跟着变。

## 颜色

颜色随用户选的配色与明暗变化，同一个变量在亮色与暗色下取值不同，所以这里不列值。不写死颜色，也不按明暗自己分支；要淡一点的颜色用 \`color-mix(in srgb, var(--accent-main) 12%, transparent)\` 这样现场混。

${colorSections.join("\n")}
## 尺寸、排版、阴影与动效

不随配色变化。下面是 NeuroBook 的缺省值，主题可以覆盖：用变量，不要照抄值。

${designSections.join("\n")}`;
}

export async function buildSdk(outDir: string): Promise<void> {
    await clearPreviousSdk(outDir);
    await vite({
        configFile: false,
        logLevel: "warn",
        plugins: [vue()],
        resolve: {alias: [{find: /^nbook\//u, replacement: join(packageRoot, "src/")}]},
        build: {
            outDir,
            emptyOutDir: false,
            minify: false,
            // 组件的样式由宿主的页面提供，SDK 的构建期实现用不到。
            cssCodeSplit: false,
            lib: {entry: ENTRIES, formats: ["es"], fileName: (_format, name) => `${name}.js`, cssFileName: "unused"},
            rolldownOptions: {external: PEERS},
        },
    });
    await rm(join(outDir, "unused.css"), {force: true});
    await rolldown({
        cwd: packageRoot,
        input: ENTRIES,
        external: PEERS,
        plugins: [dts({cwd: packageRoot, tsconfig: "tsconfig.web.json", compilerOptions: {paths: typePaths()}, vue: true, emitDtsOnly: true})],
        output: {dir: outDir},
        // 生成声明本来就慢（vue-tsc），不报插件耗时。
        checks: {pluginTimings: false},
    });
    // 构建预设：Node 工具，打进内核的清单与应用的版本工具；Vite 与编译器、图标数据留作依赖。声明文件一并生成，作者的
    // 构建脚本用得上 `BuildPluginOptions`、`PluginBuildError` 这些类型。
    await rolldown({
        cwd: packageRoot,
        input: {build: join(packageRoot, "scripts/plugin-sdk/build.ts"), cli: join(packageRoot, "scripts/plugin-sdk/cli.ts")},
        platform: "node",
        external: [...PEERS, ...BUILD_DEPENDENCIES.map((name) => new RegExp(`^${name.replace("/", "\\/")}($|/)`, "u"))],
        resolve: {alias: {nbook: join(packageRoot, "src")}},
        plugins: [dts({cwd: packageRoot, tsconfig: "tsconfig.json", compilerOptions: {paths: typePaths()}})],
        output: {dir: outDir, format: "es", entryFileNames: "[name].js", banner: (chunk) => (chunk.isEntry && chunk.name === "cli" ? "#!/usr/bin/env node" : "")},
        checks: {pluginTimings: false},
    });
    await chmod(join(outDir, "cli.js"), 0o755);
    // 命令的声明文件用不上：它只作 bin。
    await rm(join(outDir, "cli.d.ts"), {force: true});
    await cp(join(packageRoot, "scripts/plugin-sdk/template"), join(outDir, "template"), {recursive: true});
    const templatePackage = join(outDir, "template/_package.json");
    const ranges = await dependencyRanges(["typebox", "typescript", "vue", "vue-tsc"]);
    await writeFile(templatePackage, (await readFile(templatePackage, "utf8"))
        .replace("__TYPEBOX_RANGE__", ranges.typebox!).replace("__TYPESCRIPT_RANGE__", ranges.typescript!)
        .replace("__VUE_RANGE__", ranges.vue!).replace("__VUE_TSC_RANGE__", ranges["vue-tsc"]!));
    const peers = await dependencyRanges(["vue", "typebox"]);
    // vue 的每个版本都把 @vue/reactivity 钉在同一个版本上：用与 vue 相同的范围，作者项目里两者才配成一对。
    peers["@vue/reactivity"] = peers.vue!;
    await writeFile(join(outDir, "package.json"), `${JSON.stringify({
        name: SDK_NAME,
        version: PRODUCT_VERSION,
        description: "NeuroBook 插件 SDK：类型与构建期实现；插件运行时由宿主提供同一份",
        type: "module",
        bin: {"nbook-plugin": "./cli.js"},
        exports: {
            ...Object.fromEntries(SDK_ENTRIES.map((entry) => [entry.subpath, {types: `./${entryName(entry)}.d.ts`, import: `./${entryName(entry)}.js`}])),
            "./build": {types: "./build.d.ts", import: "./build.js"},
        },
        peerDependencies: peers,
        // 构建预设用的 Vite 8 要求的 Node 版本。
        // 构建与生成只要 Vite 要求的版本，但包里的实现（例如插件状态）用了 Node 22 起才有的 `Promise.withResolvers`，
        // 写测试时会执行到它。
        engines: {node: ">=22.12.0"},
        dependencies: await dependencyRanges(BUILD_DEPENDENCIES),
    }, null, 4)}\n`);
    await writeAuthorDocs(outDir);
}

if (import.meta.main) {
    const target = resolve(process.argv[2] ?? join(packageRoot, "dist/plugin-sdk"));
    await buildSdk(target);
    console.log(`插件 SDK 已生成：${target}`);
}
