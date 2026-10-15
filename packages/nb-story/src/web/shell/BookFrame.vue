<script setup lang="ts">
/**
 * 一本书的外壳（docs/specs/story/viewer.md 输出 1 到 5、32、33）：顶栏（书名、阅读位置、搜索）、左侧导航、主区、
 * 右侧抽屉、页脚。宽度三档按外壳自己的宽度算：宽屏三栏可拖；平板导航收成图标条、抽屉浮在主区右侧；手机顶栏两行、
 * 底部常用页签、抽屉从底部拉起。
 */
import {IconButton, Splitter} from "@notnotype/nb-ui/components";
import type {SplitterPanelConfig} from "@notnotype/nb-ui/components";
import {computed, defineAsyncComponent, onBeforeUnmount, onMounted, provide, ref, watch} from "vue";

import {BOOK_SESSION, type BookSession, type Page} from "../host/book";
import {readDrawerWidth, readNavCollapsed, writeDrawerWidth, writeNavCollapsed} from "../host/prefs";
import ReadingControl from "../parts/ReadingControl.vue";
import DrawerCard from "./DrawerCard.vue";
import DrawerNode from "./DrawerNode.vue";
import DrawerParagraph from "./DrawerParagraph.vue";
import DrawerSource from "./DrawerSource.vue";
import SearchBox from "./SearchBox.vue";

const props = defineProps<{session: BookSession}>();
const book = props.session;
provide(BOOK_SESSION, book);

const NAV: ReadonlyArray<{id: Page; label: string; icon: string}> = [
    {id: "overview", label: "全书总览", icon: "i-lucide-layout-dashboard"},
    {id: "relations", label: "关系图", icon: "i-lucide-share-2"},
    {id: "book-graph", label: "全书图", icon: "i-lucide-network"},
    {id: "roster", label: "人物", icon: "i-lucide-users"},
    {id: "secrets", label: "秘密", icon: "i-lucide-eye-off"},
    {id: "ledger", label: "数值", icon: "i-lucide-coins"},
    {id: "questions", label: "悬念", icon: "i-lucide-circle-help"},
    {id: "timeline", label: "时间线", icon: "i-lucide-clock"},
    {id: "episodes", label: "情节", icon: "i-lucide-list-tree"},
    {id: "source", label: "原文", icon: "i-lucide-book-open"},
    {id: "stats", label: "说明与统计", icon: "i-lucide-info"},
];
const PHONE_TABS: ReadonlyArray<{id: Page; label: string; icon: string}> = [
    {id: "overview", label: "总览", icon: "i-lucide-layout-dashboard"},
    {id: "roster", label: "人物", icon: "i-lucide-users"},
    {id: "relations", label: "关系图", icon: "i-lucide-share-2"},
];

// 页面按需加载：图的依赖（sigma、graphology）只在打开图的页面时才下载。
const PAGES: Record<Page, ReturnType<typeof defineAsyncComponent>> = {
    overview: defineAsyncComponent(() => import("../pages/OverviewPage.vue")),
    relations: defineAsyncComponent(() => import("../pages/RelationsPage.vue")),
    "book-graph": defineAsyncComponent(() => import("../pages/BookGraphPage.vue")),
    roster: defineAsyncComponent(() => import("../pages/RosterPage.vue")),
    secrets: defineAsyncComponent(() => import("../pages/SecretsPage.vue")),
    ledger: defineAsyncComponent(() => import("../pages/LedgerPage.vue")),
    questions: defineAsyncComponent(() => import("../pages/QuestionsPage.vue")),
    timeline: defineAsyncComponent(() => import("../pages/TimelinePage.vue")),
    episodes: defineAsyncComponent(() => import("../pages/EpisodesPage.vue")),
    source: defineAsyncComponent(() => import("../pages/SourcePage.vue")),
    stats: defineAsyncComponent(() => import("../pages/StatsPage.vue")),
};

const root = ref<HTMLElement | null>(null);
const width = ref(1440);
const tier = computed<"wide" | "tablet" | "phone">(() => (width.value < 720 ? "phone" : width.value < 1100 ? "tablet" : "wide"));
const overlayDrawer = computed(() => tier.value !== "wide");
const navCollapsed = ref(readNavCollapsed());
const navSheet = ref(false);
const drawerWidth = ref(readDrawerWidth());
let observer: ResizeObserver | null = null;
onMounted(() => {
    observer = new ResizeObserver(([entry]) => {
        width.value = entry!.contentRect.width;
    });
    if (root.value) observer.observe(root.value);
});
onBeforeUnmount(() => observer?.disconnect());

