<script setup lang="ts">
/**
 * PluginsPage 的 Lab 场景：`nbook.plugins/registry` 的客户端是内存里的插件表，按场景摆出列表的各种状态。写操作照常改这张
 * 表并记进事件 tab；安装总是预览为首次安装 `example.new`（“pending”场景预览为升级、“downgrade”场景为降级、“blocked”场景
 * 为升级并列出重启后受阻的插件）。“write-failed”场景的写操作都以带出错字段的“清单无效”失败，“version-in-use”场景的写操作
 * 以“版本还被别的服务端用着”失败，“busy”场景的写操作永不结算。场景名带 `-english` 的是同一场景的英文界面。
 */
import {computed} from "vue";

import type {InstallPreview, PluginFailureCode, PluginListItem, PluginsRegistry} from "nbook/plugins/plugins/shared/contracts";
import PluginsPage from "nbook/plugins/plugins/web/components/PluginsPage.vue";

import {useLabEventSink} from "../lab-event-sink";
import {useLabSubject} from "../lab-subject";
import type {LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const record = useLabEventSink();
const subject = useLabSubject<typeof PluginsPage>(() => props.input, []);

const BUILTIN: PluginListItem[] = ["nbook.commands", "nbook.editor", "nbook.explorer", "nbook.plugins", "nbook.settings", "nbook.workbench"]
    .map((id) => ({id, version: "0.1.0", source: "builtin", state: "enabled", pending: [], notLoaded: null}));
const third = (id: string, version: string, extra: Partial<PluginListItem> = {}): PluginListItem => ({id, version, source: "third-party", state: "enabled", pending: [], notLoaded: null, ...extra});

/** 场景 → 第三方插件。 */
const THIRD_PARTY: Readonly<Record<string, PluginListItem[]>> = {
    "empty": [],
    "pending": [
        third("example.gone", "1.0.0", {state: "uninstalling", pending: [{kind: "uninstall"}]}),
        third("example.hello", "1.0.0", {pending: [{kind: "upgrade", version: "1.10.0-beta.3"}]}),
        third("example.notes-lite", "0.2.0", {pending: [{kind: "install"}]}),
        third("example.quiet", "2.1.0", {state: "disabled", pending: [{kind: "disable"}]}),
    ],
    "not-loaded": [
        third("example.broken", "1.0.0", {notLoaded: {code: "manifest-invalid", detail: "入口文件不存在：dist/browser.js"}}),
        third("example.future", "3.0.0", {notLoaded: {code: "incompatible-engine", detail: "要求 NeuroBook >=2.0.0，当前是 0.1.0"}}),
    ],
    "safe-mode": [third("example.hello", "1.0.0", {notLoaded: {code: "safe-mode", detail: ""}})],
    "long": [third("acme-really-long-publisher.an-extremely-long-plugin-name-for-overflow", "12.340.5678-beta.10", {pending: [{kind: "upgrade", version: "12.341.0-beta.10+build.20261017.sha.abcdef"}]})],
    "downgrade": [third("example.hello", "1.0.0")],
    "blocked": [third("example.reader", "1.0.0"), third("example.panel", "1.0.0"), third("example.tts", "1.0.0")],
    "english": [third("example.hello", "1.0.0", {pending: [{kind: "upgrade", version: "1.10.0-beta.3"}]})],
    "write-failed": [third("example.hello", "1.0.0")],
    "version-in-use": [third("example.hello", "1.0.0")],
    "busy": [third("example.hello", "1.0.0"), third("example.quiet", "2.1.0")],
};

const PREVIEW: Readonly<Record<string, InstallPreview>> = {
    pending: {id: "example.hello", version: "1.1.0", installed: "1.0.0", relation: "upgrade", blocked: [], unchecked: []},
    downgrade: {id: "example.hello", version: "0.9.0", installed: "1.0.0", relation: "downgrade", blocked: [], unchecked: []},
    blocked: {
        id: "example.tts",
        version: "2.0.0",
        installed: "1.0.0",
        relation: "upgrade",
        blocked: [{plugin: "example.panel", entries: ["main"], reason: "provider-blocked"}, {plugin: "example.reader", entries: ["main", "ui"], reason: "version-mismatch", range: "^1.0.0"}],
        unchecked: ["example.broken"],
    },
};

/** 去掉 `-english` 后缀的场景名：英文界面的场景与中文的用同一份数据。 */
const base = props.scene.replace(/-english$/u, "");
let plugins: PluginListItem[] = [...(THIRD_PARTY[base] ?? []), ...BUILTIN];
const set = (item: PluginListItem): PluginListItem => {
    // 与服务端一样按 id 排序。
    plugins = (plugins.some((plugin) => plugin.id === item.id) ? plugins.map((plugin) => (plugin.id === item.id ? item : plugin)) : [...plugins, item]).sort((left, right) => (left.id < right.id ? -1 : 1));
    return item;
};
const find = (id: string): PluginListItem => plugins.find((plugin) => plugin.id === id)!;

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);
/** “write-failed”“version-in-use”“busy”场景的写操作结果；其余场景为 null，照常改内存里的表。 */
const failing = (): Promise<{ok: false; code: PluginFailureCode; detail: {detail: string; problems?: string[]}}> | null => {
    if (base === "busy") return never();
    if (base === "write-failed") return Promise.resolve({ok: false, code: "manifest-invalid", detail: {detail: "清单有错误", problems: ["entries.ui.main：入口文件必须在插件目录里", "contributes.0.id：必须以插件 id 开头"]}});
    if (base === "version-in-use") return Promise.resolve({ok: false, code: "version-in-use", detail: {detail: "还有运行中的服务端（也可能就是这一个）在用 example.hello@1.0.0 的旧目录，关掉或重启它之后再装"}});
    return null;
};

// 类型标注让替身按合同客户端核对每个方法的输入与输出。
const registry: PluginsRegistry = {
    list: () => {
        record("list", {});
        // “loading”场景的读取永不结算，摆出加载指示；“failed”场景读不了登记表。
        if (props.scene === "loading") return never();
        if (props.scene === "failed") return Promise.resolve({ok: false as const, code: "registry-failed" as const, detail: {detail: "插件登记表不是合法 JSON"}});
        return Promise.resolve({ok: true as const, value: {safeMode: props.scene === "safe-mode", plugins}});
    },
    inspect: async ({path}: {path: string}) => {
        record("inspect", {path});
        return {ok: true as const, value: PREVIEW[base] ?? {id: "example.new", version: "1.0.0", installed: null, relation: "install" as const, blocked: [], unchecked: []}};
    },
    install: async ({path}: {path: string}) => {
        record("install", {path});
        return failing() ?? {ok: true as const, value: {plugin: set(third("example.new", "1.0.0", {pending: [{kind: "install"}]}))}};
    },
    enable: async ({id}: {id: string}) => {
        record("enable", {id});
        return failing() ?? {ok: true as const, value: {plugin: set({...find(id), state: "enabled", pending: []})}};
    },
    disable: async ({id}: {id: string}) => {
        record("disable", {id});
        return failing() ?? {ok: true as const, value: {plugin: set({...find(id), state: "disabled", pending: [{kind: "disable"}]})}};
    },
    uninstall: async ({id}: {id: string}) => {
        record("uninstall", {id});
        return failing() ?? {ok: true as const, value: {plugin: set({...find(id), state: "uninstalling", pending: [{kind: "uninstall"}]})}};
    },
};
const bindings = computed(() => subject.bindings.value);
</script>

<template>
    <PluginsPage v-bind="bindings" :registry="registry" data-lab-subject />
</template>
