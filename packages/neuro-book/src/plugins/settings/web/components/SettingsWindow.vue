<script setup lang="ts">
/**
 * 设置窗口（同名 .md）：窗口模型的呈现。外框是非模态的 Dialog，左栏分区、标签与右边的分区内容都读模型，操作交回模型
 * （docs/specs/settings/settings-window.md）。
 */
import {AlertDialog, Button, Dialog, Input, ScrollArea, SegmentedControl, Separator} from "@notnotype/nb-ui/components";
import type {SegmentedControlValue} from "@notnotype/nb-ui/components";
import {computed, nextTick, ref, useId, watch} from "vue";

import {formatText, localize} from "nbook/shared/localized-text";
import type {LocalizedText} from "nbook/shared/localized-text";
import type {SettingLayer} from "nbook/shared/settings";

import {DEFAULT_SETTINGS_WINDOW_SIZE, FILE_SECTION_ID, MIN_SETTINGS_WINDOW_SIZE} from "../settings-window";
import type {SettingsLeaveTarget, SettingsNavItem, SettingsWindow} from "../settings-window";
import {composing, isModKey} from "../keys";
import SettingsFileView from "./SettingsFileView.vue";
import SettingsListSection from "./SettingsListSection.vue";
import SettingsPageFrame from "./SettingsPageFrame.vue";

defineOptions({name: "SettingsWindow"});

const props = defineProps<{
    window: SettingsWindow;
}>();

const TEXT = {
    title: {"zh-CN": "设置", "en-US": "Settings"},
    close: {"zh-CN": "关闭", "en-US": "Close"},
    nav: {"zh-CN": "设置分区", "en-US": "Settings sections"},
    tabs: {"zh-CN": "设置的范围", "en-US": "Settings scope"},
    user: {"zh-CN": "用户", "en-US": "User"},
    project: {"zh-CN": "本作品", "en-US": "This Book"},
    invalid: {"zh-CN": "设置文件有错误，修好前这里不能保存", "en-US": "The settings file has errors; changes can't be saved until it is fixed"},
    invalidHere: {"zh-CN": "设置文件有错误，在下面改好后保存", "en-US": "The settings file has errors; fix it below and save"},
    unavailable: {"zh-CN": "暂时连不上，不能保存", "en-US": "Temporarily unreachable; changes can't be saved"},
    empty: {"zh-CN": "没有可以显示的设置", "en-US": "There are no settings to show"},
    search: {"zh-CN": "搜索设置", "en-US": "Search settings"},
    clearSearch: {"zh-CN": "清空搜索", "en-US": "Clear search"},
    noResults: {"zh-CN": "没有找到设置", "en-US": "No settings found"},
    pages: {"zh-CN": "页面", "en-US": "Pages"},
    openPage: {"zh-CN": "打开", "en-US": "Open"},
    openHit: {"zh-CN": "打开：{title}", "en-US": "Open: {title}"},
    results: {"zh-CN": "{settings} 个设置、{pages} 个页面", "en-US": "{settings} settings, {pages} pages"},
    leaveTitle: {"zh-CN": "放弃未保存的改动？", "en-US": "Discard unsaved changes?"},
    leaveDescription: {"zh-CN": "这个页面有还没保存的改动，离开后会丢掉。", "en-US": "This page has changes that haven't been saved. They will be lost if you leave."},
    discard: {"zh-CN": "放弃", "en-US": "Discard"},
    keepEditing: {"zh-CN": "继续编辑", "en-US": "Keep Editing"},
    openFile: {"zh-CN": "打开设置文件", "en-US": "Open Settings File"},
} satisfies Record<string, LocalizedText>;

const model = props.window;
const locale = model.locale;
const text = (template: LocalizedText, params: Readonly<Record<string, string | number>> = {}): string => localize(formatText(template, params), locale.value);

const root = ref<HTMLElement | null>(null);
const open = computed(() => model.open.value);
// 尺寸只在开着时读：记录在第一次打开时才打开（窗口入口的约定）。
const size = computed(() => (open.value ? model.size.value : DEFAULT_SETTINGS_WINDOW_SIZE));
const current = computed(() => model.current.value);
const page = computed(() => (current.value?.kind === "page" && current.value.unavailable === null ? model.page(current.value.id) : null));
const searching = computed(() => current.value?.kind === "search");

