<script setup lang="ts">
/**
 * 设置窗口（同名 .md）：窗口模型的呈现。外框是非模态的 Dialog，左栏分区、标签与右边的分区内容都读模型，操作交回模型
 * （docs/specs/settings/settings-window.md）。
 */
import {AlertDialog, Dialog, Input, ScrollArea, SegmentedControl, Separator, Tooltip} from "@notnotype/nb-ui/components";
import type {SegmentedControlValue} from "@notnotype/nb-ui/components";
import {computed, nextTick, provide, ref, useId, watch} from "vue";

import {formatText, localize} from "nbook/shared/localized-text";
import type {LocalizedText} from "nbook/shared/localized-text";
import type {SettingLayer} from "nbook/shared/settings";
import HighlightedText from "nbook/ui/settings/HighlightedText.vue";
import {createPageChrome, SETTINGS_PAGE_CHROME} from "nbook/ui/settings/page-chrome";

import {DEFAULT_SETTINGS_WINDOW_SIZE, MIN_SETTINGS_WINDOW_SIZE} from "../settings-window";
import type {SettingsLeaveTarget, SettingsNavItem, SettingsWindow} from "../settings-window";
import {composing, isModKey} from "../keys";
import SettingsFileView from "./SettingsFileView.vue";
import SettingsListSection from "./SettingsListSection.vue";
import SettingsPageFrame from "./SettingsPageFrame.vue";
import SettingsSectionHeading from "./SettingsSectionHeading.vue";
import type {SettingsSectionNotice, SettingsSectionReplacement} from "./SettingsSectionHeading.vue";

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
    invalid: {"zh-CN": "设置文件格式有误", "en-US": "Settings file has errors"},
    openAction: {"zh-CN": "打开", "en-US": "Open"},
    invalidAt: {"zh-CN": "第 {line} 行第 {column} 列：{reason}", "en-US": "Line {line}, column {column}: {reason}"},
    cannotSave: {"zh-CN": "修复前，这一层的设置无法保存", "en-US": "Settings on this layer can't be saved until it is fixed"},
    fixAt: {"zh-CN": "第 {line} 行第 {column} 列：{reason}，改好后保存", "en-US": "Line {line}, column {column}: {reason}. Save once it's fixed"},
    fixHere: {"zh-CN": "{reason}，改好后保存", "en-US": "{reason}. Save once it's fixed"},
    unavailable: {"zh-CN": "暂时无法连接，无法保存", "en-US": "Temporarily unreachable; can't save"},
    empty: {"zh-CN": "没有可以显示的设置", "en-US": "There are no settings to show"},
    search: {"zh-CN": "搜索设置", "en-US": "Search settings"},
    clearSearch: {"zh-CN": "清空搜索", "en-US": "Clear search"},
    noResults: {"zh-CN": "没有找到设置", "en-US": "No settings found"},
    pages: {"zh-CN": "页面", "en-US": "Pages"},
    openPage: {"zh-CN": "打开", "en-US": "Open"},
    groupApp: {"zh-CN": "通用", "en-US": "General"},
    groupAi: {"zh-CN": "写作助手", "en-US": "Writing assistant"},
    groupPlugins: {"zh-CN": "扩展", "en-US": "Extensions"},
    openHit: {"zh-CN": "打开：{title}", "en-US": "Open: {title}"},
    back: {"zh-CN": "返回 {title}", "en-US": "Back to {title}"},
    results: {"zh-CN": "{settings} 个设置、{pages} 个页面", "en-US": "{settings} settings, {pages} pages"},
    leaveTitle: {"zh-CN": "放弃未保存的更改？", "en-US": "Discard unsaved changes?"},
    leaveDescription: {"zh-CN": "“{title}”有未保存的更改。离开此页面后，这些更改将会丢失。", "en-US": "“{title}” has unsaved changes. They will be lost if you leave this page."},
    discard: {"zh-CN": "放弃", "en-US": "Discard"},
    keepEditing: {"zh-CN": "继续编辑", "en-US": "Keep Editing"},
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

