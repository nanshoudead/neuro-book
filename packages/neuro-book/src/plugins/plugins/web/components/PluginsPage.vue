<script setup lang="ts">
/**
 * 设置窗口的插件页（同名 .md）：列出第三方与内置插件，从服务端上的文件夹安装（先预览），启用、禁用与卸载；全部在下一次
 * 启动生效（docs/specs/runtime/plugin-install.md 输出 1–4、7–9）。
 */
import {Badge, Banner, Button, Dialog, FormInput, Spinner, Switch} from "@notnotype/nb-ui/components";
import {computed, nextTick, onMounted, ref, watch} from "vue";

import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import type {InstallPreview, PendingChange, PluginListItem, PluginsRegistry} from "../../shared/contracts";

defineOptions({name: "PluginsPage"});

const props = defineProps<{
    registry: PluginsRegistry;
    locale: DisplayLocale;
}>();

const TEXT = {
    restartNote: {"zh-CN": "安装、卸载、升级、启用与禁用在下一次启动后生效。", "en-US": "Installing, uninstalling, upgrading, enabling and disabling take effect the next time NeuroBook starts."},
    pendingNote: {"zh-CN": "有待生效的变化，重启 NeuroBook 后生效。", "en-US": "Some changes are pending. Restart NeuroBook to apply them."},
    safeMode: {"zh-CN": "安全模式：第三方插件没有加载，可以在这里禁用或卸载它们。", "en-US": "Safe mode: third-party plugins are not loaded. You can disable or uninstall them here."},
    loading: {"zh-CN": "正在读取插件…", "en-US": "Loading plugins…"},
    retry: {"zh-CN": "重试", "en-US": "Retry"},
    pathLabel: {"zh-CN": "服务端上的插件文件夹", "en-US": "Plugin folder on the server"},
    pathPlaceholder: {"zh-CN": "/home/me/plugins/hello", "en-US": "/home/me/plugins/hello"},
    install: {"zh-CN": "安装…", "en-US": "Install…"},
    thirdPartyHeading: {"zh-CN": "第三方插件", "en-US": "Third-party plugins"},
    builtinHeading: {"zh-CN": "内置插件", "en-US": "Built-in plugins"},
    noThirdParty: {"zh-CN": "还没有安装第三方插件。", "en-US": "No third-party plugins installed."},
    builtin: {"zh-CN": "内置", "en-US": "Built-in"},
    toggle: {"zh-CN": "启用 {id}", "en-US": "Enable {id}"},
    uninstall: {"zh-CN": "卸载", "en-US": "Uninstall"},
    uninstallNamed: {"zh-CN": "卸载 {id}", "en-US": "Uninstall {id}"},
    uninstallTitle: {"zh-CN": "卸载插件", "en-US": "Uninstall plugin"},
    uninstallBody: {"zh-CN": "卸载 {id}？重启后删除插件的安装目录，配置与私有数据保留。确认后到重启之前不能撤回。", "en-US": "Uninstall {id}? Its install folder is removed after restart; its settings and private data are kept. This cannot be undone before the restart."},
    cancel: {"zh-CN": "取消", "en-US": "Cancel"},
    trust: {"zh-CN": "插件完全受信任：安装后它可以访问全部作品、服务器与本机资源。只安装你信任的来源。", "en-US": "Plugins are fully trusted: once installed, a plugin can access all books, the server and local resources. Only install plugins you trust."},
    downgrade: {"zh-CN": "降级后插件可能读到新版本已迁移过的数据。", "en-US": "After a downgrade the plugin may read data already migrated by the newer version."},
    unknownFailure: {"zh-CN": "操作没有完成", "en-US": "The operation did not complete"},
} satisfies Record<string, LocalizedText>;

