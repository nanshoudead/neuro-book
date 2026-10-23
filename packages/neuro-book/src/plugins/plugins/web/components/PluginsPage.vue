<script setup lang="ts">
/**
 * 设置窗口的插件页（同名 .md）：列出第三方与内置插件，从服务端上的文件夹安装（先预览），启用、禁用与卸载；全部在下一次
 * 启动生效（docs/specs/runtime/plugin-install.md 输出 1–4、7–9）。
 */
import type {RemoteFailureCode} from "@notnotype/nb-runtime/remote";
import {Badge, Button, Dialog, Input, Spinner, Switch} from "@notnotype/nb-ui/components";
import {computed, nextTick, onMounted, ref} from "vue";

import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import type {BlockedPlugin, InstallPreview, PendingChange, PluginFailureCode, PluginListItem, PluginsRegistry} from "../../shared/contracts";

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
    blocked: {"zh-CN": "重启后这些插件的部分功能将不可用：", "en-US": "After the restart, parts of these plugins will be unavailable:"},
    blockedVersion: {"zh-CN": "{plugin}（{entries}）：要求版本 {range}", "en-US": "{plugin} ({entries}): requires version {range}"},
    blockedProvider: {"zh-CN": "{plugin}（{entries}）：依赖的插件不可用", "en-US": "{plugin} ({entries}): a plugin it depends on will be unavailable"},
    blockedService: {"zh-CN": "{plugin}（{entries}）：需要的服务 {service} 不再提供", "en-US": "{plugin} ({entries}): the service {service} it needs will no longer be provided"},
    blockedCycle: {"zh-CN": "{plugin}（{entries}）：依赖成环", "en-US": "{plugin} ({entries}): its dependencies form a cycle"},
    unchecked: {"zh-CN": "这些已安装插件的清单读不了，没有核对：{plugins}", "en-US": "These installed plugins could not be checked: {plugins}"},
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
};

type FailureCode = PluginFailureCode | RemoteFailureCode;