// 标题区的通道（`page-chrome.ts`）：页面里的 `SettingsPageActions`、`SettingsPageList` 经它与标题区说话。
const chrome = createPageChrome(model.writable);
provide(SETTINGS_PAGE_CHROME, chrome);

/**
 * 标题区右侧的层警告（输出 13）：`invalid` 是按钮，悬停写位置与原因、“修复前……”与路径；`unavailable` 是文字；在设置文件视图里
 * 层无效时不再给按钮（那里就是修的地方），改写“第 N 行第 M 列：原因，改好后保存”；视图自己登记了提示（保存被拒）时写它。
 */
const notice = computed((): SettingsSectionNotice | null => {
    const layer = model.layerNotice.value;
    if (layer?.kind === "unavailable") return {kind: "unavailable", text: text(TEXT.unavailable)};
    // 设置文件视图保存被拒时自己写的“未保存：第 N 行第 M 列：原因”：位置是刚保存的那份文本的，比层快照里的更新，盖过它。
    const note = chrome.note.value;
    if (note !== null) return {kind: "fixing", text: note};
    if (layer === null) return null;
    // 没有语法位置的无效（文件读不出来）只有 detail。
    const reason = layer.reason ?? layer.detail;
    if (current.value?.kind === "file") {
        return {kind: "fixing", text: layer.position === null ? text(TEXT.fixHere, {reason}) : text(TEXT.fixAt, {line: layer.position.line, column: layer.position.column, reason})};
    }
    const first = layer.position === null ? reason : text(TEXT.invalidAt, {line: layer.position.line, column: layer.position.column, reason});
    return {kind: "invalid", text: text(TEXT.invalid), action: text(TEXT.openAction), lines: [first, text(TEXT.cannotSave), ...(layer.path === null ? [] : [layer.path])]};
});

/** 点层警告：打开这一层的设置文件并定位到出错处（有位置时）；有未保存的改动时先确认。 */
function openFile(): void {
    const layer = model.layerNotice.value;
    if (layer?.kind !== "invalid") return;
    model.openFile(model.layer.value, layer.position ?? undefined);
}

/** 页面登记了标题替换时，标题区写“‹ 分区标题”与页面给的标题（输出 19）；只对 page 分区生效。 */
const replacement = computed((): SettingsSectionReplacement | null => {
    const claim = chrome.titleClaim.value;
    return claim === null || current.value?.kind !== "page" ? null : {title: claim.title, backLabel: current.value.title, backName: text(TEXT.back, {title: current.value.title})};
});
const searchId = `settings-search-${useId()}`;
const navId = useId();
/** 左栏三组的组标题（输出 1）。 */
const GROUP_TITLE = {app: TEXT.groupApp, ai: TEXT.groupAi, plugins: TEXT.groupPlugins} as const;
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
    // 窄窗口里分区横排：左右键与上下键同义，两种排法都认，不按版式分支。
    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    const backward = event.key === "ArrowUp" || event.key === "ArrowLeft";
    const target = forward ? enabled[Math.min(at + 1, enabled.length - 1)]
        : backward ? enabled[Math.max(at - 1, 0)]
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
 * 地方，从搜索框起手的回搜索框、切标签的回标签、打开设置文件的进文本框，其余到左栏的当前项。三样在确认框打开时记下，
 * 关掉时取走并清零。
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
    else if (kind === "file") focusFileText();
    else focusCurrent();
}

/**
 * 打开设置文件之后焦点在文本框里。`closed` 在确认框的关闭动画之后才来，文件视图可能已经读完并按出错位置把光标放好了，
 * 这时不动它；还在读的时候由视图读完定位时自己聚焦。
 */
