<script setup lang="ts">
/**
 * 设置窗口的插件页（同名 .md）：列出内置与第三方插件，从本地文件夹安装，启用、禁用与卸载；全部在下一次启动生效
 * （docs/specs/runtime/plugin-install.md 输出 1–4、7–9）。
 */
import {Badge, Banner, Button, Dialog, FormInput, Switch} from "@notnotype/nb-ui/components";
import {computed, onMounted, ref} from "vue";

import type {RemoteClient} from "@notnotype/nb-runtime/remote";

import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import type {PendingChange, PluginListItem, pluginsRegistryContract} from "../shared/contracts";

defineOptions({name: "PluginsPage"});

const props = defineProps<{
    registry: RemoteClient<typeof pluginsRegistryContract>;
    locale: DisplayLocale;
}>();

const TEXT = {
    restartNote: {"zh-CN": "安装、卸载、升级、启用与禁用在下一次启动后生效。", "en-US": "Installing, uninstalling, upgrading, enabling and disabling take effect the next time NeuroBook starts."},
    pendingNote: {"zh-CN": "有待生效的变化，重启 NeuroBook 后生效。", "en-US": "Some changes are pending. Restart NeuroBook to apply them."},
    safeMode: {"zh-CN": "安全模式：第三方插件没有加载。可以在这里禁用或卸载它们。", "en-US": "Safe mode: third-party plugins are not loaded. You can disable or uninstall them here."},
    loading: {"zh-CN": "正在读取插件…", "en-US": "Loading plugins…"},
    pathLabel: {"zh-CN": "插件文件夹", "en-US": "Plugin folder"},
    pathPlaceholder: {"zh-CN": "服务端上含有 package.json 的文件夹路径", "en-US": "Path of a folder on the server that contains package.json"},
    install: {"zh-CN": "安装…", "en-US": "Install…"},
    installTitle: {"zh-CN": "安装插件", "en-US": "Install plugin"},
    trust: {"zh-CN": "插件完全受信任：安装后它可以访问全部作品、服务器与本机资源。只安装你信任的来源。", "en-US": "Plugins are fully trusted: once installed, a plugin can access all books, the server and local resources. Only install plugins you trust."},
    confirmInstall: {"zh-CN": "安装", "en-US": "Install"},
    cancel: {"zh-CN": "取消", "en-US": "Cancel"},
    uninstall: {"zh-CN": "卸载", "en-US": "Uninstall"},
    uninstallTitle: {"zh-CN": "卸载插件", "en-US": "Uninstall plugin"},
    uninstallBody: {"zh-CN": "卸载 {id}？重启后删除插件的安装目录，配置与私有数据保留。", "en-US": "Uninstall {id}? Its install folder is removed after restart; its settings and private data are kept."},
    toggle: {"zh-CN": "启用 {id}", "en-US": "Enable {id}"},
    builtin: {"zh-CN": "内置", "en-US": "Built-in"},
    thirdPartyHeading: {"zh-CN": "第三方插件", "en-US": "Third-party plugins"},
    builtinHeading: {"zh-CN": "内置插件", "en-US": "Built-in plugins"},
    noThirdParty: {"zh-CN": "还没有安装第三方插件。", "en-US": "No third-party plugins installed."},
    failed: {"zh-CN": "{reason}（{code}）{detail}", "en-US": "{reason} ({code}){detail}"},
} satisfies Record<string, LocalizedText>;

const PENDING_TEXT: Record<PendingChange["kind"], LocalizedText> = {
    install: {"zh-CN": "重启后安装", "en-US": "Installs after restart"},
    uninstall: {"zh-CN": "重启后卸载", "en-US": "Uninstalls after restart"},
    enable: {"zh-CN": "重启后启用", "en-US": "Enabled after restart"},
    disable: {"zh-CN": "重启后禁用", "en-US": "Disabled after restart"},
    upgrade: {"zh-CN": "重启后升级到 {version}", "en-US": "Upgrades to {version} after restart"},
};