/** 业务失败码（plugin-install 的失败码表）都有文字；路由层失败码只写常见的三个，其余显示“操作没有完成”与详情。 */
const FAILURE_TEXT: Readonly<Record<PluginFailureCode, LocalizedText> & Partial<Record<RemoteFailureCode, LocalizedText>>> = {
    "manifest-invalid": {"zh-CN": "插件的清单无效", "en-US": "The plugin manifest is invalid"},
    "reserved-id": {"zh-CN": "第三方插件的 id 不能以 nbook. 开头", "en-US": "Third-party plugin ids cannot start with nbook."},
    "incompatible-engine": {"zh-CN": "插件与当前版本的 NeuroBook 不兼容", "en-US": "The plugin is not compatible with this version of NeuroBook"},
    "already-installed": {"zh-CN": "这个版本已经安装，或已在等待重启后切换", "en-US": "This version is already installed or waiting for the restart"},
    "uninstall-pending": {"zh-CN": "插件正在卸载，重启后再操作", "en-US": "The plugin is being uninstalled; restart first"},
    "version-in-use": {"zh-CN": "这个版本的旧目录还在使用中，不能重装", "en-US": "The old directory of this version is still in use and cannot be replaced"},
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
const DETAIL_CODES: ReadonlySet<FailureCode> = new Set<FailureCode>(["manifest-invalid", "path-rejected", "copy-failed", "entry-missing", "registry-failed", "incompatible-engine", "version-in-use"]);
/** 失败后列表可能已过时的码：写出原因之后重新读列表。 */
const STALE_CODES: ReadonlySet<FailureCode> = new Set<FailureCode>(["unknown-outcome", "not-installed", "uninstall-pending", "already-installed"]);

type Failure = {readonly ok: false; readonly code: FailureCode; readonly detail?: unknown};
type Problem = {readonly serial: number; readonly code: string; readonly reason: string; readonly lines: ReadonlyArray<string>};

const text = (value: LocalizedText): string => localize(value, props.locale);

const format = (value: LocalizedText, values: Record<string, string>): string => localize(formatText(value, values), props.locale);
/** 升级确认框里一条受阻的插件：版本不符时写出它要求的范围。 */
/** 列表按界面语言连接（“a、b和c”“a, b, and c”）。 */
const list = (items: ReadonlyArray<string>): string => new Intl.ListFormat(props.locale, {type: "conjunction"}).format(items);
const BLOCKED_TEXT: Readonly<Record<BlockedPlugin["reason"], LocalizedText>> = {
    "version-mismatch": TEXT.blockedVersion,
    "missing-service": TEXT.blockedService,
    "dependency-cycle": TEXT.blockedCycle,
    "provider-blocked": TEXT.blockedProvider,
};
const blockedLine = (item: BlockedPlugin): string => format(BLOCKED_TEXT[item.reason], {plugin: item.plugin, entries: list(item.entries), range: item.range ?? "", service: item.service ?? ""});

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
const problemRegion = ref<HTMLElement | null>(null);
const retryButton = ref<{$el?: Element} | null>(null);
// 对话框的开合与内容分开：关闭时内容留到下一次打开再换，淡出动画里不会先变成空壳。
const previewOpen = ref(false);
const preview = ref<InstallPreview | null>(null);
const previewPath = ref("");
const uninstallOpen = ref(false);
const uninstalling = ref<PluginListItem | null>(null);
/** 打开对话框的控件不在了时焦点的落点（第三方插件的小标题）；函数 ref 记下。 */
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

/** 写出失败说明并让它进入视野（行内操作的失败可能发生在滚下去的位置）；列表可能已过时时等重新读完。 */
async function report(failure: Failure): Promise<void> {
    const known: LocalizedText | undefined = FAILURE_TEXT[failure.code];
    const {detail, problems} = detailOf(failure);
    // 出错字段（清单无效）本身就是原因；没有时才用服务端的一句话。
    const lines = problems.length > 0 ? problems : [detail].filter((line) => line !== "");
    serial += 1;
    problem.value = {serial, code: failure.code, reason: text(known ?? TEXT.unknownFailure), lines: known === undefined || DETAIL_CODES.has(failure.code) ? lines : []};
    await nextTick();
    problemRegion.value?.scrollIntoView({block: "nearest"});
    if (STALE_CODES.has(failure.code)) await refresh();
}

// 只采用最新一次读取的结果；读取途中又完成了写操作时重新读，旧结果不会盖掉写操作刚换上的行。
let generation = 0;
let reading = false;

/** 读列表；返回这次读取之后页面的状态（被更新的一次读取取代时为 null）。 */
async function refresh(): Promise<"failed" | "ready" | null> {
    generation += 1;
    const mine = generation;
    reading = true;
    const result = await props.registry.list({});
    if (mine !== generation) return null;
    reading = false;
    if (!result.ok) {
        const known = FAILURE_TEXT[result.code];
        const {detail} = detailOf(result);
        loadFailure.value = [text(known ?? TEXT.unknownFailure), detail].filter((line) => line !== "").join(" · ");
        state.value = "failed";
        return "failed";
    }
    items.value = result.value.plugins;
    safeMode.value = result.value.safeMode;
    state.value = "ready";
    return "ready";
}

async function retry(): Promise<void> {
    state.value = "loading";
    const after = await refresh();
    // “重试”随失败块一起被换掉了：焦点放到新的“重试”或第三方插件的小标题，不落到 body。
    await nextTick();
    if (after === "failed") focusComponent(retryButton.value);
    else if (after === "ready") thirdPartyTitle?.focus();
}

function replace(item: PluginListItem): void {
    items.value = items.value.map((current) => (current.id === item.id ? item : current));
    if (reading) void refresh();
}

function focusComponent(component: {$el?: Element} | null): void {
    const element = component?.$el;
    const target = element instanceof HTMLInputElement || element instanceof HTMLButtonElement ? element : element?.querySelector("input, button");
    if (target instanceof HTMLElement) target.focus();
}

async function startInstall(): Promise<void> {
    if (busy.value !== null) return;
    const source = path.value.trim();
    if (source === "") {
        focusComponent(pathInput.value);
        return;
    }
    busy.value = "preview";
    const result = await props.registry.inspect({path: source});
    busy.value = null;
    if (!result.ok) {
        await report(result);
        return;
    }
    problem.value = null;
    previewPath.value = source;
    preview.value = result.value;
    previewOpen.value = true;
}

async function confirmInstall(): Promise<void> {
    if (busy.value !== null || !previewOpen.value) return;
    busy.value = "install";
    const result = await props.registry.install({path: previewPath.value});
    busy.value = null;
    previewOpen.value = false;
    if (!result.ok) {
        await report(result);
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
        await report(result);
        return;
    }
    problem.value = null;
    replace(result.value.plugin);
}

/** 这一行还画着“卸载”（第三方插件、不在卸载中）。 */
function hasUninstall(id: string): boolean {
    return items.value.some((item) => item.id === id && item.source === "third-party" && item.state !== "uninstalling");
}

async function confirmUninstall(): Promise<void> {
    const item = uninstalling.value;
    if (item === null || busy.value !== null) return;
    busy.value = `uninstall:${item.id}`;
    const result = await props.registry.uninstall({id: item.id});
    busy.value = null;
    uninstallOpen.value = false;
    if (result.ok) {
        problem.value = null;
        replace(result.value.plugin);
    } else {
        await report(result);
    }
    // 卸载成功，或失败后重读的列表里这一行已在卸载中、已不在：打开对话框的“卸载”没了，对话框还不了焦点。
    if (!hasUninstall(item.id)) {
        await nextTick();
        thirdPartyTitle?.focus();
    }
}

/** 只停用别的写控件：正在操作的那个保持可聚焦（键盘用户不丢焦点），重复操作由处理函数忽略。 */
function blockedFor(key: string): boolean {
    return busy.value !== null && busy.value !== key;
}

function pendingText(change: PendingChange): string {
    return change.kind === "upgrade" ? format(PENDING_TEXT.upgrade, {version: change.version}) : text(PENDING_TEXT[change.kind]);
}

function openUninstall(item: PluginListItem): void {
    uninstalling.value = item;
    uninstallOpen.value = true;
}

function closePreview(open: boolean): void {
    if (!open && busy.value !== "install") previewOpen.value = false;
}

function closeUninstall(open: boolean): void {
    if (!open && busy.value === null) uninstallOpen.value = false;
}

onMounted(() => {
    void refresh();
});
</script>

<template>
    <div class="plugins-page" data-plugins-page :data-plugins-state="state">
        <!-- 与设置窗口画在分区顶部的层状态说明同一种写法：一行图标加文字，不画框。 -->
        <p class="plugins-page__note" :class="{'plugins-page__note--warning': hasPending}" role="status" data-plugins-restart>
            <span :class="hasPending ? 'i-lucide-triangle-alert' : 'i-lucide-info'" class="plugins-page__note-icon" aria-hidden="true"></span>
            <span>{{ text(hasPending ? TEXT.pendingNote : TEXT.restartNote) }}</span>
        </p>
        <p v-if="safeMode" class="plugins-page__note plugins-page__note--warning" data-plugins-safe-mode>
            <span class="i-lucide-shield-alert plugins-page__note-icon" aria-hidden="true"></span>
            <span>{{ text(TEXT.safeMode) }}</span>
        </p>

        <form class="plugins-page__install" @submit.prevent="startInstall">
            <label class="plugins-page__label" for="nbook-plugins-path">{{ text(TEXT.pathLabel) }}</label>
            <div class="plugins-page__install-row">
                <Input id="nbook-plugins-path" ref="pathInput" v-model="path" :placeholder="text(TEXT.pathPlaceholder)" spellcheck="false" data-plugin-path />
                <Button type="submit" :disabled="blockedFor('preview')" :aria-busy="busy === 'preview' ? 'true' : undefined" data-plugin-install>{{ text(TEXT.install) }}</Button>
            </div>
        </form>

        <div ref="problemRegion" class="plugins-page__problem" role="alert" :data-plugin-problem="problem?.code">
            <template v-if="problem !== null">
                <p :key="problem.serial" class="plugins-page__problem-reason" :title="problem.code">{{ problem.reason }}</p>
                <p v-for="line in problem.lines" :key="`${problem.serial}:${line}`" class="plugins-page__problem-line">{{ line }}</p>
            </template>
        </div>

        <!-- Spinner 自己是带名称的 status；aria-busy 标出正在加载的区域。 -->
        <div v-if="state === 'loading'" class="plugins-page__notice plugins-page__notice--delayed" aria-busy="true">
            <Spinner size="sm" :label="text(TEXT.loading)" show-label />
        </div>
        <div v-else-if="state === 'failed'" class="plugins-page__notice" role="alert" data-plugins-load-failure>
            <span>{{ loadFailure }}</span>
            <Button ref="retryButton" size="sm" variant="secondary" data-plugins-retry @click="retry">{{ text(TEXT.retry) }}</Button>
        </div>
        <div v-else class="plugins-page__groups">
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
                                @click="openUninstall(item)"
                            >
                                {{ text(TEXT.uninstall) }}
                            </Button>
                        </div>
                    </li>
                </ul>
            </section>
        </div>

        <Dialog
            :model-value="previewOpen"
            size="sm"
            :title="preview === null ? '' : text(PREVIEW_TEXT[preview.relation].title)"
            :busy="busy === 'install'"
            @update:model-value="closePreview"
        >
            <template v-if="preview !== null">
                <p class="plugins-page__dialog-subject">{{ preview.installed === null ? `${preview.id} ${preview.version}` : `${preview.id} ${preview.installed} → ${preview.version}` }}</p>
                <p v-if="preview.relation === 'downgrade'" class="plugins-page__dialog-warning">{{ text(TEXT.downgrade) }}</p>
                <div v-if="preview.blocked.length > 0" class="plugins-page__dialog-warning" data-plugin-preview-blocked>
                    <p class="plugins-page__dialog-list-title">{{ text(TEXT.blocked) }}</p>
                    <ul class="plugins-page__dialog-list">
                        <li v-for="item in preview.blocked" :key="`${item.plugin} ${item.reason} ${item.range ?? item.service ?? ''}`" :data-plugin-preview-blocked-item="item.plugin">{{ blockedLine(item) }}</li>
                    </ul>
                </div>
                <p v-if="preview.unchecked.length > 0" class="plugins-page__dialog-text" data-plugin-preview-unchecked>{{ format(TEXT.unchecked, {plugins: list(preview.unchecked)}) }}</p>
                <p class="plugins-page__dialog-text">{{ text(TEXT.trust) }}</p>
                <p class="plugins-page__path">{{ previewPath }}</p>
            </template>
            <template #footer="{cancel}">
                <Button class="flex-1" variant="secondary" :disabled="busy === 'install'" @click="cancel">{{ text(TEXT.cancel) }}</Button>
                <Button class="flex-1" :loading="busy === 'install'" data-plugin-install-confirm @click="confirmInstall">{{ preview === null ? "" : text(PREVIEW_TEXT[preview.relation].confirm) }}</Button>
            </template>
        </Dialog>

        <Dialog
            :model-value="uninstallOpen"
            size="sm"
            :title="text(TEXT.uninstallTitle)"
            :busy="busy !== null && busy.startsWith('uninstall:')"
            @update:model-value="closeUninstall"
        >
            <p class="plugins-page__dialog-text">{{ uninstalling === null ? "" : format(TEXT.uninstallBody, {id: uninstalling.id}) }}</p>
            <template #footer="{cancel}">
                <Button class="flex-1" variant="secondary" :disabled="busy !== null" @click="cancel">{{ text(TEXT.cancel) }}</Button>
                <Button class="flex-1" variant="danger" :loading="busy !== null && busy.startsWith('uninstall:')" data-plugin-uninstall-confirm @click="confirmUninstall">{{ text(TEXT.uninstall) }}</Button>
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

.plugins-page__note {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-secondary);
}

