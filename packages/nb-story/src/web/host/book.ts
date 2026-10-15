/**
 * 一本书在查看器里的会话：阅读位置、视角、当前页、抽屉里打开的东西，以及它们与地址、书库里阅读状态的同步
 * （docs/specs/story/viewer.md 输出 4、5、21 与“状态与转换”）。
 *
 * 状态只在这里改；地址与保存都从状态派生：
 * - 地址：状态一变就 router.replace；地址被外部改了（后退、手改）就按地址改状态。两边比较后才写，不会来回触发。
 * - 保存：最后一次变化后 1 秒存一次整份阅读状态；同时只有一次在途，在途时又变了就记下，等它完成再存最新的一份。
 *   页面隐藏或关闭时立即用 keepalive 发出。保存的返回不改动界面；失败时 saveFailed 为真，下次变化时重试。
 */

import {computed, inject, ref, watch, type ComputedRef, type InjectionKey, type Ref} from "vue";
import type {Router} from "vue-router";

import type {PositionInput, StoryResult} from "../../contract/contract";
import {sendKeepalive, StoryCallError, type StoryClient} from "./client";

export const PAGES = ["overview", "relations", "book-graph", "roster", "secrets", "ledger", "questions", "timeline", "episodes", "source", "stats"] as const;
export type Page = (typeof PAGES)[number];
export const TABS = ["summary", "relations", "records", "episodes"] as const;
export type Tab = (typeof TABS)[number];

export type DrawerContent =
    | {kind: "card"; entity: string; tab: Tab}
    | {kind: "source"; ref: string}
    | {kind: "para"; chapter: number; paragraph: number}
    | {kind: "node"; id: string; label: string};

/** 存进书库的界面状态（`reading.set` 的 view）。 */
interface SavedView {
    page: Page;
    entity: string | null;
    tab: Tab | null;
    perspective: string;
}

export interface BookSession {
    readonly bookId: string;
    /** 全书的信息（章数、各章段数）；不带阅读位置取，目录标题另按位置取。 */
    readonly info: StoryResult<"book.info">;
    readonly at: Ref<PositionInput>;
    readonly atLabel: ComputedRef<string>;
    readonly perspective: Ref<string>;
    readonly page: Ref<Page>;
    readonly drawer: Ref<DrawerContent | null>;
    /** 打开时去掉了地址里不存在的对象或视角等，给页面角落的一次性提示。 */
    readonly notice: Ref<string | null>;
    readonly saveFailed: Ref<boolean>;
    setAt(at: PositionInput): void;
    goPage(page: Page): void;
    openCard(entity: string, tab?: Tab): void;
    openSource(ref: string): void;
    openParagraph(chapter: number, paragraph: number): void;
    openNode(id: string, label: string): void;
    closeDrawer(): void;
    dispose(): void;
}

export const BOOK_SESSION: InjectionKey<BookSession> = Symbol("nb-story book session");

export function useBook(): BookSession {
    const session = inject(BOOK_SESSION);
    if (!session) throw new Error("没有提供 BookSession：页面要放在书的外壳里");
    return session;
}

export function formatAt(at: PositionInput): string {
    return at.paragraph === undefined ? String(at.chapter) : `${at.chapter}.${at.paragraph}`;
}

export function parseAt(text: unknown): PositionInput | null {
    if (typeof text !== "string") return null;
    const match = /^(\d{1,4})(?:\.(\d{1,4}))?$/u.exec(text);
    if (!match) return null;
    return match[2] === undefined ? {chapter: Number(match[1])} : {chapter: Number(match[1]), paragraph: Number(match[2])};
}

function isPage(value: unknown): value is Page {
    return typeof value === "string" && (PAGES as readonly string[]).includes(value);
}

function isTab(value: unknown): value is Tab {
    return typeof value === "string" && (TABS as readonly string[]).includes(value);
}

function readSavedView(view: unknown): Partial<SavedView> {
    if (typeof view !== "object" || view === null) return {};
    const value = view as Record<string, unknown>;
    return {
        ...(isPage(value.page) ? {page: value.page} : {}),
        ...(typeof value.entity === "string" ? {entity: value.entity} : {}),
        ...(isTab(value.tab) ? {tab: value.tab} : {}),
        ...(typeof value.perspective === "string" ? {perspective: value.perspective} : {}),
    };
}

/** 位置在这本书里是否合法（地址可能写错）。 */
function validAt(info: StoryResult<"book.info">, at: PositionInput | null): at is PositionInput {
    if (!at || at.chapter < 1 || at.chapter > info.chapters) return false;
    return at.paragraph === undefined || (at.paragraph >= 1 && at.paragraph <= info.paragraphs[at.chapter - 1]!);
}

const SAVE_DELAY_MS = 1000;

/**
 * 打开一本书：先取回存下的阅读状态，按“地址写明的优先”合并（输出 4），去掉当前位置还不存在的对象与视角，
 * 再返回会话。页面数据在这之后才取。
 */