const PREVIEW_TEXT: Record<InstallPreview["relation"], {readonly title: LocalizedText; readonly confirm: LocalizedText}> = {
    install: {title: {"zh-CN": "安装插件", "en-US": "Install plugin"}, confirm: {"zh-CN": "安装", "en-US": "Install"}},
    upgrade: {title: {"zh-CN": "升级插件", "en-US": "Upgrade plugin"}, confirm: {"zh-CN": "升级", "en-US": "Upgrade"}},
    downgrade: {title: {"zh-CN": "降级插件", "en-US": "Downgrade plugin"}, confirm: {"zh-CN": "降级", "en-US": "Downgrade"}},
};

const PENDING_TEXT: Record<PendingChange["kind"], LocalizedText> = {
    install: {"zh-CN": "重启后安装", "en-US": "Installs on restart"},
    uninstall: {"zh-CN": "重启后卸载", "en-US": "Uninstalls on restart"},
    enable: {"zh-CN": "重启后启用", "en-US": "Enabled on restart"},
    disable: {"zh-CN": "重启后禁用", "en-US": "Disabled on restart"},
    upgrade: {"zh-CN": "重启后升级到 {version}", "en-US": "Upgrade to {version} on restart"},
};

type NotLoadedCode = NonNullable<PluginListItem["notLoaded"]>["code"];

const NOT_LOADED: Record<NotLoadedCode, {readonly text: LocalizedText; readonly tone: "danger" | "neutral"; readonly showDetail: boolean}> = {
    "manifest-invalid": {text: {"zh-CN": "清单无效", "en-US": "Invalid manifest"}, tone: "danger", showDetail: true},
    "incompatible-engine": {text: {"zh-CN": "不兼容", "en-US": "Incompatible"}, tone: "danger", showDetail: true},
    "safe-mode": {text: {"zh-CN": "安全模式未加载", "en-US": "Not loaded in safe mode"}, tone: "neutral", showDetail: false},
    // 入口代码的装载还没有实现：只有声明（例如设置项）生效。
    "entries-not-loaded": {text: {"zh-CN": "部分功能暂不可用", "en-US": "Some features unavailable"}, tone: "neutral", showDetail: false},
};

/** 业务失败码（plugin-install 的失败码表）与常见的路由层失败码。 */
const FAILURE_TEXT: Record<string, LocalizedText> = {
    "manifest-invalid": {"zh-CN": "插件的清单无效", "en-US": "The plugin manifest is invalid"},
    "reserved-id": {"zh-CN": "第三方插件的 id 不能以 nbook. 开头", "en-US": "Third-party plugin ids cannot start with nbook."},
    "incompatible-engine": {"zh-CN": "插件与当前版本的 NeuroBook 不兼容", "en-US": "The plugin is not compatible with this version of NeuroBook"},
    "already-installed": {"zh-CN": "这个版本已经安装，或已在等待重启后切换", "en-US": "This version is already installed or waiting for the restart"},
    "uninstall-pending": {"zh-CN": "插件正在卸载，重启后再操作", "en-US": "The plugin is being uninstalled; restart first"},
    "path-rejected": {"zh-CN": "这个路径不能用", "en-US": "This path cannot be used"},
    "entry-missing": {"zh-CN": "插件缺少入口文件", "en-US": "The plugin is missing entry files"},
    "copy-failed": {"zh-CN": "复制插件文件失败", "en-US": "Copying the plugin files failed"},
    "not-installed": {"zh-CN": "这个插件已经不在了", "en-US": "This plugin is no longer installed"},
    "builtin-fixed": {"zh-CN": "内置插件不能这样操作", "en-US": "Built-in plugins cannot be changed"},
    "registry-failed": {"zh-CN": "读写插件登记表失败", "en-US": "Reading or writing the plugin registry failed"},
    unavailable: {"zh-CN": "连不上服务端", "en-US": "The server is unreachable"},
    timeout: {"zh-CN": "服务端没有及时答复", "en-US": "The server did not answer in time"},
    "unknown-outcome": {"zh-CN": "不知道操作有没有完成，已重新读取列表", "en-US": "It is unknown whether the operation completed; the list was reloaded"},
};