const NOT_LOADED_TEXT: Record<NonNullable<PluginListItem["notLoaded"]>["code"], LocalizedText> = {
    "manifest-invalid": {"zh-CN": "清单无效", "en-US": "Invalid manifest"},
    "incompatible-engine": {"zh-CN": "不兼容", "en-US": "Incompatible"},
    "safe-mode": {"zh-CN": "安全模式未加载", "en-US": "Not loaded in safe mode"},
    "entries-not-loaded": {"zh-CN": "只加载了声明", "en-US": "Declarations only"},
};

/** 业务失败码（plugin-install 的失败码表）与常见的路由层失败码；其余码只显示码本身。 */
const FAILURE_TEXT: Record<string, LocalizedText> = {
    "manifest-invalid": {"zh-CN": "插件的清单无效", "en-US": "The plugin manifest is invalid"},
    "reserved-id": {"zh-CN": "第三方插件的 id 不能以 nbook. 开头", "en-US": "Third-party plugin ids cannot start with nbook."},
    "incompatible-engine": {"zh-CN": "插件与当前版本的 NeuroBook 不兼容", "en-US": "The plugin is not compatible with this version of NeuroBook"},
    "already-installed": {"zh-CN": "已经安装了这个版本", "en-US": "This version is already installed"},
    "uninstall-pending": {"zh-CN": "插件正在卸载，重启后再操作", "en-US": "The plugin is being uninstalled; restart first"},
    "path-rejected": {"zh-CN": "路径不能用", "en-US": "The path cannot be used"},
    "entry-missing": {"zh-CN": "插件缺少入口文件", "en-US": "The plugin is missing entry files"},
    "copy-failed": {"zh-CN": "复制插件文件失败", "en-US": "Copying the plugin files failed"},
    "not-installed": {"zh-CN": "没有安装这个插件", "en-US": "This plugin is not installed"},
    "builtin-fixed": {"zh-CN": "内置插件不能这样操作", "en-US": "Built-in plugins cannot be changed"},
    "registry-failed": {"zh-CN": "读写插件登记表失败", "en-US": "Reading or writing the plugin registry failed"},
    unavailable: {"zh-CN": "连不上服务端", "en-US": "The server is unreachable"},
    timeout: {"zh-CN": "服务端没有及时答复", "en-US": "The server did not answer in time"},
    "unknown-outcome": {"zh-CN": "结果未知，刷新后再看", "en-US": "The outcome is unknown; reload to check"},
};

type Failure = {readonly ok: false; readonly code: string; readonly detail?: unknown};

const text = (value: LocalizedText): string => localize(value, props.locale);

const items = ref<ReadonlyArray<PluginListItem>>([]);
const safeMode = ref(false);
const loading = ref(true);
const busy = ref(false);
const problem = ref<{readonly code: string; readonly message: string} | null>(null);
const path = ref("");
const confirmingInstall = ref(false);
const uninstalling = ref<PluginListItem | null>(null);

const hasPending = computed(() => items.value.some((item) => item.pending.length > 0));
/** 第三方插件在前：它们才有操作；内置插件随产品，放在后面。 */
const groups = computed(() => [
    {key: "third-party", heading: TEXT.thirdPartyHeading, items: items.value.filter((item) => item.source === "third-party")},
    {key: "builtin", heading: TEXT.builtinHeading, items: items.value.filter((item) => item.source === "builtin")},
]);

function report(failure: Failure): void {
    const detail = typeof failure.detail === "object" && failure.detail !== null && "detail" in failure.detail && typeof failure.detail.detail === "string" ? failure.detail.detail : "";
    const problems = typeof failure.detail === "object" && failure.detail !== null && "problems" in failure.detail && Array.isArray(failure.detail.problems) ? failure.detail.problems.map(String) : [];
    const reason = FAILURE_TEXT[failure.code];
    const suffix = [detail, ...problems].filter((line) => line !== "").join("；");
    problem.value = {
        code: failure.code,
        message: localize(formatText(TEXT.failed, {reason: reason === undefined ? "" : text(reason), code: failure.code, detail: suffix === "" ? "" : `：${suffix}`}), props.locale),
    };
}