.plugins-page__note--warning {
    color: var(--status-warning);
}

.plugins-page__note-icon {
    width: var(--text-sm);
    height: var(--text-sm);
    flex-shrink: 0;
}

.plugins-page__label,
.plugins-page__muted {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-muted);
}

/* 标签是表单里唯一的说明，不用最淡的字色。 */
.plugins-page__label {
    color: var(--text-secondary);
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

/* 空着时不占高度；`display: none` 让它暂时不在无障碍树里，第一次失败时容器与文字一起出现，靠 alert 角色出现时的播报。 */
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
    color: var(--text-secondary);
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

/* 组与组、安装区与第一组之间用设置列表的分组间距（SettingsListSection）。 */
.plugins-page__groups {
    display: flex;
    flex-direction: column;
    gap: var(--space-7);
    margin-top: calc(var(--space-7) - var(--space-4));
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

/*
 * 徽标默认不换行、高度只有一行；长文字（英文的“重启后升级到 x”、很长的版本号）在窄行里允许折行，高度随之撑开，
 * 不压到右边的控件、不溢出底框。
 */
.plugins-page__badge {
    max-width: 100%;
    height: auto;
    min-height: calc(var(--control-h-sm) * 0.68);
    padding-block: 1px;
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
    color: var(--text-secondary);
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
    overflow-wrap: anywhere;
}

.plugins-page__dialog-list-title {
    margin: 0;
}

.plugins-page__dialog-list {
    margin: var(--space-1) 0 0;
    padding-left: var(--space-5);
}

.plugins-page__dialog-text {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    line-height: var(--leading-ui);
    color: var(--text-main);
    overflow-wrap: anywhere;
}

.plugins-page__path {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-secondary);
    overflow-wrap: anywhere;
}
</style>