/** 服务端详情能补充信息的码；其余的码固定文字已经说全，详情只会重复。 */
const DETAIL_CODES = new Set(["manifest-invalid", "path-rejected", "copy-failed", "entry-missing", "registry-failed", "incompatible-engine"]);
/** 失败后列表可能已过时的码：写出原因之后重新读列表。 */
const STALE_CODES = new Set(["unknown-outcome", "not-installed", "uninstall-pending", "already-installed"]);

type Failure = {readonly ok: false; readonly code: string; readonly detail?: unknown};
type Problem = {readonly serial: number; readonly code: string; readonly reason: string; readonly lines: ReadonlyArray<string>};

const text = (value: LocalizedText): string => localize(value, props.locale);
const format = (value: LocalizedText, values: Record<string, string>): string => localize(formatText(value, values), props.locale);

const state = ref<"loading" | "failed" | "ready">("loading");
const loadFailure = ref<string>("");
const items = ref<ReadonlyArray<PluginListItem>>([]);
const safeMode = ref(false);
/** 进行中的写操作：`preview`、`install`、`toggle:<id>`、`uninstall:<id>`；没有为 null。 */
const busy = ref<string | null>(null);
const problem = ref<Problem | null>(null);
let serial = 0;
const path = ref("");
const pathInput = ref<{$el?: Element} | null>(null);
const preview = ref<InstallPreview | null>(null);
const previewPath = ref("");
const uninstalling = ref<PluginListItem | null>(null);
/** 卸载成功后焦点的落点（第三方插件的小标题）；函数 ref 记下。 */
let thirdPartyTitle: HTMLElement | null = null;
function rememberTitle(key: string, element: unknown): void {
    if (key === "third-party") thirdPartyTitle = element instanceof HTMLElement ? element : null;
}

const hasPending = computed(() => items.value.some((item) => item.pending.length > 0));
/** 第三方插件在前：它们才有操作；内置插件随产品，放在后面。 */
const groups = computed(() => [
    {key: "third-party", heading: TEXT.thirdPartyHeading, items: items.value.filter((item) => item.source === "third-party")},
    {key: "builtin", heading: TEXT.builtinHeading, items: items.value.filter((item) => item.source === "builtin")},
]);

function detailOf(failure: Failure): {readonly detail: string; readonly problems: ReadonlyArray<string>} {
    const detail = failure.detail;
    if (typeof detail === "string") return {detail, problems: []};
    if (typeof detail !== "object" || detail === null) return {detail: "", problems: []};
    return {
        detail: "detail" in detail && typeof detail.detail === "string" ? detail.detail : "",
        problems: "problems" in detail && Array.isArray(detail.problems) ? detail.problems.map(String) : [],
    };
}

function report(failure: Failure): void {
    const known = FAILURE_TEXT[failure.code];
    const {detail, problems} = detailOf(failure);
    const showDetail = known === undefined || DETAIL_CODES.has(failure.code);
    serial += 1;
    problem.value = {serial, code: failure.code, reason: text(known ?? TEXT.unknownFailure), lines: showDetail ? [detail, ...problems].filter((line) => line !== "") : []};
    if (STALE_CODES.has(failure.code)) void refresh();
}

async function refresh(): Promise<void> {
    const result = await props.registry.list({});
    if (!result.ok) {
        const known = FAILURE_TEXT[result.code];
        const {detail} = detailOf(result);
        loadFailure.value = [text(known ?? TEXT.unknownFailure), detail].filter((line) => line !== "").join(" · ");
        state.value = "failed";
        return;
    }
    items.value = result.value.plugins;
    safeMode.value = result.value.safeMode;
    state.value = "ready";
}

async function retry(): Promise<void> {
    state.value = "loading";
    await refresh();
}