/** 层的说明（输出 13）：无效时带上原因（第几行、哪里不对）；在设置文件视图里说“在下面改好”，那里正是修的地方。 */
const noticeText = computed(() => {
    const notice = model.layerNotice.value;
    if (notice === null) return "";
    if (notice.kind === "unavailable") return text(TEXT.unavailable);
    return `${text(current.value?.kind === "file" ? TEXT.invalidHere : TEXT.invalid)}（${notice.detail}）`;
});
const searchId = `settings-search-${useId()}`;
const fill = computed(() => current.value?.kind === "page" && current.value.layout === "fill" && current.value.unavailable === null);

const tabOptions = computed(() => [
    {value: "user", label: text(TEXT.user)},
    {value: "project", label: text(TEXT.project)},
]);

/** 搜索时左栏不标当前项（输出 21）。 */
function isCurrent(item: SettingsNavItem): boolean {
    return !searching.value && item.id === model.section.value;
}

function navDisabled(item: SettingsNavItem): boolean {
    // 当前项在这个标签下不可用时仍可聚焦：它是左栏的 Tab 停靠点，右边原位写着原因。
    return item.unavailable !== null && item.id !== model.section.value;
}

const navItems = computed(() => model.nav.value.flatMap((group) => group.items));

function focusCurrent(): void {
    root.value?.querySelector<HTMLElement>("[data-settings-nav-current]")?.focus();
}

function onNavKeydown(event: KeyboardEvent): void {
    const enabled = navItems.value.filter((item) => item.unavailable === null || item.id === model.section.value);
    if (enabled.length === 0) return;
    const at = enabled.findIndex((item) => item.id === model.section.value);
    const target = event.key === "ArrowDown" ? enabled[Math.min(at + 1, enabled.length - 1)]
        : event.key === "ArrowUp" ? enabled[Math.max(at - 1, 0)]
            : event.key === "Home" ? enabled[0]
                : event.key === "End" ? enabled[enabled.length - 1]
                    : undefined;
    if (target === undefined) return;
    event.preventDefault();
    model.select(target.id);
    void nextTick(focusCurrent);
}

// 已开着时再执行打开命令：把焦点拉回窗口（输出 15“已开着时只聚焦”）。
watch(() => model.focusRequest.value, () => void nextTick(focusCurrent));

function searchInput(): HTMLInputElement | null {
    return root.value?.querySelector<HTMLInputElement>(`#${CSS.escape(searchId)}`) ?? null;
}

/**
 * `Mod+F` 只在窗口里接住（监听挂在窗口面板上，焦点在窗口外时浏览器与编辑器照旧）；焦点在设置文件的文本框里时放行，
 * 那里要的是浏览器的页内查找。
 */
function onRootKeydown(event: KeyboardEvent): void {
    if (composing(event) || !isModKey(event, "KeyF")) return;
    if (event.target instanceof Element && event.target.closest("[data-settings-file]") !== null) return;
    event.preventDefault();
    searchInput()?.focus();
}

/** 框里有字时 `Esc` 只清空；先拦下，窗口的 Esc 关闭看到已处理就不关（输出 21）。判定组字同窗口的 Esc。 */
function onSearchKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || composing(event) || model.query.value === "") return;
    event.preventDefault();
    model.search("");
}

/** 清除按钮点了之后它自己消失：焦点放回输入框，键盘用户不用重新找。 */
function onSearchClear(): void {
    void nextTick(() => searchInput()?.focus());
}

const resultCount = computed(() => {
    const view = current.value;
    if (view?.kind !== "search") return "";
    return text(TEXT.results, {settings: view.list.groups.reduce((sum, group) => sum + group.settings.length, 0), pages: view.pages.length});
});

function openHit(id: string): void {
    model.select(id);
    void nextTick(focusCurrent);
}

/**
 * 确认框关掉之后焦点去哪（AlertDialog 没有触发器时不自己归还）：“继续编辑”回到弹出之前的位置；“放弃”按动作去它该在的
 * 地方，从搜索框起手的回搜索框、切标签的回标签、其余到左栏的当前项。三样在确认框打开时记下，关掉时取走并清零。
 */
let beforeLeave: HTMLElement | null = null;
let leaveKind: SettingsLeaveTarget["kind"] | null = null;
let leaveConfirmed = false;
watch(() => model.leaving.value, (leaving, previous) => {
    if (leaving === null) return;
    if (previous === null) beforeLeave = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    leaveKind = leaving.kind;
});

