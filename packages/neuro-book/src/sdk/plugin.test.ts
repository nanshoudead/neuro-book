/**
 * 作者 API 的根入口与不碰 Vue 的助手（docs/specs/runtime/plugin-api.md 的“作者 API”）：`definePlugin` 与 `section`、`setting`、
 * `command` 拼出的 id、短名的校验、文字与缺省值、命令参数的规则、插件描述与定义的组装；入口在真实内核里激活，助手的实现
 * 与 `rawContributions` 合成内核的贡献、接收者照收，助手带的激活事件并入。编译期的反例写在文件末尾，`bun run typecheck` 检查它们编译不过。
 */

import {afterEach, describe, expect, it} from "bun:test";

import type {Application} from "@notnotype/nb-runtime/application";
import type {ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import {Type} from "typebox";

import {createApplication} from "nbook/application";
import {COMMANDS_POINT} from "nbook/plugins/commands/shared/contracts";

import {command} from "./command-helpers";
import {definePlugin, remoteService} from "./plugin";
import {section, setting} from "./settings-helpers";

const plugin = definePlugin({id: "acme.hello", version: "1.0.0", locations: ["server"]});

const started: Application[] = [];

afterEach(async () => {
    for (const application of started.splice(0)) await application.stop();
});

async function start(definitions: Parameters<typeof createApplication>[1]["plugins"]): Promise<Application> {
    const application = createApplication({identity: {location: "server", instanceId: "author-api"}, stopSignal: new AbortController().signal, emergency: () => undefined}, {plugins: definitions, gates: []});
    started.push(application);
    await application.startup;
    return application;
}

describe("definePlugin", () => {
    it("贡献 id 是插件 id 加短名；文字写一个字符串时两种语言相同；分区的 category 缺省 plugins", () => {
        const main = section(plugin, {name: "main", title: "你好", icon: "i-lucide-hand", groups: [{id: "basic", title: {"zh-CN": "基本", "en-US": "Basic"}}]});
        expect(main.id).toBe("acme.hello.main");
        expect(main.contribution.declaration).toEqual({title: {"zh-CN": "你好", "en-US": "你好"}, icon: "i-lucide-hand", category: "plugins", groups: [{id: "basic", title: {"zh-CN": "基本", "en-US": "Basic"}}]});
        const greeting = setting(plugin, {name: "greeting", schema: Type.String(), default: "hi", title: "问候语", section: main, group: "basic"});
        expect(greeting.key).toBe("acme.hello/greeting");
        expect(greeting.declaration).toMatchObject({title: {"zh-CN": "问候语", "en-US": "问候语"}, section: "acme.hello.main", group: "basic"});
        expect(plugin.descriptor([main, greeting])).toEqual({id: "acme.hello", version: "1.0.0", locations: ["server"], contributions: [main.contribution, greeting.contribution]});
    });

    it("短名不合贡献点的规则时加载即抛错，写明是哪一个（大写与空格在编辑器里就报，加载时照样核对）", () => {
        // @ts-expect-error 短名只用小写
        expect(() => section(plugin, {name: "My Section", title: "x", icon: "i-lucide-x"})).toThrow("My Section");
        // @ts-expect-error 短名只用小写
        expect(() => command(plugin, {name: "Say", title: "x", description: "x", effect: "read"})).toThrow("Say");
        // 命令的一段可以数字开头，分区不可以。
        expect(command(plugin, {name: "2x", title: "x", description: "x", effect: "read"}).id).toBe("acme.hello.2x");
        expect(() => section(plugin, {name: "2x", title: "x", icon: "i-lucide-x"})).toThrow("2x");
    });

    it("命令的 args 缺省为空对象、没写 additionalProperties 的补成 false；有必填参数而人能从面板执行时抛错", () => {
        const plain = command(plugin, {name: "plain", title: "x", description: "x", effect: "read"});
        expect(plain.contribution.declaration.args).toMatchObject({type: "object", additionalProperties: false});
        const optional = Type.Object({words: Type.Optional(Type.Integer())});
        const loose = command(plugin, {name: "loose", title: "x", description: "x", effect: "write", args: optional});
        expect(loose.contribution.declaration.args).toMatchObject({additionalProperties: false});
        expect("additionalProperties" in optional).toBe(false);
        // @ts-expect-error 有必填参数又给人用：编辑器里就报
        expect(() => command(plugin, {name: "needs", title: "x", description: "x", effect: "write", args: Type.Object({words: Type.Integer()})})).toThrow("命令面板不收集参数");
        // 没有 required，但空对象过不了校验：同样抛错。
        expect(() => command(plugin, {name: "few", title: "x", description: "x", effect: "write", args: Type.Object({words: Type.Optional(Type.Integer())}, {minProperties: 1})})).toThrow("收不下空对象");
        expect(command(plugin, {name: "agent-only", title: "x", description: "x", effect: "write", args: Type.Object({words: Type.Integer()}), expose: {human: false}}).id).toBe("acme.hello.agent-only");
        expect(() => command(plugin, {name: "open", title: "x", description: "x", effect: "read", args: Type.Object({}, {additionalProperties: true})})).toThrow("additionalProperties");
    });

    it("入口 id 缺省取运行位置名；同一插件两个入口同 id 时组装抛错", () => {
        const server = plugin.entry({location: "server", activate: () => ({})});
        expect(server.id).toBe("server");
        expect(() => plugin.definition([server, plugin.entry({location: "server", activate: () => ({})})])).toThrow("server");
        expect(plugin.definition([server, plugin.entry({id: "worker", location: "server", activate: () => ({})})]).entries.map((entry) => entry.id)).toEqual(["server", "worker"]);
    });

    it("在真实内核里：助手的实现与 rawContributions 合成内核的贡献，接收者照收；助手带的激活事件并入", async () => {
        // 拥有者：定义一个贡献点并接收（menu 示例的写法）。
        const owner = definePlugin({id: "acme.menu", version: "1.0.0", locations: ["server"]});
        const received: string[] = [];
        const receiver: ContributionReceiver = {
            published: (handle: ContributionHandle) => void received.push(`${handle.id}=${String((handle.implementation() as {label: string}).label)}`),
            revoke: () => undefined,
        };
        const menuDefinition = owner.definition({
            contributionPoints: [{id: "acme.menu.items", implementation: "required", idPrefix: "plugin"}],
            entries: [owner.entry({location: "server", activationEvents: ["onStartup"], receives: ["acme.menu.items"], activate: () => ({receivers: {"acme.menu.items": receiver}})})],
        });
        // 贡献方：一条命令（助手）与一项菜单（原始声明，file-menu 示例的写法）。
        const say = command(plugin, {name: "say", title: "打招呼", description: "Say hello", effect: "write"});
        // 设置页、选项来源这类助手带激活事件（在 `/settings/browser`）；这里给命令助手补一个，看并入的结果。
        const lazy = {...command(plugin, {name: "lazy", title: "x", description: "x", effect: "read"}), activationEvents: ["onLazy:acme"]};
        const entry = plugin.entry({
            location: "server",
            activationEvents: ["onStartup"],
            contributions: {say, lazy},
            rawContributions: [{capability: "acme.menu.items", id: "acme.hello.open", declaration: {}}],
            activate: () => ({
                contributions: {say: say.implement(() => ({ok: true, value: "hi"})), lazy: lazy.implement(() => ({ok: true, value: null}))},
                rawContributions: {"acme.menu.items": {"acme.hello.open": {label: "打开"}}},
            }),
        });
        expect(entry.activationEvents).toEqual(["onStartup", "onLazy:acme"]);
        expect(entry.contributions?.map((item) => `${item.capability}/${item.id}`)).toEqual(["commands.definitions/acme.hello.say", "commands.definitions/acme.hello.lazy", "acme.menu.items/acme.hello.open"]);
        const application = await start([menuDefinition, plugin.definition([entry])]);
        expect(application.plugins.entryState({plugin: "acme.hello", entry: "server"})).toMatchObject({status: "available"});
        expect(received).toEqual(["acme.hello.open=打开"]);
        const said = application.plugins.contribution(COMMANDS_POINT, "acme.hello.say")[0];
        expect(said?.validation.status).not.toBe("rejected");
    });
});

/** 编译期的反例：不调用，只给类型检查看。 */
export function typeChecks(): void {
    const say = command(plugin, {name: "say", title: "x", description: "x", effect: "write"});
    const ping = command(plugin, {name: "ping", title: "x", description: "x", effect: "read"});
    // 漏写一项。
    plugin.entry({location: "server", contributions: {say, ping}, activate: () => ({
        // @ts-expect-error ping 的实现没写
        contributions: {say: say.implement(() => ({ok: true, value: null}))},
    })});
    // 换错助手。
    plugin.entry({location: "server", contributions: {say, ping}, activate: () => ({contributions: {
        say: say.implement(() => ({ok: true, value: null})),
        // @ts-expect-error ping 的位置交了 say 的实现
        ping: say.implement(() => ({ok: true, value: null})),
    }})});
    // 多写一项。
    // @ts-expect-error 产出里多了 extra
    plugin.entry({location: "server", contributions: {say}, activate: () => ({contributions: {say: say.implement(() => ({ok: true, value: null})), extra: ping.implement(() => ({ok: true, value: null}))}})});
    // 设置项的 group 只能是那个分区的组。
    const main = section(plugin, {name: "main", title: "x", icon: "i-lucide-x", groups: [{id: "basic", title: "x"}]});
    // @ts-expect-error 分区 main 没有 advanced 这一组
    setting(plugin, {name: "x", schema: Type.String(), default: "", title: "x", section: main, group: "advanced"});
    // async 的 activate 照样核对。
    plugin.entry({location: "server", contributions: {say}, activate: async () => ({contributions: {say: say.implement(async () => ({ok: true, value: null}))}})});
    // 设置项名用小驼峰。
    // @ts-expect-error 设置项名不能有连字符
    setting(plugin, {name: "daily-goal", schema: Type.Integer(), default: 0, title: "x"});
    // `require` 只收入口 `dependencies` 里声明的必需服务；可选依赖用 `resolve`。
    const clockKey = defineServiceKey<{now(): number}>("acme.hello/clock");
    const otherKey = defineServiceKey<{other(): void}>("acme.hello/other");
    plugin.entry({location: "server", dependencies: [{key: clockKey}, {key: otherKey, required: false}], activate: (context) => {
        context.services.require(clockKey).now();
        // @ts-expect-error 可选依赖不能 require
        context.services.require(otherKey);
        void context.services.resolve(otherKey);
        return {};
    }});
    plugin.entry({location: "server", activate: (context) => {
        // @ts-expect-error 入口没有声明任何依赖
        context.services.require(clockKey);
        return {};
    }});
    // 产出了远程服务却没声明 remoteProvides：报错写着去声明它。
    const contract = remoteService(plugin, {name: "echo", version: 1, provider: "server", callers: ["browser"], methods: {get: {input: Type.Object({}), output: Type.String(), effect: "read"}}});
    // @ts-expect-error 入口没有声明 remoteProvides
    plugin.entry({location: "server", activate: async () => ({remote: [provideRemote(contract, () => ({methods: {get: () => ({ok: true, value: "x"})}}))]})});
    plugin.entry({location: "server", remoteProvides: [contract], activate: async () => ({remote: [provideRemote(contract, () => ({methods: {get: () => ({ok: true, value: "x"})}}))]})});
    // @ts-expect-error 合同短名只用小写
    remoteService(plugin, {name: "Echo", version: 1, provider: "server", callers: ["browser"], methods: {}});
}