function replace(item: PluginListItem): void {
    items.value = items.value.map((current) => (current.id === item.id ? item : current));
}

function focusPath(): void {
    const element = pathInput.value?.$el;
    const input = element instanceof HTMLInputElement ? element : element?.querySelector("input");
    input?.focus();
}

async function startInstall(): Promise<void> {
    if (busy.value !== null) return;
    const source = path.value.trim();
    if (source === "") {
        focusPath();
        return;
    }
    busy.value = "preview";
    const result = await props.registry.inspect({path: source});
    busy.value = null;
    if (!result.ok) {
        report(result);
        return;
    }
    problem.value = null;
    previewPath.value = source;
    preview.value = result.value;
}

async function confirmInstall(): Promise<void> {
    if (busy.value !== null || preview.value === null) return;
    busy.value = "install";
    const result = await props.registry.install({path: previewPath.value});
    busy.value = null;
    preview.value = null;
    if (!result.ok) {
        report(result);
        return;
    }
    problem.value = null;
    path.value = "";
    await refresh();
}

async function toggle(item: PluginListItem, enabled: boolean): Promise<void> {
    if (busy.value !== null) return;
    busy.value = `toggle:${item.id}`;
    const result = enabled ? await props.registry.enable({id: item.id}) : await props.registry.disable({id: item.id});
    busy.value = null;
    if (!result.ok) {
        report(result);
        return;
    }
    problem.value = null;
    replace(result.value.plugin);
}

let focusAfterUninstall = false;

async function confirmUninstall(): Promise<void> {
    const item = uninstalling.value;
    if (item === null || busy.value !== null) return;
    busy.value = `uninstall:${item.id}`;
    const result = await props.registry.uninstall({id: item.id});
    busy.value = null;
    if (!result.ok) {
        uninstalling.value = null;
        report(result);
        return;
    }
    problem.value = null;
    focusAfterUninstall = true;
    uninstalling.value = null;
    replace(result.value.plugin);
}

// 卸载成功后这一行的“卸载”不再显示，对话框还不了焦点：等对话框关掉、DOM 更新之后，把焦点放到第三方插件的小标题。
watch(uninstalling, async (now) => {
    if (now !== null || !focusAfterUninstall) return;
    focusAfterUninstall = false;
    await nextTick();
    thirdPartyTitle?.focus();
}, {flush: "post"});

/** 只停用别的写控件：正在操作的那个保持可聚焦（键盘用户不丢焦点），重复操作由处理函数忽略。 */
function blockedFor(key: string): boolean {
    return busy.value !== null && busy.value !== key;
}

function pendingText(change: PendingChange): string {
    return change.kind === "upgrade" ? format(PENDING_TEXT.upgrade, {version: change.version}) : text(PENDING_TEXT[change.kind]);
}

function closePreview(open: boolean): void {
    if (!open && busy.value !== "install") preview.value = null;
}

function closeUninstall(open: boolean): void {
    if (!open && busy.value === null) uninstalling.value = null;
}

onMounted(() => {
    void refresh();
});
</script>

