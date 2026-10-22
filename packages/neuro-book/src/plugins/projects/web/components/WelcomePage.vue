<script setup lang="ts">
/** 欢迎页（同名 .md）：作品概况、开始、最近打开与入门；受控零件，动作经事件交给宿主。 */
import {computed} from "vue";

import {Button, Kbd} from "@notnotype/nb-ui/components";

import {basenameOf, parentOf, parseResource} from "nbook/plugins/files/shared/contracts";
import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import type {ShelfStats} from "../../shared/contracts";
import {formatFiles, formatWhen, formatWords} from "../shelf-format";

defineOptions({name: "WelcomePage"});

/** 最近打开至多显示这么多个（记录里存 10 个）。 */
const RECENT_SHOWN = 5;

const props = withDefaults(defineProps<{
    locale: DisplayLocale;
    title: string | null;
    description: string | null;
    stats: ShelfStats | null;
    now: string;
    quick: ReadonlyArray<{readonly address: string; readonly name: string; readonly kind: "file" | "folder"}>;
    recent: ReadonlyArray<string>;
    creating?: boolean;
    problem?: string | null;
    shortcut?: string | null;
}>(), {creating: false, problem: null, shortcut: null});

const emit = defineEmits<{
    (event: "new-chapter"): void;
    (event: "open", address: string): void;
    (event: "reveal", address: string): void;
    (event: "shelf"): void;
}>();

const TEXT = {
    noProject: {"zh-CN": "没有打开作品", "en-US": "No work is open"},
    noDescription: {"zh-CN": "还没有简介", "en-US": "No description yet"},
    none: {"zh-CN": "尚未统计", "en-US": "Not counted yet"},
    stale: {"zh-CN": "统计于{when}", "en-US": "Counted {when}"},
    start: {"zh-CN": "开始", "en-US": "Start"},
    newChapter: {"zh-CN": "新建章节", "en-US": "New Chapter"},
    open: {"zh-CN": "打开{name}", "en-US": "Open {name}"},
    shelf: {"zh-CN": "回到书架", "en-US": "Back to Bookshelf"},
    recent: {"zh-CN": "最近打开", "en-US": "Recent"},
    noRecent: {"zh-CN": "还没有打开过文件", "en-US": "No files opened yet"},
    intro: {"zh-CN": "入门", "en-US": "Getting Started"},
    tipFiles: {"zh-CN": "章节就是作品目录里的 Markdown 文件，在左边的资源管理器里新建、改名、拖动。", "en-US": "Chapters are Markdown files in the work's folder; create, rename and drag them in the explorer on the left."},
    tipCommands: {"zh-CN": "打开命令面板，所有操作都能在这里搜到。", "en-US": "opens the command palette, where every action can be found."},
    tipCommandsPlain: {"zh-CN": "命令面板里能搜到所有操作。", "en-US": "Every action can be found in the command palette."},
    tipLayout: {"zh-CN": "右上角的三个开关打开侧栏、底部面板与右侧栏，插件的视图会出现在那里。", "en-US": "The three switches at the top right open the sidebar, the bottom panel and the right sidebar, where plugin views appear."},
} satisfies Record<string, LocalizedText>;

const text = (value: LocalizedText): string => localize(value, props.locale);

/** 字数 · 篇数，过时的统计带“统计于…”（与书架的书卡同一写法）；还没取到统计时没有这一行。 */
const statsLine = computed((): string | null => {
    const stats = props.stats;
    if (stats === null) return null;
    if (stats.freshness === "none") return text(TEXT.none);
    const parts = [formatWords(stats.words, props.locale), formatFiles(stats.files, props.locale)];
    if (stats.freshness === "stale" && stats.computedAt !== null) parts.push(text(formatText(TEXT.stale, {when: formatWhen(stats.computedAt, props.now, props.locale)})));
    return parts.join(" · ");
});

const quickItems = computed(() => props.quick.map((item) => ({
    ...item,
    label: text(formatText(TEXT.open, {name: item.kind === "file" ? item.name.replace(/\.md$/iu, "") : item.name})),
    hint: item.kind === "folder" ? `${item.name}/` : item.name,
    icon: item.kind === "folder" ? "i-lucide-folder" : "i-lucide-list",
})));

/** 最近打开：文件名与所在目录（根目录不写）。地址读不出时原样显示。 */
const recentItems = computed(() => props.recent.slice(0, RECENT_SHOWN).map((address) => {
    const parsed = parseResource(address);
    if (!parsed.ok) return {address, name: address, folder: ""};
    return {address, name: basenameOf(parsed.resource), folder: parentOf(parsed.resource)?.path ?? ""};
}));

const keys = computed(() => (props.shortcut === null ? [] : props.shortcut.split("+")));
</script>