const navIsCollapsed = computed(() => tier.value === "tablet" || navCollapsed.value);
const panels = computed<SplitterPanelConfig[]>(() => [
    {id: "nav", defaultSizePx: 188, minSizePx: 150, maxSizePx: 300, sizing: "fixed", collapse: {collapsedSize: 44, restoreSize: 188, collapseThreshold: 60, expandThreshold: 40, collapsed: navIsCollapsed.value}},
    {id: "main", minSizePx: 360, sizing: "weight"},
    {id: "drawer", defaultSizePx: drawerWidth.value, minSizePx: 280, maxSizePx: 640, sizing: "fixed", collapse: {collapsedSize: 0, restoreSize: drawerWidth.value, collapseThreshold: 80, expandThreshold: 40, collapsed: book.drawer.value === null}},
]);

function onGestureEnd(state: {collapsed?: Readonly<Record<string, boolean>>; sizesPx?: readonly number[]}): void {
    const collapsed = state.collapsed ?? {};
    if (collapsed.nav !== undefined) setNavCollapsed(collapsed.nav);
    if (collapsed.drawer === true) book.closeDrawer();
    const drawerSize = state.sizesPx?.[2];
    if (drawerSize !== undefined && drawerSize >= 280) {
        drawerWidth.value = drawerSize;
        writeDrawerWidth(drawerSize);
    }
}
function setNavCollapsed(value: boolean): void {
    navCollapsed.value = value;
    writeNavCollapsed(value);
}
function goPage(page: Page): void {
    book.goPage(page);
    navSheet.value = false;
}

const notice = book.notice;
watch(notice, value => {
    if (value) setTimeout(() => {
        if (notice.value === value) notice.value = null;
    }, 8000);
}, {immediate: true});
</script>