<template>
    <div class="plugins-page" data-plugins-page :data-plugins-state="state">
        <Banner :tone="hasPending ? 'warning' : 'info'" :message="text(hasPending ? TEXT.pendingNote : TEXT.restartNote)" data-plugins-restart />
        <Banner v-if="safeMode" tone="warning" :message="text(TEXT.safeMode)" data-plugins-safe-mode />

        <form class="plugins-page__install" @submit.prevent="startInstall">
            <label class="plugins-page__label" for="nbook-plugins-path">{{ text(TEXT.pathLabel) }}</label>
            <div class="plugins-page__install-row">
                <FormInput id="nbook-plugins-path" ref="pathInput" v-model="path" :placeholder="text(TEXT.pathPlaceholder)" spellcheck="false" data-plugin-path />
                <Button type="submit" :disabled="blockedFor('preview')" :aria-busy="busy === 'preview' ? 'true' : undefined" data-plugin-install>{{ text(TEXT.install) }}</Button>
            </div>
        </form>

        <div class="plugins-page__problem" role="alert" :data-plugin-problem="problem?.code">
            <template v-if="problem !== null">
                <p :key="problem.serial" class="plugins-page__problem-reason" :title="problem.code">{{ problem.reason }}</p>
                <p v-for="line in problem.lines" :key="`${problem.serial}:${line}`" class="plugins-page__problem-line">{{ line }}</p>
            </template>
        </div>

        <div v-if="state === 'loading'" class="plugins-page__notice plugins-page__notice--delayed" role="status" aria-busy="true">
            <Spinner size="sm" :label="text(TEXT.loading)" />
            <span>{{ text(TEXT.loading) }}</span>
        </div>
        <div v-else-if="state === 'failed'" class="plugins-page__notice" role="alert" data-plugins-load-failure>
            <span>{{ loadFailure }}</span>
            <Button size="sm" variant="secondary" data-plugins-retry @click="retry">{{ text(TEXT.retry) }}</Button>
        </div>
        <template v-else>
            <section v-for="group in groups" :key="group.key" class="plugins-page__group" :data-plugin-group="group.key">
                <h3 :ref="(element) => rememberTitle(group.key, element)" class="plugins-page__group-title" tabindex="-1">{{ text(group.heading) }}</h3>
                <p v-if="group.items.length === 0" class="plugins-page__muted" data-plugins-empty>{{ text(TEXT.noThirdParty) }}</p>
                <ul v-else class="plugins-page__list">
                    <li v-for="item in group.items" :key="item.id" class="plugins-page__item" :data-plugin-row="item.id" :data-plugin-source="item.source">
                        <div class="plugins-page__meta">
                            <div class="plugins-page__heading">
                                <span class="plugins-page__id">{{ item.id }}</span>
                                <span class="plugins-page__version">{{ item.version }}</span>
                                <Badge v-if="item.source === 'builtin'" size="sm" variant="soft">{{ text(TEXT.builtin) }}</Badge>
                                <Badge v-for="change in item.pending" :key="change.kind" class="plugins-page__badge" size="sm" variant="soft" tone="warning" :data-plugin-pending="change.kind">{{ pendingText(change) }}</Badge>
                                <Badge v-if="item.notLoaded !== null" class="plugins-page__badge" size="sm" variant="soft" :tone="NOT_LOADED[item.notLoaded.code].tone" :data-plugin-not-loaded="item.notLoaded.code">{{ text(NOT_LOADED[item.notLoaded.code].text) }}</Badge>
                            </div>
                            <p v-if="item.notLoaded !== null && NOT_LOADED[item.notLoaded.code].showDetail" class="plugins-page__reason">{{ item.notLoaded.detail }}</p>
                        </div>
                        <div v-if="item.source === 'third-party' && item.state !== 'uninstalling'" class="plugins-page__actions">
                            <Switch
                                :model-value="item.state === 'enabled'"
                                :disabled="blockedFor(`toggle:${item.id}`)"
                                :aria-label="format(TEXT.toggle, {id: item.id})"
                                data-plugin-toggle
                                @update:model-value="(value: boolean) => toggle(item, value)"
                            />
                            <Button
                                variant="secondary"
                                size="sm"
                                :disabled="busy !== null"
                                :aria-label="format(TEXT.uninstallNamed, {id: item.id})"
                                data-plugin-uninstall
                                @click="uninstalling = item"
                            >
                                {{ text(TEXT.uninstall) }}
                            </Button>
                        </div>
                    </li>
                </ul>
            </section>
        </template>

        <Dialog
            :model-value="preview !== null"
            size="sm"
            :title="preview === null ? '' : text(PREVIEW_TEXT[preview.relation].title)"
            :busy="busy === 'install'"
            @update:model-value="closePreview"
        >
            <template v-if="preview !== null">
                <p class="plugins-page__dialog-subject">{{ preview.installed === null ? `${preview.id} ${preview.version}` : `${preview.id} ${preview.installed} → ${preview.version}` }}</p>
                <p v-if="preview.relation === 'downgrade'" class="plugins-page__dialog-warning">{{ text(TEXT.downgrade) }}</p>
                <p class="plugins-page__dialog-text">{{ text(TEXT.trust) }}</p>
                <p class="plugins-page__path">{{ previewPath }}</p>
            </template>
            <template #footer="{cancel}">
                <Button variant="secondary" :disabled="busy === 'install'" @click="cancel">{{ text(TEXT.cancel) }}</Button>
                <Button :loading="busy === 'install'" data-plugin-install-confirm @click="confirmInstall">{{ preview === null ? "" : text(PREVIEW_TEXT[preview.relation].confirm) }}</Button>
            </template>
        </Dialog>

        <Dialog
            :model-value="uninstalling !== null"
            size="sm"
            :title="text(TEXT.uninstallTitle)"
            :busy="busy !== null && busy.startsWith('uninstall:')"
            @update:model-value="closeUninstall"
        >
            <p class="plugins-page__dialog-text">{{ uninstalling === null ? "" : format(TEXT.uninstallBody, {id: uninstalling.id}) }}</p>
            <template #footer="{cancel}">
                <Button variant="secondary" :disabled="busy !== null" @click="cancel">{{ text(TEXT.cancel) }}</Button>
                <Button variant="danger" :loading="busy !== null && busy.startsWith('uninstall:')" data-plugin-uninstall-confirm @click="confirmUninstall">{{ text(TEXT.uninstall) }}</Button>
            </template>
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
    margin: 0;
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