function onLeaveClosed(): void {
    const target = beforeLeave;
    const kind = leaveKind;
    const confirmed = leaveConfirmed;
    beforeLeave = null;
    leaveKind = null;
    leaveConfirmed = false;
    if (!model.open.value) return;
    if (!confirmed) {
        if (target !== null && target.isConnected) target.focus();
        else focusCurrent();
    } else if (kind === "search") searchInput()?.focus();
    else if (kind === "layer") root.value?.querySelector<HTMLElement>("[data-settings-tabs] [aria-checked='true']")?.focus();
    else focusCurrent();
}

function confirmLeave(): void {
    leaveConfirmed = true;
    model.confirmLeave();
}

/** AlertDialog 是受控的：`Esc` 只发出 `update:open(false)`，要这里当作“继续编辑”。它也先于确认发出，所以等这一轮处理完再看。 */
function onLeaveOpen(open: boolean): void {
    if (open) return;
    queueMicrotask(() => {
        if (!leaveConfirmed) model.cancelLeave();
    });
}
</script>

<template>
    <Dialog
        :model-value="open"
        :modal="false"
        :title="text(TEXT.title)"
        :close-label="text(TEXT.close)"
        closable
        resizable
        :show-footer="false"
        :width="size.width"
        :height="size.height"
        :min-width="MIN_SETTINGS_WINDOW_SIZE.width"
        :min-height="MIN_SETTINGS_WINDOW_SIZE.height"
        initial-focus="[data-settings-nav-current]"
        @request-close="model.close()"
        @update:width="(width: number) => model.resize({width})"
        @update:height="(height: number) => model.resize({height})"
        @keydown="onRootKeydown"
    >
        <div ref="root" class="settings-window" data-settings-window>
            <SegmentedControl
                v-if="model.bound.value"
                class="settings-window__tabs"
                data-settings-tabs
                :model-value="model.layer.value"
                :options="tabOptions"
                :aria-label="text(TEXT.tabs)"
                @update:model-value="(value: SegmentedControlValue) => model.setLayer(value as SettingLayer)"
            />
            <div class="settings-window__split">
                <div class="settings-window__side">
                    <label :for="searchId" class="settings-window__visually-hidden">{{ text(TEXT.search) }}</label>
                    <Input
                        :id="searchId"
                        class="settings-window__search"
                        data-settings-search
                        type="search"
                        size="sm"
                        icon-class="i-lucide-search"
                        clearable
                        :clear-label="text(TEXT.clearSearch)"
                        :placeholder="text(TEXT.search)"
                        :model-value="model.query.value"
                        @update:model-value="(value: string) => model.search(value)"
                        @keydown="onSearchKeydown"
                        @clear="onSearchClear"
                    />
                    <nav class="settings-window__nav" :aria-label="text(TEXT.nav)" @keydown="onNavKeydown">
                        <template v-for="(group, index) in model.nav.value" :key="group.category">
                            <Separator v-if="index > 0" class="settings-window__nav-separator" data-settings-nav-separator />
                            <Button
                                v-for="item in group.items"
                                :key="item.id"
                                class="settings-window__nav-item"
                                :variant="isCurrent(item) ? 'secondary' : 'ghost'"
                                :icon-class="item.icon"
                                :disabled="navDisabled(item)"
                                :title="item.unavailable ?? undefined"
                                :tabindex="item.id === model.section.value ? 0 : -1"
                                :aria-current="isCurrent(item) ? 'page' : undefined"
                                :data-settings-nav="item.id"
                                :data-settings-nav-current="item.id === model.section.value ? '' : undefined"
                                block
                                @click="model.select(item.id)"
                            >{{ item.title }}</Button>
                        </template>
                    </nav>
                </div>
                <Separator orientation="vertical" class="settings-window__divider" />
                <div v-if="current === null" class="settings-window__empty">{{ text(TEXT.empty) }}</div>
                <!-- fill 页面拿到标题下面的整块区域，自己滚动；其余放进封顶的内容列，内容列滚动（输出 3）。 -->
                <div v-else-if="fill && page !== null" class="settings-window__fill" :data-settings-section="current.id">
                    <header class="settings-window__heading">
                        <h2 class="settings-window__title">{{ current.title }}</h2>
                        <p v-if="current.description !== null" class="settings-window__description">{{ current.description }}</p>
                    </header>
                    <p v-if="model.layerNotice.value !== null" class="settings-window__notice" :data-settings-layer-notice="model.layerNotice.value.kind" role="status">
                        <span class="i-lucide-triangle-alert settings-window__notice-icon" aria-hidden="true"></span>
                        <span>{{ noticeText }}</span>
                        <code v-if="model.layerNotice.value.kind === 'invalid' && model.layerNotice.value.path !== null" class="settings-window__path">{{ model.layerNotice.value.path }}</code>
                        <Button v-if="model.layerNotice.value.kind === 'invalid'" size="sm" variant="secondary" data-settings-open-file @click="model.select(FILE_SECTION_ID)">{{ text(TEXT.openFile) }}</Button>
                    </p>
                    <div class="settings-window__fill-body">
                        <SettingsPageFrame
                            :locale="locale"
                            :delivery="page.delivery"
                            :status="page.status"
                            :error="page.error"
                            :component="page.component"
                            :context="page.context"
                            :generation="page.generation"
                            :busy="page.busy"
                            @retry-entry="model.retryPageEntry(current.id)"
                            @reload="model.reloadPage(current.id)"
                            @retry-render="model.retryPageRender(current.id)"
                            @render-error="(generation: number, message: string) => model.pageRenderFailed(current!.id, generation, message)"
                        />
                    </div>
                </div>
                <ScrollArea v-else type="auto" class="settings-window__scroll">
                    <div class="settings-window__column" :data-settings-section="current.id">
                        <header class="settings-window__heading">
                            <h2 class="settings-window__title">{{ current.title }}</h2>
                            <p v-if="current.description !== null" class="settings-window__description">{{ current.description }}</p>
                        </header>
                        <p v-if="model.layerNotice.value !== null" class="settings-window__notice" :data-settings-layer-notice="model.layerNotice.value.kind" role="status">
                            <span class="i-lucide-triangle-alert settings-window__notice-icon" aria-hidden="true"></span>
                            <span>{{ noticeText }}</span>
                            <code v-if="model.layerNotice.value.kind === 'invalid' && model.layerNotice.value.path !== null" class="settings-window__path">{{ model.layerNotice.value.path }}</code>
                            <Button v-if="model.layerNotice.value.kind === 'invalid' && current.kind !== 'file'" size="sm" variant="secondary" data-settings-open-file @click="model.select(FILE_SECTION_ID)">{{ text(TEXT.openFile) }}</Button>
                        </p>
                        <p v-if="current.unavailable !== null" class="settings-window__unavailable" data-settings-unavailable>{{ current.unavailable }}</p>
                        <template v-else-if="current.kind === 'search'">
                            <span class="settings-window__visually-hidden" role="status" aria-live="polite" data-settings-result-count>{{ resultCount }}</span>
                            <!-- 换搜索词就重建：留在行里的不合格值随之丢掉（同换分区）。 -->
                            <SettingsListSection v-if="current.list.groups.length > 0" :key="current.query" :window="model" :view="current.list" />
                            <section v-if="current.pages.length > 0" class="settings-window__hits" data-settings-page-hits>
                                <h3 class="settings-window__hits-title">{{ text(TEXT.pages) }}</h3>
                                <div v-for="hit in current.pages" :key="hit.id" class="settings-window__hit" :data-settings-page-hit="hit.id">
                                    <div class="settings-window__hit-text">
                                        <span class="settings-window__hit-title">{{ hit.title }}</span>
                                        <span v-if="hit.description !== null" class="settings-window__description">{{ hit.description }}</span>
                                    </div>
                                    <Button size="sm" variant="secondary" :aria-label="text(TEXT.openHit, {title: hit.title})" @click="openHit(hit.id)">{{ text(TEXT.openPage) }}</Button>
                                </div>
                            </section>
                            <p v-if="current.list.groups.length === 0 && current.pages.length === 0" class="settings-window__unavailable" data-settings-no-results role="status">{{ text(TEXT.noResults) }}</p>
                        </template>
                        <SettingsListSection v-else-if="current.kind === 'list'" :window="model" :view="current" />
                        <SettingsFileView v-else-if="current.kind === 'file'" :window="model" :layer="current.layer" :path="current.path" />
                        <SettingsPageFrame
                            v-else-if="page !== null"
                            :locale="locale"
                            :delivery="page.delivery"
                            :status="page.status"
                            :error="page.error"
                            :component="page.component"
                            :context="page.context"
                            :generation="page.generation"
                            :busy="page.busy"
                            @retry-entry="model.retryPageEntry(current.id)"
                            @reload="model.reloadPage(current.id)"
                            @retry-render="model.retryPageRender(current.id)"
                            @render-error="(generation: number, message: string) => model.pageRenderFailed(current!.id, generation, message)"
                        />
                    </div>
                </ScrollArea>
            </div>
        </div>
        <AlertDialog
            :open="model.leaving.value !== null"
            :title="text(TEXT.leaveTitle)"
            :description="text(TEXT.leaveDescription)"
            :confirm-text="text(TEXT.discard)"
            :cancel-text="text(TEXT.keepEditing)"
            tone="warning"
            data-settings-leave
            @update:open="onLeaveOpen"
            @confirm="confirmLeave"
            @cancel="model.cancelLeave()"
            @closed="onLeaveClosed"
        />
    </Dialog>
