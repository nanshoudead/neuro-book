<script setup lang="ts">
/** 书卡（同名 .md）：封面、书名、简介、统计与最近编辑；只发事件，键盘与选中归 ShelfCards。 */
import {DropdownMenu, IconButton} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData} from "@notnotype/nb-ui/components";

import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import {projectDisplayName} from "../../shared/shelf";
import type {ShelfItem} from "../../shared/shelf";
import {formatFiles, formatWhen, formatWords} from "../shelf-format";
import BookCover from "./BookCover.vue";

defineOptions({name: "BookCard"});

// highlighted 的缺省要是 undefined（缺省同 active）：Vue 会把没传的布尔 prop 当成 false。
const props = withDefaults(defineProps<{
    locale: DisplayLocale;
    item: ShelfItem;
    now: string;
    /** 封面图地址；null 用排版封面。 */
    coverSrc: string | null;
    /** 选中（`aria-selected`）。 */
    active: boolean;
    /** 画选中环；缺省同 `active`。键盘停在别的选项（例如“新建作品”占位）上时，选中不变、环挪走。 */
    highlighted?: boolean;
    /** 列表框里的选项 id（ShelfCards 给）。 */
    optionId?: string;
}>(), {highlighted: undefined, optionId: undefined});

const emit = defineEmits<{
    (event: "open", id: string): void;
    (event: "open-new-window", id: string): void;
    (event: "edit", id: string): void;
    (event: "remove", id: string): void;
    (event: "pick", id: string): void;
}>();

const TEXT = {
    more: {"zh-CN": "更多操作", "en-US": "More Actions"},
    openNewWindow: {"zh-CN": "在新窗口打开", "en-US": "Open in New Window"},
    edit: {"zh-CN": "编辑信息", "en-US": "Edit Info"},
    remove: {"zh-CN": "从书架移除", "en-US": "Remove from Shelf"},
    running: {"zh-CN": "已打开", "en-US": "Open"},
    none: {"zh-CN": "尚未统计", "en-US": "Not counted yet"},
    noDescription: {"zh-CN": "还没有简介", "en-US": "No description yet"},
    stale: {"zh-CN": "统计于{when}", "en-US": "Counted {when}"},
    counting: {"zh-CN": "正在统计", "en-US": "Counting"},
} satisfies Record<string, LocalizedText>;

const text = (value: LocalizedText): string => localize(value, props.locale);

/** 字数与篇数；`none` 写“尚未统计”。 */
function counts(): string {
    const {stats} = props.item;
    if (stats.freshness === "none") return text(TEXT.none);
    return `${formatWords(stats.words, props.locale)} · ${formatFiles(stats.files, props.locale)}`;
}

/** 最近编辑时间与新鲜度说明（Spec 输出 8）：`fresh` 不加说明。 */
function when(): string | null {
    const {stats} = props.item;
    const parts: string[] = [];
    if (stats.last !== null) parts.push(formatWhen(stats.last.at, props.now, props.locale));
    if (stats.freshness === "counting") parts.push(text(TEXT.counting));
    else if (stats.freshness === "stale" && stats.computedAt !== null) parts.push(text(formatText(TEXT.stale, {when: formatWhen(stats.computedAt, props.now, props.locale)})));
    return parts.length === 0 ? null : parts.join(" · ");
}

function menu(): DropdownMenuItemData[] {
    return [
        {value: "open-new-window", label: text(TEXT.openNewWindow)},
        {value: "edit", label: text(TEXT.edit)},
        {value: "remove", label: text(TEXT.remove), tone: "danger"},
    ];
}

function onMenu(value: string): void {
    if (value === "open-new-window") emit("open-new-window", props.item.id);
    else if (value === "edit") emit("edit", props.item.id);
    else if (value === "remove") emit("remove", props.item.id);
}
</script>

<template>
    <article
        :id="optionId"
        role="option"
        :aria-selected="active"
        class="book-card"
        :class="{'book-card--active': highlighted ?? active}"
        :data-book-card="item.id"
        @click="emit('pick', item.id); emit('open', item.id)"
    >
        <BookCover :id="item.id" :title="projectDisplayName(item)" :color="item.color" :src="coverSrc" :width="84" class="book-card__cover" />
        <div class="book-card__text">
            <h3 class="book-card__title">{{ projectDisplayName(item) }}</h3>
            <p class="book-card__blurb" :class="{'book-card__blurb--empty': item.description === null || item.description === ''}">{{ item.description === null || item.description === "" ? text(TEXT.noDescription) : item.description }}</p>
            <div class="book-card__foot">
                <span>{{ counts() }}</span>
                <span v-if="item.state !== 'stopped'" class="book-card__running">{{ when() === null ? text(TEXT.running) : `${when() ?? ""} · ${text(TEXT.running)}` }}</span>
                <span v-else-if="when() !== null">{{ when() }}</span>
            </div>
        </div>
        <!-- 更多菜单是卡片的兄弟交互：点它不触发打开（.stop），也不嵌在按钮里。 -->
        <DropdownMenu :items="menu()" align="end" root-class="book-card__more" @select="onMenu" @click.stop>
            <IconButton size="sm" icon-class="i-lucide-ellipsis" :aria-label="text(TEXT.more)" @click.stop />
        </DropdownMenu>
    </article>
</template>

<style scoped>
.book-card {
    position: relative;
    display: flex;
    gap: var(--space-5);
    padding: var(--space-5) var(--space-5) var(--space-4);
    border-radius: 16px;
    background: var(--page-surface, var(--bg-panel));
    box-shadow: 0 1px 1.5px color-mix(in srgb, var(--shadow-color) 8%, transparent), 0 8px 22px color-mix(in srgb, var(--shadow-color) 8%, transparent);
    cursor: pointer;
    transition: transform var(--motion-fast) var(--ease-standard), box-shadow var(--motion-fast) var(--ease-standard);
}

.book-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--page-lift, var(--elevation-flat));
}

/* 选中态复用主题的焦点环，不另画边。 */
.book-card--active {
    box-shadow: 0 1px 1.5px color-mix(in srgb, var(--shadow-color) 8%, transparent), 0 8px 22px color-mix(in srgb, var(--shadow-color) 8%, transparent), var(--focus-ring);
}

.book-card__text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
}

.book-card__title {
    margin: 2px 0 0;
    padding-right: var(--space-7);
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: var(--weight-strong);
    line-height: 1.25;
    overflow-wrap: anywhere;
}

.book-card__blurb {
    display: -webkit-box;
    overflow: hidden;
    margin: var(--space-2) 0 0;
    color: var(--text-secondary);
    font-family: var(--font-display);
    font-size: 13px;
    line-height: 1.65;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
}

.book-card__blurb--empty {
    color: var(--text-muted);
}

.book-card__foot {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: auto;
    padding-top: var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.book-card__running {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--status-success);
}

.book-card__running::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentColor;
}

.book-card__more {
    position: absolute;
    top: var(--space-3);
    right: var(--space-3);
    opacity: 0;
    transition: opacity var(--motion-fast) var(--ease-standard);
}

.book-card:hover .book-card__more,
.book-card--active .book-card__more,
.book-card__more:focus-within {
    opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
    .book-card,
    .book-card:hover {
        transform: none;
        transition: none;
    }
}
</style>