/* 播报区常驻：平时空着不占高度，读屏只播报其中的变化。 */
.plugins-page__problem:empty {
    display: none;
}

.plugins-page__problem {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    overflow-wrap: anywhere;
}

.plugins-page__problem-reason {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--status-danger);
}

.plugins-page__problem-line {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-muted);
}

.plugins-page__notice {
    display: flex;
    min-height: 160px;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    padding: var(--space-5);
    font-size: var(--text-sm);
    line-height: var(--leading-ui);
    color: var(--text-secondary);
    text-align: center;
    overflow-wrap: anywhere;
}

/* 读得快时不闪：加载指示约 200ms 后才显现。 */
.plugins-page__notice--delayed {
    animation: plugins-page-appear 0s linear 200ms both;
}

@keyframes plugins-page-appear {
    from {
        visibility: hidden;
    }

    to {
        visibility: visible;
    }
}

.plugins-page__group {
    display: flex;
    flex-direction: column;
}

.plugins-page__group-title {
    margin: 0;
    padding-bottom: var(--space-3);
    border-bottom: var(--border-w) solid var(--divider);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    line-height: var(--leading-ui);
    color: var(--text-secondary);
    outline: none;
}

.plugins-page__group-title:focus-visible {
    box-shadow: var(--focus-ring);
}

.plugins-page__group > .plugins-page__muted {
    padding: var(--space-3) 0;
}

.plugins-page__list {
    margin: 0;
    padding: 0;
    list-style: none;
}

.plugins-page__item {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) 0;
    border-bottom: var(--border-w) solid var(--divider);
}

.plugins-page__meta {
    display: flex;
    flex: 1 1 240px;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}

.plugins-page__heading {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    min-width: 0;
}

/* 徽标默认不换行；长文字（英文的“重启后升级到 x”）在窄行里允许折行，不压到右边的控件。 */
.plugins-page__badge {
    max-width: 100%;
    white-space: normal;
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
    margin-left: auto;
}

.plugins-page__dialog-subject {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--text-main);
    overflow-wrap: anywhere;
}

.plugins-page__dialog-warning {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    line-height: var(--leading-ui);
    color: var(--status-warning);
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