async function refresh(): Promise<void> {
    const result = await props.registry.list({});
    loading.value = false;
    if (!result.ok) {
        report(result);
        return;
    }
    items.value = result.value.plugins;
    safeMode.value = result.value.safeMode;
}

function replace(item: PluginListItem): void {
    items.value = items.value.map((current) => (current.id === item.id ? item : current));
}

async function install(): Promise<void> {
    const source = path.value.trim();
    if (source === "" || busy.value) return;
    busy.value = true;
    const result = await props.registry.install({path: source});
    busy.value = false;
    confirmingInstall.value = false;
    if (!result.ok) {
        report(result);
        return;
    }
    problem.value = null;
    path.value = "";
    await refresh();
}

async function toggle(item: PluginListItem, enabled: boolean): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    const result = enabled ? await props.registry.enable({id: item.id}) : await props.registry.disable({id: item.id});
    busy.value = false;
    if (!result.ok) {
        report(result);
        return;
    }
    problem.value = null;
    replace(result.value.plugin);
}

async function uninstall(): Promise<void> {
    const item = uninstalling.value;
    if (item === null || busy.value) return;
    busy.value = true;
    const result = await props.registry.uninstall({id: item.id});
    busy.value = false;
    uninstalling.value = null;
    if (!result.ok) {
        report(result);
        return;
    }
    problem.value = null;
    replace(result.value.plugin);
}

function pendingText(change: PendingChange): string {
    return change.kind === "upgrade" ? localize(formatText(PENDING_TEXT.upgrade, {version: change.version}), props.locale) : text(PENDING_TEXT[change.kind]);
}

onMounted(() => {
    void refresh();
});
</script>