</template>

<style scoped>
.settings-window {
    display: flex;
    height: 100%;
    min-height: 0;
    flex-direction: column;
    gap: var(--space-5);
    container-type: inline-size;
}

.settings-window__tabs {
    align-self: flex-start;
    flex-shrink: 0;
    margin-left: var(--space-2);
}

.settings-window__split {
    display: flex;
    min-height: 0;
    flex: 1;
}

/* 左栏：搜索框在上，分区在下、条目多时自己滚动。 */
.settings-window__side {
    display: flex;
    width: 180px;
    min-height: 0;
    flex-shrink: 0;
    flex-direction: column;
    gap: var(--space-3);
}

.settings-window__search {
    flex-shrink: 0;
    margin: var(--space-2) var(--space-5) 0 var(--space-2);
    width: auto;
}

.settings-window__visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}

/* 左栏四周留出焦点环的余量：它条目多时自己滚动，滚动容器会裁掉贴边的环。 */
.settings-window__nav {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1);
    overflow-y: auto;
    padding: var(--space-2) var(--space-5) var(--space-2) var(--space-2);
}

.settings-window__hits {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

/* 跟在设置项的结果后面时隔开一段，同分区里的小组。 */
[data-settings-list] + .settings-window__hits {
    margin-top: var(--space-7);
}

.settings-window__hits-title {
    margin: 0;
    padding-bottom: var(--space-3);
    border-bottom: var(--border-w) solid var(--divider);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    line-height: var(--leading-ui);
    color: var(--text-secondary);
}

.settings-window__hit {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
}

.settings-window__hit-text {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-1);
}