function focusFileText(): void {
    const view = root.value?.querySelector<HTMLElement>("[data-settings-file]");
    if (view === null || view === undefined || view.contains(document.activeElement)) return;
    view.querySelector<HTMLElement>("[data-settings-file-text]")?.focus();
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
            <div class="settings-window__split">
                <div class="settings-window__side">
                    <!-- 层标签与搜索框：宽窗口里上下叠，窄窗口里并排（输出 16）。 -->
                    <div class="settings-window__side-tools">
                        <SegmentedControl
                            v-if="model.bound.value"
                            class="settings-window__tabs"
                            data-settings-tabs
                            full-width
                            :model-value="model.layer.value"
                            :options="tabOptions"
                            :aria-label="text(TEXT.tabs)"
                            @update:model-value="(value: SegmentedControlValue) => model.setLayer(value as SettingLayer)"
                        />
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
                    </div>
                    <nav class="settings-window__nav" :aria-label="text(TEXT.nav)" @keydown="onNavKeydown">
                        <div v-for="group in model.nav.value" :key="group.category" class="settings-window__nav-group" role="group" :aria-labelledby="`${navId}-${group.category}`">
                            <p :id="`${navId}-${group.category}`" class="settings-window__nav-label" :data-settings-nav-label="group.category">{{ text(GROUP_TITLE[group.category]) }}</p>
                            <!--
                                列表行，不是按钮的外观：没有描边，悬停与当前项各是一层淡底，按下不缩放。停用项用 aria-disabled 而不是
                                disabled：原生停用的按钮收不到指针事件，悬停出不了原因的 Tooltip；原因另经 aria-describedby 给读屏。
                            -->
                            <Tooltip v-for="item in group.items" :key="item.id" :text="item.unavailable ?? ''" :disabled="!navDisabled(item)" placement="right">
                                <button
                                    type="button"
                                    class="settings-window__nav-item nb-ui-focus-ring-inset"
                                    :aria-disabled="navDisabled(item) ? 'true' : undefined"
                                    :aria-describedby="navDisabled(item) ? `${navId}-why-${item.id}` : undefined"
                                    :tabindex="item.id === model.section.value ? 0 : -1"
                                    :aria-current="isCurrent(item) ? 'page' : undefined"
                                    :data-settings-nav="item.id"
                                    :data-settings-nav-current="item.id === model.section.value ? '' : undefined"
                                    @click="navDisabled(item) || model.select(item.id)"
                                >
                                    <span :class="item.icon" class="settings-window__nav-icon" aria-hidden="true"></span>
                                    <span class="settings-window__nav-text">{{ item.title }}</span>
                                </button>
                            </Tooltip>
                            <template v-for="item in group.items" :key="item.id">
                                <span v-if="navDisabled(item)" :id="`${navId}-why-${item.id}`" class="settings-window__visually-hidden">{{ item.unavailable }}</span>
                            </template>
                        </div>
                    </nav>
                </div>
                <Separator orientation="vertical" class="settings-window__divider" />
                <div v-if="current === null" class="settings-window__empty">{{ text(TEXT.empty) }}</div>
                <!--
                    fill 页面拿到标题下面的整块区域，自己滚动；其余放进封顶的内容列，内容列滚动（输出 3）。设置文件也占整块：文本框随
                    窗口高度伸缩，保存栏钉在底部，不随内容滚到折叠线下面（输出 23）。
                -->
                <div v-else-if="(fill && page !== null) || current.kind === 'file'" class="settings-window__fill" :data-settings-section="current.id">
                    <SettingsSectionHeading :title="current.title" :description="current.description" :notice="notice" :replacement="replacement" @open-file="openFile" @back="chrome.titleClaim.value?.back()" />
                    <div class="settings-window__fill-body">
                        <SettingsFileView v-if="current.kind === 'file'" :window="model" :layer="current.layer" :path="current.path" />
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
                </div>
                <ScrollArea v-else type="auto" class="settings-window__scroll">
                    <div class="settings-window__column" :data-settings-section="current.id">
                        <SettingsSectionHeading :title="current.title" :description="current.description" :notice="notice" :replacement="replacement" @open-file="openFile" @back="chrome.titleClaim.value?.back()" />
                        <p v-if="current.unavailable !== null" class="settings-window__unavailable" data-settings-unavailable>{{ current.unavailable }}</p>
                        <template v-else-if="current.kind === 'search'">
                            <span class="settings-window__visually-hidden" role="status" aria-live="polite" data-settings-result-count>{{ resultCount }}</span>
                            <!-- 换搜索词就重建：留在行里的不合格值随之丢掉（同换分区）。 -->
                            <SettingsListSection v-if="current.list.groups.length > 0" :key="current.query" :window="model" :view="current.list" :highlight="current.words" />
                            <section v-if="current.pages.length > 0" class="settings-window__hits" data-settings-page-hits>
                                <h3 class="settings-window__hits-title">{{ text(TEXT.pages) }}</h3>
                                <!-- 一条一行，整行可点；右端“打开 ›”。 -->
                                <button v-for="hit in current.pages" :key="hit.id" type="button" class="settings-window__hit nb-ui-focus-ring-inset" :aria-label="text(TEXT.openHit, {title: hit.title})" :data-settings-page-hit="hit.id" @click="openHit(hit.id)">
                                    <span class="settings-window__hit-text">
                                        <span class="settings-window__hit-title"><HighlightedText :text="hit.title" :words="current.words" /></span>
                                        <span v-if="hit.description !== null" class="settings-window__description"><HighlightedText :text="hit.description" :words="current.words" /></span>
                                    </span>
                                    <span class="settings-window__hit-open" aria-hidden="true">{{ text(TEXT.openPage) }}<span class="i-lucide-chevron-right"></span></span>
                                </button>
                            </section>
                            <p v-if="current.list.groups.length === 0 && current.pages.length === 0" class="settings-window__unavailable" data-settings-no-results role="status">{{ text(TEXT.noResults) }}</p>
                        </template>
                        <SettingsListSection v-else-if="current.kind === 'list'" :window="model" :view="current" />
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
            :description="text(TEXT.leaveDescription, {title: current?.title ?? ''})"
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
/* 左栏的宽度与内边距：层标签、搜索框与分区条目都按它们对齐，改一处三者一起动。 */
.settings-window {
    --settings-side-width: 212px;
    --settings-side-inset-start: var(--space-2);
    --settings-side-inset-end: var(--space-5);

    display: flex;
    height: 100%;
    min-height: 0;
    flex-direction: column;
    container-type: inline-size;
}

.settings-window__split {
    display: flex;
    min-height: 0;
    flex: 1;
}

/* 左栏：层标签与搜索框在上，分区在下、条目多时自己滚动。 */
.settings-window__side {
    display: flex;
    width: var(--settings-side-width);
    min-height: 0;
    flex-shrink: 0;
    flex-direction: column;
    gap: var(--space-5);
}

.settings-window__side-tools {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-right: var(--settings-side-inset-end);
    padding-left: var(--settings-side-inset-start);
}

.settings-window__tabs {
    flex-shrink: 0;
}

.settings-window__search {
    flex-shrink: 0;
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

/* 左栏四周留出焦点线的余量：它条目多时自己滚动，滚动容器会裁掉贴边的线。 */
.settings-window__nav {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    gap: var(--space-5);
    overflow-y: auto;
    padding: var(--space-2) var(--settings-side-inset-end) var(--space-2) var(--settings-side-inset-start);
}

.settings-window__nav-group {
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.settings-window__nav-label {
    margin: 0 0 var(--space-2);
    padding-inline: var(--space-4);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    line-height: var(--leading-ui);
    color: var(--text-muted);
}

/* 悬停与当前项都是半透明叠色（浮层上的高亮规则，不用实色）；点下不缩放、不位移。 */
.settings-window__nav-item {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--space-4);
    min-height: var(--control-h-sm);
    padding: 0 var(--space-4);
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color var(--motion-fast) var(--ease-standard), color var(--motion-fast) var(--ease-standard);
}

.settings-window__nav-item:hover:not([aria-disabled="true"]) {
    background: color-mix(in srgb, var(--text-main) 6%, transparent);
    color: var(--text-main);
}

.settings-window__nav-item[aria-current="page"] {
    background: var(--overlay-item-active);
    color: var(--text-main);
    font-weight: var(--weight-medium);
}

.settings-window__nav-item[aria-disabled="true"] {
    cursor: not-allowed;
    opacity: 0.5;
}

.settings-window__nav-icon {
    flex-shrink: 0;
    font-size: var(--text-lg);
}

.settings-window__nav-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
}

.settings-window__hits {
    display: flex;
    flex-direction: column;
}

/* 跟在设置项的结果后面时隔开一段，同分区里的小组。 */
[data-settings-list] + .settings-window__hits {
    margin-top: var(--space-7);
}

.settings-window__hits-title {
    margin: 0 0 var(--space-2);
    padding-bottom: var(--space-3);
    border-bottom: var(--border-w) solid var(--divider);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    line-height: var(--leading-ui);
    color: var(--text-secondary);
}

/* 页面命中：整行是一个按钮，悬停一层淡底，向两侧探出一点好让文字与别的行对齐。 */
.settings-window__hit {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-5);
    width: calc(100% + 2 * var(--space-4));
    min-height: 48px;
    margin-inline: calc(-1 * var(--space-4));
    padding: var(--space-4);
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
}