<template>
    <div class="plugins-page" data-plugins-page>
        <Banner :tone="hasPending ? 'warning' : 'info'" :message="text(hasPending ? TEXT.pendingNote : TEXT.restartNote)" data-plugins-restart />
        <Banner v-if="safeMode" tone="warning" :message="text(TEXT.safeMode)" data-plugins-safe-mode />

        <section class="plugins-page__install">
            <label class="plugins-page__label" for="nbook-plugins-path">{{ text(TEXT.pathLabel) }}</label>
            <div class="plugins-page__install-row">
                <FormInput id="nbook-plugins-path" v-model="path" :placeholder="text(TEXT.pathPlaceholder)" data-plugin-path />
                <Button :disabled="path.trim() === '' || busy" data-plugin-install @click="confirmingInstall = true">{{ text(TEXT.install) }}</Button>
            </div>
        </section>

        <p v-if="problem !== null" class="plugins-page__problem" role="status" :data-plugin-problem="problem.code">{{ problem.message }}</p>

        <p v-if="loading" class="plugins-page__muted">{{ text(TEXT.loading) }}</p>
        <section v-for="group in loading ? [] : groups" :key="group.key" class="plugins-page__group" :data-plugin-group="group.key">
            <h3 class="plugins-page__heading-label">{{ text(group.heading) }}</h3>
            <p v-if="group.items.length === 0" class="plugins-page__muted" data-plugins-empty>{{ text(TEXT.noThirdParty) }}</p>
            <ul v-else class="plugins-page__list">
                <li v-for="item in group.items" :key="item.id" class="plugins-page__item" :data-plugin-row="item.id" :data-plugin-source="item.source">
                    <div class="plugins-page__meta">
                        <div class="plugins-page__heading">
                            <span class="plugins-page__id">{{ item.id }}</span>
                            <span class="plugins-page__version">{{ item.version }}</span>
                            <Badge v-if="item.source === 'builtin'" size="sm" variant="soft">{{ text(TEXT.builtin) }}</Badge>
                            <Badge v-for="change in item.pending" :key="change.kind" size="sm" variant="soft" tone="warning" :data-plugin-pending="change.kind">{{ pendingText(change) }}</Badge>
                            <Badge v-if="item.notLoaded !== null" size="sm" variant="soft" :tone="item.notLoaded.code === 'entries-not-loaded' ? 'neutral' : 'danger'" :data-plugin-not-loaded="item.notLoaded.code">{{ text(NOT_LOADED_TEXT[item.notLoaded.code]) }}</Badge>
                        </div>
                        <p v-if="item.notLoaded !== null && item.notLoaded.code !== 'safe-mode'" class="plugins-page__reason">{{ item.notLoaded.detail }}</p>
                    </div>
                    <div v-if="item.source === 'third-party'" class="plugins-page__actions">
                        <Switch
                            :model-value="item.state === 'enabled'"
                            :disabled="busy || item.state === 'uninstalling'"
                            :aria-label="localize(formatText(TEXT.toggle, {id: item.id}), locale)"
                            data-plugin-toggle
                            @update:model-value="(value: boolean) => toggle(item, value)"
                        />
                        <Button variant="danger" size="sm" :disabled="busy || item.state === 'uninstalling'" data-plugin-uninstall @click="uninstalling = item">{{ text(TEXT.uninstall) }}</Button>
                    </div>
                </li>
            </ul>
        </section>

        <Dialog
            v-model="confirmingInstall"
            size="sm"
            :title="text(TEXT.installTitle)"
            :confirm-label="text(TEXT.confirmInstall)"
            :cancel-label="text(TEXT.cancel)"
            show-cancel
            :busy="busy"
            @confirm="install"
        >
            <p class="plugins-page__dialog-text">{{ text(TEXT.trust) }}</p>
            <p class="plugins-page__path">{{ path }}</p>
        </Dialog>

        <Dialog
            :model-value="uninstalling !== null"
            size="sm"
            :title="text(TEXT.uninstallTitle)"
            :confirm-label="text(TEXT.uninstall)"
            :cancel-label="text(TEXT.cancel)"
            show-cancel
            :busy="busy"
            @update:model-value="(open: boolean) => { if (!open) uninstalling = null; }"
            @confirm="uninstall"
        >
            <p class="plugins-page__dialog-text">{{ uninstalling === null ? "" : localize(formatText(TEXT.uninstallBody, {id: uninstalling.id}), locale) }}</p>
        </Dialog>
    </div>
</template>

<style scoped>
.plugins-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.plugins-page__install {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.plugins-page__label,
.plugins-page__muted {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-muted);
}

.plugins-page__install-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
}

.plugins-page__install-row > :first-child {
    flex: 1 1 auto;
    min-width: 0;
}

.plugins-page__problem {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--status-danger);
    overflow-wrap: anywhere;
}

.plugins-page__group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.plugins-page__heading-label {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: 600;
    line-height: var(--leading-ui);
    color: var(--text-muted);
}

.plugins-page__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.plugins-page__item {
    display: flex;
    gap: var(--space-4);
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    border: var(--border-w) solid var(--divider);
    border-radius: var(--radius-md);
}

.plugins-page__meta {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}

.plugins-page__heading {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
}

.plugins-page__id {
    font-size: var(--text-sm);
    color: var(--text-main);
    overflow-wrap: anywhere;
}

.plugins-page__version {
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.plugins-page__reason {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-muted);
    overflow-wrap: anywhere;
}

.plugins-page__actions {
    display: flex;
    flex: none;
    gap: var(--space-2);
    align-items: center;
}

.plugins-page__dialog-text {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    line-height: var(--leading-ui);
    color: var(--text-main);
}

.plugins-page__path {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
    overflow-wrap: anywhere;
}
</style>