<template>
    <div class="welcome-page" data-welcome-page>
        <template v-if="title === null">
            <h1 class="welcome-page__title">{{ text(TEXT.noProject) }}</h1>
            <button type="button" class="welcome-page__link nb-ui-focus-ring" data-welcome-shelf @click="emit('shelf')">
                <span class="i-lucide-library-big welcome-page__icon" aria-hidden="true"></span>{{ text(TEXT.shelf) }}
            </button>
        </template>
        <template v-else>
            <header class="welcome-page__head">
                <h1 class="welcome-page__title" data-welcome-title>{{ title }}</h1>
                <p class="welcome-page__description" :class="description === null ? 'welcome-page__muted' : ''" data-welcome-description>{{ description ?? text(TEXT.noDescription) }}</p>
                <p v-if="statsLine !== null" class="welcome-page__stats" data-welcome-stats>{{ statsLine }}</p>
            </header>

            <div class="welcome-page__columns">
                <section class="welcome-page__section" :aria-label="text(TEXT.start)">
                    <h2 class="welcome-page__label">{{ text(TEXT.start) }}</h2>
                    <div>
                        <Button size="md" :loading="creating" data-welcome-new-chapter @click="emit('new-chapter')">{{ text(TEXT.newChapter) }}</Button>
                        <p v-if="problem !== null" class="welcome-page__problem" role="alert">{{ problem }}</p>
                    </div>
                    <ul class="welcome-page__list">
                        <li v-for="item in quickItems" :key="item.address">
                            <button type="button" class="welcome-page__link nb-ui-focus-ring" :data-welcome-quick="item.address" @click="item.kind === 'folder' ? emit('reveal', item.address) : emit('open', item.address)">
                                <span :class="item.icon" class="welcome-page__icon" aria-hidden="true"></span>{{ item.label }}
                            </button>
                            <span class="welcome-page__hint">{{ item.hint }}</span>
                        </li>
                        <li>
                            <button type="button" class="welcome-page__link nb-ui-focus-ring" data-welcome-shelf @click="emit('shelf')">
                                <span class="i-lucide-library-big welcome-page__icon" aria-hidden="true"></span>{{ text(TEXT.shelf) }}
                            </button>
                        </li>
                    </ul>
                </section>

                <section class="welcome-page__section" :aria-label="text(TEXT.recent)">
                    <h2 class="welcome-page__label">{{ text(TEXT.recent) }}</h2>
                    <ul v-if="recentItems.length > 0" class="welcome-page__list">
                        <li v-for="item in recentItems" :key="item.address" class="welcome-page__recent">
                            <button type="button" class="welcome-page__link nb-ui-focus-ring" :title="item.address" :data-welcome-recent="item.address" @click="emit('open', item.address)">{{ item.name }}</button>
                            <span class="welcome-page__hint">{{ item.folder }}</span>
                        </li>
                    </ul>
                    <p v-else class="welcome-page__muted" data-welcome-no-recent>{{ text(TEXT.noRecent) }}</p>
                </section>
            </div>

            <section class="welcome-page__section" :aria-label="text(TEXT.intro)">
                <h2 class="welcome-page__label">{{ text(TEXT.intro) }}</h2>
                <ul class="welcome-page__tips">
                    <li>{{ text(TEXT.tipFiles) }}</li>
                    <li v-if="keys.length > 0"><span class="welcome-page__keys"><Kbd v-for="key in keys" :key="key">{{ key }}</Kbd></span> {{ text(TEXT.tipCommands) }}</li>
                    <li v-else>{{ text(TEXT.tipCommandsPlain) }}</li>
                    <li>{{ text(TEXT.tipLayout) }}</li>
                </ul>
            </section>
        </template>
    </div>
</template>

<style scoped>
.welcome-page {
    box-sizing: border-box;
    max-width: 720px;
    margin-inline: auto;
    padding: 72px 48px 96px;
    color: var(--text-main);
    font-size: var(--text-sm);
}

.welcome-page__head {
    margin-bottom: 40px;
}

.welcome-page__title {
    margin: 0;
    font-family: var(--font-display, var(--font-ui));
    font-size: 30px;
    font-weight: 600;
    letter-spacing: 0.02em;
    overflow-wrap: anywhere;
}

.welcome-page__description {
    margin: 10px 0 0;
    font-size: 15px;
    line-height: 1.7;
    white-space: pre-line;
}

.welcome-page__stats {
    margin: 8px 0 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.welcome-page__muted {
    color: var(--text-muted);
}

.welcome-page__columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 32px 48px;
    margin-bottom: 40px;
}

@media (width < 560px) {
    .welcome-page {
        padding-inline: 24px;
    }

    .welcome-page__columns {
        grid-template-columns: minmax(0, 1fr);
    }
}

.welcome-page__section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
}

.welcome-page__label {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
}

.welcome-page__list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
}

.welcome-page__list li {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
}

.welcome-page__recent {
    justify-content: space-between;
}

.welcome-page__link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    border-radius: var(--radius-control);
    padding: 2px 4px;
    margin-inline: -4px;
    color: var(--accent-text);
    text-align: left;
    overflow-wrap: anywhere;
}

.welcome-page__link:hover {
    text-decoration: underline;
}

.welcome-page__icon {
    flex: 0 0 auto;
    width: 16px;
    height: 16px;
    color: var(--text-muted);
}

.welcome-page__hint {
    min-width: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
}

.welcome-page__problem {
    margin: 6px 0 0;
    color: var(--status-danger);
    font-size: var(--text-xs);
}

.welcome-page__tips {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--text-secondary);
    line-height: 1.7;
}

.welcome-page__keys {
    display: inline-flex;
    gap: 2px;
}
</style>