.settings-window__hit:hover {
    background: color-mix(in srgb, var(--text-main) 5%, transparent);
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

.settings-window__hit-open {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--accent-text);
}

.settings-window__divider {
    flex-shrink: 0;
}

.settings-window__scroll {
    height: 100%;
    min-width: 0;
    flex: 1;
}

/* 内容列：左右内边距相同，标题与行的左边就是它的左边。 */
.settings-window__column {
    max-width: 720px;
    padding: var(--space-2) var(--space-6) var(--space-6);
}

.settings-window__fill {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    padding: var(--space-2) var(--space-6) 0;
}

.settings-window__fill-body {
    min-height: 0;
    flex: 1;
}

.settings-window__description {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-muted);
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

/*
 * 窄窗口（窗口自己比 600px 窄，输出 16）：左栏变成顶上两行，第一行层标签与搜索框并排，第二行分区横排、可以横向滚动，
 * 不显示组标题与图标；右边在左栏下面，不再封顶。判据是窗口自己的宽度（`.settings-window` 是尺寸容器），不是屏幕宽度。
 */
@container (max-width: 600px) {
    .settings-window__split {
        flex-direction: column;
        overflow-y: auto;
    }

    /* 四周留出焦点光晕的余量：左栏在会滚动的 `__split` 里，贴着它的边会把标签与搜索框的光晕裁掉。 */
    .settings-window__side {
        width: auto;
        gap: var(--space-3);
        padding-top: var(--space-4);
        border-bottom: var(--border-w) solid var(--divider);
    }

    .settings-window__side-tools {
        flex-direction: row;
        align-items: center;
        padding-inline: var(--space-4);
    }

    .settings-window__tabs {
        flex: 0 0 140px;
        width: 140px;
    }

    .settings-window__search {
        min-width: 0;
        flex: 1 1 auto;
    }

    .settings-window__nav {
        flex: none;
        flex-direction: row;
        gap: var(--space-1);
        overflow: auto hidden;
        padding-inline: var(--space-4);
        scrollbar-width: none;
    }

    .settings-window__nav-group {
        flex-direction: row;
        gap: var(--space-1);
    }

    .settings-window__nav-label,
    .settings-window__nav-icon,
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
        padding-top: var(--space-5);
    }
}
</style>