export async function openBookSession(client: StoryClient, router: Router, bookId: string): Promise<BookSession> {
    const info = await client.call("book.info", {book: bookId});
    const saved = await client.call("reading.get", {book: bookId});
    const route = router.currentRoute.value;
    const query = route.query;
    const savedView = readSavedView(saved.view);
    const notices: string[] = [];

    const urlAt = parseAt(query.at);
    if (query.at !== undefined && !validAt(info, urlAt)) notices.push("地址里的阅读位置不在这本书里，已改用上次的位置");
    const at = ref<PositionInput>(validAt(info, urlAt) ? urlAt : validAt(info, saved.position) ? saved.position : {chapter: 1});
    const page = ref<Page>(isPage(route.params.page) ? route.params.page : (savedView.page ?? "overview"));
    let perspective = typeof query.perspective === "string" ? query.perspective : (savedView.perspective ?? "reader");
    let entity: string | null = typeof query.entity === "string" ? query.entity : (savedView.entity ?? null);
    const tab: Tab = isTab(query.tab) ? query.tab : (savedView.tab ?? "summary");

    if (perspective !== "reader") {
        try {
            await client.call("entities.list", {book: bookId, at: at.value, perspective, limit: 1});
        } catch (error) {
            if (!(error instanceof StoryCallError)) throw error;
            notices.push(`视角“${perspective}”在${formatAt(at.value)}还不可用，已换回读者视角`);
            perspective = "reader";
        }
    }
    if (entity !== null) {
        try {
            entity = (await client.call("entity.card", {book: bookId, at: at.value, entity})).id;
        } catch (error) {
            if (!(error instanceof StoryCallError)) throw error;
            notices.push(`对象“${entity}”在这个阅读位置还没出现，已关掉它的人物卡`);
            entity = null;
        }
    }

    const perspectiveRef = ref(perspective);
    const drawer = ref<DrawerContent | null>(entity === null ? null : {kind: "card", entity, tab});
    const notice = ref<string | null>(notices.length ? notices.join("；") : null);
    const saveFailed = ref(false);
    const atLabel = computed(() => (at.value.paragraph === undefined ? `第 ${at.value.chapter} 章` : `第 ${at.value.chapter} 章第 ${at.value.paragraph} 段`));

    function viewState(): SavedView {
        const card = drawer.value?.kind === "card" ? drawer.value : null;
        return {page: page.value, entity: card?.entity ?? null, tab: card?.tab ?? null, perspective: perspectiveRef.value};
    }

    // ---- 地址 ----
    function routeTarget() {
        const view = viewState();
        const next: Record<string, string> = {at: formatAt(at.value)};
        if (view.perspective !== "reader") next.perspective = view.perspective;
        if (view.entity) next.entity = view.entity;
        if (view.entity && view.tab) next.tab = view.tab;
        return {path: `/book/${encodeURIComponent(bookId)}/${view.page}`, query: next};
    }
    function syncRoute(): void {
        const target = routeTarget();
        const current = router.currentRoute.value;
        const same = current.path === target.path && JSON.stringify(current.query) === JSON.stringify(target.query);
        if (!same) void router.replace(target);
    }
    const stopRoute = router.afterEach(to => {
        if (to.params.id !== bookId) return;
        if (isPage(to.params.page) && to.params.page !== page.value) page.value = to.params.page;
        const nextAt = parseAt(to.query.at);
        if (validAt(info, nextAt) && formatAt(nextAt) !== formatAt(at.value)) at.value = nextAt;
        if (typeof to.query.perspective === "string" && to.query.perspective !== perspectiveRef.value) perspectiveRef.value = to.query.perspective;
    });

    // ---- 保存 ----
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let dirty = false;
    function snapshot() {
        return {book: bookId, position: at.value, view: viewState()};
    }
    async function save(): Promise<void> {
        timer = null;
        if (inFlight) {
            dirty = true;
            return;
        }
        inFlight = true;
        dirty = false;
        try {
            await client.call("reading.set", snapshot());
            saveFailed.value = false;
        } catch (error) {
            console.warn({error}, "保存阅读状态失败");
            saveFailed.value = true;
        } finally {
            inFlight = false;
            if (dirty) void save();
        }
    }
    function scheduleSave(): void {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => void save(), SAVE_DELAY_MS);
    }
    function flushOnHide(): void {
        if (timer === null && !dirty) return;
        if (timer !== null) clearTimeout(timer);
        timer = null;
        dirty = false;
        sendKeepalive("reading.set", snapshot());
    }
    const onVisibility = () => {
        if (document.visibilityState === "hidden") flushOnHide();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushOnHide);

    const stopWatch = watch([at, page, perspectiveRef, drawer], () => {
        syncRoute();
        scheduleSave();
    }, {deep: true});
    syncRoute();

    return {
        bookId,
        info,
        at,
        atLabel,
        perspective: perspectiveRef,
        page,
        drawer,
        notice,
        saveFailed,
        setAt(next) {
            if (validAt(info, next)) at.value = next;
        },
        goPage(next) {
            page.value = next;
        },
        openCard(entityId, tabName = "summary") {
            drawer.value = {kind: "card", entity: entityId, tab: tabName};
        },
        openSource(refText) {
            drawer.value = {kind: "source", ref: refText};
        },
        openParagraph(chapter, paragraph) {
            drawer.value = {kind: "para", chapter, paragraph};
        },
        openNode(id, label) {
            drawer.value = {kind: "node", id, label};
        },
        closeDrawer() {
            drawer.value = null;
        },
        dispose() {
            stopWatch();
            stopRoute();
            document.removeEventListener("visibilitychange", onVisibility);
            window.removeEventListener("pagehide", flushOnHide);
            flushOnHide();
        },
    };
}
