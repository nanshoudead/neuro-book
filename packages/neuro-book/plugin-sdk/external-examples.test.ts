/**
 * 示例插件外置运行（docs/specs/runtime/plugin-code-loading.md 输出 1、3，plugin-manifest.md 输出 3，验收 1）：clock、notes、
 * counter 经构建预设构建成插件目录，再按清单登记、入口激活时由服务端与项目实例的装载器取回代码，装进示例场地（真实的内置
 * 插件、远程路由与窗口）。核对外置之后的行为与源码装配时相同：窗口经远程服务调用服务端入口、可选依赖跨第三方插件解析、
 * 命令可执行、`@vue/reactivity` 与宿主是同一份（counter 的公开键随计数变化）、项目入口按项目各一份。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {readFile, rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {counterContract, projectCounterContract, RESET_COMMAND} from "./examples/plugins/counter/shared/contracts";
import {notesContract} from "./examples/plugins/notes/shared/contracts";
import {remoteProbe, serviceProbe} from "./examples/testing/probes";
import {Stage} from "./examples/testing/stage";
import type {InstalledPlugin} from "../src/plugin-platform/backend/installed";
import {serverHostModules} from "../src/backend/plugin-host-modules";
import {thirdPartyDefinitionsAt} from "../src/plugin-platform/backend/loader";
import {NEUROBOOK_PROFILE} from "../src/plugin-platform-profile";
import {commandServiceKey} from "../src/plugins/commands/shared/contracts";
import {buildExample} from "./build-examples";

const SERVER_LOADER = {profile: NEUROBOOK_PROFILE, hostModules: serverHostModules};

let tmp = "";
let installed: InstalledPlugin[] = [];
const stages: Stage[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-external-examples", "external-examples");
    for (const name of ["clock", "notes", "counter"]) {
        const root = join(tmp, "plugins", name);
        await buildExample(name, root);
        const manifest: unknown = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
        installed.push({id: `example.${name}`, version: "0.1.0", root, digest: name, manifest});
    }
}, 120_000);

afterEach(async () => {
    for (const stage of stages.splice(0)) {
        for (const result of await stage.close()) expect(result).toEqual({status: "closed"});
    }
});

afterAll(async () => {
    installed = [];
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

function newStage(): Stage {
    const stage = new Stage(join(tmp, `stage-${String(stages.length)}-${String(Date.now())}`));
    stages.push(stage);
    return stage;
}

describe("外置的示例插件", () => {
    it("窗口经远程服务调用外置的服务端入口；notes 的可选依赖解析到外置的 clock；counter 的命令可执行、公开键随计数变化", async () => {
        const stage = newStage();
        const seen: Array<{readonly event: string}> = [];
        // 探针站在执行命令的插件（例如命令面板）的位置上，经同步的命令服务查询命令是否可用。
        const shell = serviceProbe("example.shell", "server", [commandServiceKey]);
        const {router} = await stage.server({plugins: [...thirdPartyDefinitionsAt("server", installed, [], (input) => seen.push(input), SERVER_LOADER), shell.definition]});
        expect(seen).toEqual([]);
        const panel = remoteProbe("example.panel", "browser");
        await stage.window(router, "window-1", {plugins: [panel.definition]});

        // clock 在场：笔记带宿主时钟的时刻（场地的时钟从 0 起）。
        expect(await panel.remote().use(notesContract).add({text: "外置的笔记"})).toEqual({ok: true, value: {text: "外置的笔记", writtenAt: 0, via: null}});

        const counter = panel.remote().use(counterContract);
        const commands = shell.get(commandServiceKey);
        expect(commands.isEnabled(RESET_COMMAND)).toEqual({ok: false, code: "unavailable", reason: "计数已经是 0"});
        expect(await counter.increment({by: 3})).toEqual({ok: true, value: 3});
        // 命令的 `when` 读公开键，公开键由插件代码里的 `computed` 派生：两份 `@vue/reactivity` 时这里不会变。
        expect(commands.isEnabled(RESET_COMMAND)).toEqual({ok: true, value: true});
        expect(await commands.execute(RESET_COMMAND, {})).toEqual({ok: true, value: null});
        expect(await counter.current({})).toEqual({ok: true, value: 0});
    }, 60_000);

    it("项目入口在每个项目实例里各一份，第一次调用时才装载、激活", async () => {
        const stage = newStage();
        const {router} = await stage.server({plugins: thirdPartyDefinitionsAt("server", installed, [], () => undefined, SERVER_LOADER)});
        const alpha = await stage.project(router, "alpha", {plugins: thirdPartyDefinitionsAt("project", installed, [], () => undefined, SERVER_LOADER)});
        await stage.project(router, "beta", {plugins: thirdPartyDefinitionsAt("project", installed, [], () => undefined, SERVER_LOADER)});
        const inAlpha = remoteProbe("example.panel", "browser");
        await stage.window(router, "window-a", {plugins: [inAlpha.definition], project: "alpha"});
        const inBeta = remoteProbe("example.panel", "browser");
        await stage.window(router, "window-b", {plugins: [inBeta.definition], project: "beta"});
        const entry = {plugin: "example.counter", entry: "project"};
        expect(alpha.plugins.entryState(entry)?.status).toBe("registered");
        expect(await inAlpha.remote().use(projectCounterContract).increment({by: 1})).toEqual({ok: true, value: 1});
        expect(await inBeta.remote().use(projectCounterContract).increment({by: 5})).toEqual({ok: true, value: 5});
        expect(await inAlpha.remote().use(projectCounterContract).current({})).toEqual({ok: true, value: 1});
        expect(alpha.plugins.entryState(entry)?.status).toBe("available");
    }, 60_000);
});