.settings-window__hit-title {
    font-size: var(--text-sm);
    line-height: var(--leading-ui);
    color: var(--text-main);
}

.settings-window__nav-item {
    flex-shrink: 0;
    justify-content: flex-start;
}

.settings-window__nav-separator {
    margin-block: var(--space-4);
}

.settings-window__divider {
    flex-shrink: 0;
}

.settings-window__scroll {
    height: 100%;
    min-width: 0;
    flex: 1;
}

/* 内容列：左边留出已修改竖线的位置（SettingsRow 把它画在行左边 --space-5 处）。 */
.settings-window__column {
    max-width: 768px;
    padding: var(--space-2) var(--space-6) var(--space-6) var(--space-7);
}

.settings-window__fill {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    padding: var(--space-2) var(--space-6) 0 var(--space-7);
}

.settings-window__fill-body {
    min-height: 0;
    flex: 1;
}

.settings-window__heading {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-6);
}

.settings-window__title {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: var(--weight-strong);
    line-height: var(--leading-tight);
    color: var(--text-main);
}

.settings-window__description {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-muted);
}

.settings-window__notice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin: 0 0 var(--space-6);
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--status-warning);
}

.settings-window__notice-icon {
    width: var(--text-sm);
    height: var(--text-sm);
    flex-shrink: 0;
}

.settings-window__path {
    min-width: 0;
    font-family: var(--font-mono);
    color: var(--text-secondary);
    overflow-wrap: anywhere;
}

.settings-window__unavailable,
.settings-window__empty {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-ui);
    color: var(--text-secondary);
}

.settings-window__empty {
    padding: var(--space-6);
}

/* 窄容器（手机宽度的画布）：左栏移到上方、条目换行，右边不封顶。设置窗口只做桌面宽度，这一档只保证不横向溢出。 */
@container (max-width: 600px) {
    .settings-window__split {
        flex-direction: column;
        overflow-y: auto;
    }

    .settings-window__side {
        width: auto;
    }

    .settings-window__nav {
        width: auto;
        flex-direction: row;
        flex-wrap: wrap;
        overflow: visible;
        padding: var(--space-2);
    }

    .settings-window__nav-item {
        width: auto;
    }

    .settings-window__nav-separator,
    .settings-window__divider {
        display: none;
    }

    .settings-window__scroll {
        height: auto;
        flex: none;
    }

    .settings-window__column,
    .settings-window__fill {
        max-width: none;
        padding-inline: var(--space-6);
    }
}
</style>
