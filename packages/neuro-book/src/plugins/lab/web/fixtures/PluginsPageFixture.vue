<script setup lang="ts">
/**
 * PluginsPage 的 Lab 场景：`nbook.plugins/registry` 的客户端是内存里的插件表，按场景摆出列表的各种状态。写操作照常改这张
 * 表并记进事件 tab；安装总是预览为首次安装 `example.new`（“pending”场景预览为升级、“downgrade”场景为降级）。
 */
import {computed} from "vue";

import type {InstallPreview, PluginListItem, PluginsRegistry} from "nbook/plugins/plugins/shared/contracts";
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
        third("example.hello", "1.0.0", {pending: [{kind: "upgrade", version: "1.10.0-beta.3"}]}),
        third("example.notes-lite", "0.2.0", {pending: [{kind: "install"}]}),
        third("example.quiet", "2.1.0", {state: "disabled", pending: [{kind: "disable"}]}),
        third("example.gone", "1.0.0", {state: "uninstalling", pending: [{kind: "uninstall"}]}),
    ],
    "not-loaded": [
        third("example.broken", "1.0.0", {notLoaded: {code: "manifest-invalid", detail: "入口文件不存在：dist/browser.js"}}),
        third("example.future", "3.0.0", {notLoaded: {code: "incompatible-engine", detail: "要求 NeuroBook >=2.0.0，当前是 0.1.0"}}),
        third("example.panel", "1.2.0", {notLoaded: {code: "entries-not-loaded", detail: ""}}),
    ],
    "safe-mode": [third("example.hello", "1.0.0", {notLoaded: {code: "safe-mode", detail: ""}})],
    "long": [third("acme-really-long-publisher.an-extremely-long-plugin-name-for-overflow", "12.340.5678-beta.10", {pending: [{kind: "upgrade", version: "12.341.0"}]})],
    "downgrade": [third("example.hello", "1.0.0")],
    "english": [third("example.hello", "1.0.0", {pending: [{kind: "upgrade", version: "1.10.0-beta.3"}]})],
};

const PREVIEW: Readonly<Record<string, InstallPreview>> = {
    pending: {id: "example.hello", version: "1.1.0", installed: "1.0.0", relation: "upgrade"},
    downgrade: {id: "example.hello", version: "0.9.0", installed: "1.0.0", relation: "downgrade"},
};

let plugins: PluginListItem[] = [...(THIRD_PARTY[props.scene] ?? []), ...BUILTIN];
const set = (item: PluginListItem): PluginListItem => {
    plugins = plugins.some((plugin) => plugin.id === item.id) ? plugins.map((plugin) => (plugin.id === item.id ? item : plugin)) : [item, ...plugins];
    return item;
};
const find = (id: string): PluginListItem => plugins.find((plugin) => plugin.id === id)!;

const client = {
    list: () => {
        record("list", {});
        // “loading”场景的读取永不结算，摆出加载指示；“failed”场景读不了登记表。
        if (props.scene === "loading") return new Promise(() => undefined);
        if (props.scene === "failed") return Promise.resolve({ok: false as const, code: "registry-failed" as const, detail: {detail: "插件登记表不是合法 JSON"}});
        return Promise.resolve({ok: true as const, value: {safeMode: props.scene === "safe-mode", plugins}});
    },
    inspect: async ({path}: {path: string}) => {
        record("inspect", {path});
        return {ok: true as const, value: PREVIEW[props.scene] ?? {id: "example.new", version: "1.0.0", installed: null, relation: "install" as const}};
    },
    install: async ({path}: {path: string}) => {
        record("install", {path});
        return {ok: true as const, value: {plugin: set(third("example.new", "1.0.0", {pending: [{kind: "install"}]}))}};
    },
    enable: async ({id}: {id: string}) => {
        record("enable", {id});
        return {ok: true as const, value: {plugin: set({...find(id), state: "enabled", pending: []})}};
    },
    disable: async ({id}: {id: string}) => {
        record("disable", {id});
        return {ok: true as const, value: {plugin: set({...find(id), state: "disabled", pending: [{kind: "disable"}]})}};
    },
    uninstall: async ({id}: {id: string}) => {
        record("uninstall", {id});
        return {ok: true as const, value: {plugin: set({...find(id), state: "uninstalling", pending: [{kind: "uninstall"}]})}};
    },
};
// 内存替身只实现页面用到的方法；类型按合同客户端核对输入输出的形状。
const registry = client as unknown as PluginsRegistry;
const bindings = computed(() => subject.bindings.value);
</script>

<template>
    <PluginsPage v-bind="bindings" :registry="registry" data-lab-subject />
</template>