<template>
    <div ref="root" class="book-frame relative flex h-full w-full flex-col overflow-hidden" :data-tier="tier" data-testid="book-frame">
        <header class="shrink-0 border-b border-[var(--divider)] px-3 py-2" :class="tier === 'phone' ? 'flex flex-col gap-2' : 'flex items-center gap-3'">
            <div class="flex min-w-0 items-center gap-2" :class="tier === 'phone' ? 'w-full' : ''">
                <IconButton v-if="tier === 'phone'" size="sm" icon-class="i-lucide-menu" aria-label="打开导航" @click="navSheet = true" />
                <span class="i-lucide-book-marked shrink-0 text-[var(--accent-text)]" />
                <span class="truncate font-[var(--weight-strong)]" data-testid="book-title">{{ book.info.title }}</span>
                <SearchBox v-if="tier === 'phone'" class="ml-auto" compact />
            </div>
            <ReadingControl :class="tier === 'phone' ? 'w-full' : 'shrink-0'" :at="book.at.value" :paragraphs="book.info.paragraphs" :compact="tier !== 'wide'" @update:at="book.setAt" />
            <SearchBox v-if="tier !== 'phone'" class="ml-auto" :compact="tier === 'tablet'" />
        </header>

        <div class="relative min-h-0 flex-1">
            <Splitter v-if="tier !== 'phone'" class="h-full" :panels="overlayDrawer ? panels.slice(0, 2) : panels" :sash-sizes="overlayDrawer ? [1] : [1, 1]" @gesture-end="onGestureEnd">
                <template #panel-nav>
                    <nav class="flex h-full flex-col gap-0.5 overflow-y-auto py-2" :class="navIsCollapsed ? 'items-center px-1' : 'px-2'" aria-label="页面">
                        <button
                            v-for="item in NAV" :key="item.id" type="button" class="nav-item flex items-center gap-2 rounded-[var(--radius-control)] py-1.5 text-[var(--text-sm)]"
                            :class="[book.page.value === item.id ? 'is-active' : '', navIsCollapsed ? 'justify-center px-1.5' : 'px-2']"
                            :title="item.label" :aria-current="book.page.value === item.id ? 'page' : undefined" :data-page="item.id" @click="goPage(item.id)"
                        >
                            <span :class="item.icon" class="shrink-0" />
                            <span v-if="!navIsCollapsed" class="truncate">{{ item.label }}</span>
                        </button>
                        <div class="flex-1" />
                        <IconButton v-if="tier === 'wide'" size="xs" :icon-class="navCollapsed ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'" :aria-label="navCollapsed ? '展开导航' : '收起导航'" @click="setNavCollapsed(!navCollapsed)" />
                    </nav>
                </template>
                <template #panel-main>
                    <main class="h-full min-w-0" data-testid="main">
                        <component :is="PAGES[book.page.value]" :key="book.page.value" />
                    </main>
                </template>
                <template v-if="!overlayDrawer" #panel-drawer>
                    <aside class="h-full min-w-0 overflow-hidden border-l border-[var(--divider)]" data-testid="drawer">
                        <DrawerCard v-if="book.drawer.value?.kind === 'card'" :entity="book.drawer.value.entity" :tab="book.drawer.value.tab" />
                        <DrawerSource v-else-if="book.drawer.value?.kind === 'source'" :ref-text="book.drawer.value.ref" class="story-scroll-y h-full" />
                        <DrawerParagraph v-else-if="book.drawer.value?.kind === 'para'" :chapter="book.drawer.value.chapter" :paragraph="book.drawer.value.paragraph" class="story-scroll-y h-full" />
                        <DrawerNode v-else-if="book.drawer.value?.kind === 'node'" :id="book.drawer.value.id" :label="book.drawer.value.label" class="story-scroll-y h-full" />
                    </aside>
                </template>
            </Splitter>
            <main v-else class="h-full min-w-0 pb-12" data-testid="main">
                <component :is="PAGES[book.page.value]" :key="book.page.value" />
            </main>

            <!-- 平板与手机：抽屉是浮层，不挤窄主区；点外面关掉（输出 32、33） -->
            <template v-if="overlayDrawer && book.drawer.value">
                <div class="absolute inset-0 z-20 bg-[var(--overlay-bg)]" data-testid="drawer-scrim" @click="book.closeDrawer()" />
                <aside
                    class="drawer-overlay absolute z-30 flex flex-col overflow-hidden border-[var(--divider)] bg-[var(--bg-panel)] shadow-[var(--shadow-panel)]"
                    :class="tier === 'phone' ? 'inset-x-0 bottom-0 h-[78%] rounded-t-[12px] border-t' : 'inset-y-0 right-0 w-[min(420px,90%)] border-l'" data-testid="drawer"
                >
                    <div v-if="book.drawer.value.kind !== 'card'" class="flex justify-end px-2 pt-1"><IconButton size="xs" icon-class="i-lucide-x" aria-label="关闭" @click="book.closeDrawer()" /></div>
                    <div class="min-h-0 flex-1">
                        <DrawerCard v-if="book.drawer.value.kind === 'card'" :entity="book.drawer.value.entity" :tab="book.drawer.value.tab" />
                        <DrawerSource v-else-if="book.drawer.value.kind === 'source'" :ref-text="book.drawer.value.ref" class="story-scroll-y h-full" />
                        <DrawerParagraph v-else-if="book.drawer.value.kind === 'para'" :chapter="book.drawer.value.chapter" :paragraph="book.drawer.value.paragraph" class="story-scroll-y h-full" />
                        <DrawerNode v-else :id="book.drawer.value.id" :label="book.drawer.value.label" class="story-scroll-y h-full" />
                    </div>
                </aside>
            </template>

            <!-- 手机：底部常用页签与“更多” -->
            <nav v-if="tier === 'phone'" class="absolute inset-x-0 bottom-0 z-10 flex border-t border-[var(--divider)] bg-[var(--bg-panel)]" aria-label="常用页面">
                <button v-for="item in PHONE_TABS" :key="item.id" type="button" class="flex flex-1 flex-col items-center py-1 text-[var(--text-2xs)]" :class="book.page.value === item.id ? 'text-[var(--accent-text)]' : ''" @click="goPage(item.id)">
                    <span :class="item.icon" />{{ item.label }}
                </button>
                <button type="button" class="flex flex-1 flex-col items-center py-1 text-[var(--text-2xs)]" @click="navSheet = true"><span class="i-lucide-menu" />更多</button>
            </nav>
            <template v-if="tier === 'phone' && navSheet">
                <div class="absolute inset-0 z-20 bg-[var(--overlay-bg)]" @click="navSheet = false" />
                <nav class="absolute inset-y-0 left-0 z-30 flex w-[220px] flex-col gap-0.5 bg-[var(--bg-panel)] p-2 shadow-[var(--shadow-panel)]" aria-label="页面">
                    <button v-for="item in NAV" :key="item.id" type="button" class="nav-item flex items-center gap-2 rounded-[var(--radius-control)] px-2 py-2 text-[var(--text-sm)]" :class="book.page.value === item.id ? 'is-active' : ''" @click="goPage(item.id)">
                        <span :class="item.icon" />{{ item.label }}
                    </button>
                </nav>
            </template>
        </div>

        <footer class="flex shrink-0 flex-wrap items-center gap-x-4 border-t border-[var(--divider)] px-3 py-1 text-[var(--text-2xs)] text-[var(--text-muted)]" data-testid="footer">
            <span>自动抽取，以原文为准</span>
            <span>第 {{ book.at.value.chapter }} 章之后的内容都不显示</span>
            <span v-if="book.saveFailed.value" class="ml-auto text-[var(--status-danger)]" data-testid="save-failed">阅读位置没存上</span>
        </footer>
        <div v-if="notice" class="absolute bottom-10 left-1/2 z-40 -translate-x-1/2 rounded-[var(--radius-control)] bg-[var(--status-warning-bg)] px-3 py-1.5 text-[var(--text-sm)]" data-testid="notice">{{ notice }}</div>
    </div>
</template>

<style scoped>
.nav-item {
    color: var(--text-secondary);
}
.nav-item:hover {
    background: var(--bg-hover);
}
.nav-item.is-active {
    color: var(--accent-text);
    background: var(--accent-bg);
}
</style>
