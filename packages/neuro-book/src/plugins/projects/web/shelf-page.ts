/**
 * 书架页的模型（docs/specs/workbench/bookshelf.md）：取数与刷新、选中、打开与继续写作、新建、修改信息、封面、移出书架与打开已有
 * 作品。界面只呈现这里的状态、把动作交回来；窗口与确认由界面宿主（`BookshelfHost.vue`）负责，这里给出每个动作的结果
 * 与已按当前语言写好的失败原因：能在字段里改的带字段名交回，别的经工作台的通知服务发出。
 *
 * 刷新：页面可见时每 30 秒一次，窗口重新获得焦点时也刷新，两者合并成同一时间至多一个在途请求；页面隐藏时停止。
 * 新建、修改、移出之后强制刷新一次（在途的响应作废、等它结束再发），界面不先行修改数据。写操作的结果未知时也只重新取
 * 书架、按本次的目标核对，不盲目重试。
 */

import {computed, ref, shallowRef} from "vue";
import type {ComputedRef, Ref, ShallowRef} from "vue";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import type {RemoteClient} from "@notnotype/nb-runtime/remote";
import type {Text, TextParams} from "@notnotype/nb-ui/text";
import type {TextPort} from "@notnotype/nb-ui/text-port";

import type {NotificationHandle, Notifications} from "nbook/plugins/workbench/shared/contracts";
import type {WindowNavigation} from "nbook/shared/host";
import type {SettingsService} from "nbook/shared/settings";

import {librarySetting, projectsRemoteContract} from "../shared/contracts";
import {projectDirectoryName} from "../shared/directory-name";
import {projectUrl} from "../shared/project-url";
import type {ShelfItem} from "../shared/shelf";
import {projectsText} from "../shared/text";
import type {ProjectsTextKey} from "../shared/text";
import {browseDirectory} from "./browse";
import type {BrowseOutcome} from "./browse";
import {failureReason, fieldName, registerFailureReason} from "./failure-text";
import {sortShelf} from "./shelf-format";
import type {ShelfSort} from "./shelf-format";
import type {ShelfView} from "./shelf-preferences";

/** 页面可见时的刷新间隔。 */
export const SHELF_REFRESH_MS = 30_000;

export type ShelfActionOutcome = {readonly ok: true} | {readonly ok: false; readonly message: string};

export interface ProjectInfoValues {
    readonly title: string;
    readonly description: string;
    readonly color: string | null;
}

export type ProjectInfoField = "title" | "description" | "location";

/** 新建与修改的结果：失败时能在字段里改的带字段名；`field` 为 null 的失败已经发了通知。 */
export type ProjectActionOutcome = {readonly ok: true; readonly id: string} | {readonly ok: false; readonly field: ProjectInfoField | null; readonly message: string};

export type ProjectCoverChange = {readonly kind: "keep"} | {readonly kind: "set"; readonly file: File} | {readonly kind: "remove"};

export interface LibraryInfo {
    readonly path: string;
    readonly source: "setting" | "default";
}

export type {BrowseListing, BrowseOutcome} from "./browse";

export type CoverTransportResult = {readonly ok: true} | {readonly ok: false; readonly code: string; readonly detail: string};

/** 封面经 HTTP 而不是远程服务（二进制）；产品里是 `fetch`，测试里接真实的路由处理器。 */
export interface CoverTransport {
    upload(id: string, file: File): Promise<CoverTransportResult>;
    remove(id: string): Promise<CoverTransportResult>;
}

export interface ShelfPreferencesPort {
    readonly view: Readonly<Ref<ShelfView>>;
    readonly sort: Readonly<Ref<ShelfSort>>;
    setView(view: ShelfView): void;
    setSort(sort: ShelfSort): void;
}

export interface ShelfPageHost {
    readonly remote: RemoteClient<typeof projectsRemoteContract>;
    readonly clock: RuntimeClock;
    /** 失败原因与排序按它的当前语言给出。 */
    readonly text: TextPort;
    /** 视图与排序的偏好（产品里接 `shelfPreferencesStore`）。 */
    readonly preferences: ShelfPreferencesPort;
    readonly settings: SettingsService;
    readonly navigation: WindowNavigation;
    readonly notifications: Notifications;
    readonly cover: CoverTransport;
    /** 执行一条命令（标题栏的设置菜单）；失败给出原因。 */
    readonly commands: {execute(id: string): Promise<{readonly ok: true} | {readonly ok: false; readonly reason: string}>};
    /** 记诊断：取数失败、设置写失败这类用户已经看到提示的事。 */
    readonly report: (event: string, message: string) => void;
}

export interface ShelfPage {
    readonly status: Readonly<Ref<"loading" | "ready" | "error">>;
    /** `status` 为 error 时的原因，已按当前语言写好。 */
    readonly error: Readonly<Ref<string>>;
    readonly items: Readonly<ShallowRef<ReadonlyArray<ShelfItem>>>;
    /** 最近一次取数的时刻（ISO）；相对时间按它算。 */
    readonly now: Readonly<Ref<string>>;
    readonly activeId: Readonly<Ref<string | null>>;
    readonly view: ComputedRef<ShelfView>;
    readonly sort: ComputedRef<ShelfSort>;
    select(id: string | null): void;
    setView(view: ShelfView): void;
    setSort(sort: ShelfSort): void;
    /** 页面可见：立刻刷新并开始定时；不可见：停止定时。 */
    setVisible(visible: boolean): void;
    /** 窗口重新获得焦点。 */
    focused(): void;
    /** 再取一次；在途时合并进在途的那次。`force` 作废在途的响应，等它结束后必定再发一次（写操作之后用）。 */
    refresh(force?: boolean): Promise<void>;
    open(id: string): void;
    openInNewWindow(id: string): void;
    continueWriting(id: string): void;
    /** 当前有效的作品目录；取不到时发通知并给 null。 */
    library(): Promise<LibraryInfo | null>;
    /** 列一个目录（null 或空白为作品目录）；失败原因已按当前语言写好，给选择器显示。 */
    browse(path: string | null): Promise<BrowseOutcome>;
    /** 新建：`parent` 是用户在窗口里给的目录。成功后书架刷新、新作品被选中。 */
    create(values: ProjectInfoValues, parent: string): Promise<ProjectActionOutcome>;
    update(id: string, values: ProjectInfoValues): Promise<ProjectActionOutcome>;
    /** 上传或移除封面；失败发通知。成功后书架刷新。 */
    setCover(id: string, change: ProjectCoverChange): Promise<boolean>;
    /** 把用户选的目录写进设置；写不进去发通知（作品已经建成）。 */
    rememberLibrary(path: string): Promise<void>;
    /** 打开已有作品：登记一个目录。失败原因给选择器显示；结果未知时核对书架。 */
    addExisting(path: string): Promise<ShelfActionOutcome>;
    /** 移出成功后选中相邻的一部。 */
    remove(id: string): Promise<ShelfActionOutcome>;
    /** 标题栏设置菜单的命令；失败发通知。 */
    runCommand(id: string): Promise<void>;
    dispose(): void;
}

/** 继续写作的地址：编辑器插件读 `open` 与 `at`（docs/specs/workbench/editor.md 输出 29）。 */
export function continueUrl(name: string, address: string): string {
    return `/?${new URLSearchParams({project: name, open: address, at: "end"}).toString()}`;
}

/** 去掉路径两端的分隔符，比较两个路径是否指同一目录（服务端规范化过的写法与用户输入的只差末尾的斜杠时）。 */
export function trimSeparators(path: string): string {
    return path.replace(/^[/\\]+(?=.)/u, "").replace(/[/\\]+$/u, "");
}

export function splitPath(path: string): {readonly parent: string; readonly name: string} {
    const trimmed = trimSeparators(path);
    const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    return index === -1 ? {parent: "", name: trimmed} : {parent: trimmed.slice(0, index), name: trimmed.slice(index + 1)};
}

export function samePath(a: {readonly parent: string; readonly name: string}, b: {readonly parent: string; readonly name: string}): boolean {
    return trimSeparators(a.parent) === trimSeparators(b.parent) && a.name === b.name;
}

export function createShelfPage(host: ShelfPageHost): ShelfPage {
    const status = ref<"loading" | "ready" | "error">("loading");
    const error = ref("");
    const items = shallowRef<ReadonlyArray<ShelfItem>>([]);
    const now = ref(new Date(host.clock.now()).toISOString());
    const activeId = ref<string | null>(null);
    const t = (key: ProjectsTextKey, params?: TextParams): string => host.text.t(projectsText(key, params));
    const reason = (code: string, detail?: unknown): string => failureReason(host.text, code, detail);

    /** 移出后要选中的那一部：移出前算好，刷新回来时用。 */
    let nextActive: string | null = null;
    let disposed = false;
    let visible = false;
    let sequence = 0;
    let inFlight: Promise<void> | null = null;
    /** 在途请求结束后要补发的那一次（强制刷新碰上在途请求时登记）。 */
    let followUp: Promise<void> | null = null;
    let cancelTimer: (() => void) | null = null;
    /** 刷新失败的常驻通知：恢复后收回；同一时间只有一条。 */
    let refreshNotice: NotificationHandle | null = null;

    const byId = (id: string): ShelfItem | null => items.value.find((item) => item.id === id) ?? null;

    // 通知交文字引用，视口显示时才翻（docs/specs/workbench/notifications.md 输出 9）：切换语言后已显示的通知随之换文字。代入的原因
    // 这类参数只收字符串，仍是发通知时按当前语言翻好的片段。
    const warn = (title: Text, message: Text): void => void host.notifications.notify({tone: "warning", title, message});

    function schedule(): void {
        cancelTimer?.();
        cancelTimer = null;
        if (!visible || disposed) return;
        cancelTimer = host.clock.schedule(() => void refresh(), SHELF_REFRESH_MS);
    }

    async function fetchOnce(id: number): Promise<void> {
        const result = await host.remote.shelf({});
        // 作废的响应（页面卸载、之后又强制刷新过）不改变任何状态。
        if (disposed || id !== sequence) return;
        now.value = new Date(host.clock.now()).toISOString();
        if (result.ok) {
            items.value = result.value;
            status.value = "ready";
            refreshNotice?.dismiss();
            refreshNotice = null;
            if (activeId.value !== null && byId(activeId.value) === null) activeId.value = nextActive !== null && byId(nextActive) !== null ? nextActive : null;
            nextActive = null;
            return;
        }
        host.report("projects.shelf-failed", `取书架失败：${result.code}`);
        if (status.value === "ready") {
            // 刷新失败只提示，数据保留；常驻带“重试”，成功后收回（docs/specs/workbench/notifications.md 输出 1）。
            refreshNotice?.dismiss();
            refreshNotice = host.notifications.notify({
                tone: "warning",
                title: projectsText("shelf.refreshFailedTitle"),
                message: projectsText("shelf.refreshFailed", {reason: reason(result.code, result.detail)}),
                action: {label: projectsText("shelf.retry"), run: () => void refresh(true)},
            });
            return;
        }
        status.value = "error";
        error.value = t("shelf.shelfFailed", {reason: reason(result.code, result.detail)});
    }

    function start(): Promise<void> {
        sequence += 1;
        const id = sequence;
        const run = fetchOnce(id).finally(() => {
            if (inFlight === run) {
                inFlight = null;
                schedule();
            }
        });
        inFlight = run;
        cancelTimer?.();
        cancelTimer = null;
        return run;
    }

    function refresh(force = false): Promise<void> {
        if (disposed) return Promise.resolve();
        if (inFlight === null) return start();
        if (!force) return inFlight;
        // 同一时间至多一个请求在途（输出 16）：强制刷新作废在途的响应，等它结束后再发；期间再来的强制刷新并进这一次。
        sequence += 1;
        if (followUp === null) {
            const next = (): Promise<void> => {
                followUp = null;
                return disposed ? Promise.resolve() : start();
            };
            followUp = inFlight.then(next, next);
        }
        return followUp;
    }

    function navigateTo(id: string, url: (item: ShelfItem) => string): void {
        const item = byId(id);
        if (item !== null) host.navigation.navigateDocument(url(item));
    }

    /** 相邻的一部：按当前排序取下一部，没有时上一部。 */
    function neighbourOf(id: string): string | null {
        const sorted = sortShelf(items.value, sort.value, host.text.locale.value);
        const index = sorted.findIndex((item) => item.id === id);
        if (index === -1) return null;
        return (sorted[index + 1] ?? sorted[index - 1])?.id ?? null;
    }

    const view = computed(() => host.preferences.view.value);
    const sort = computed(() => host.preferences.sort.value);

    /** 远程服务没给出结果（不可用、版本不一致）时的原因。 */
    const transport = (code: string, detail?: unknown): string => reason(code, detail);

    return {
        status,
        error,
        items,
        now,
        activeId,
        view,
        sort,
        select: (id) => {
            activeId.value = id;
        },
        setView: (next) => host.preferences.setView(next),
        setSort: (next) => host.preferences.setSort(next),
        setVisible: (next) => {
            visible = next;
            if (next) void refresh();
            else schedule();
        },
        focused: () => {
            if (visible) void refresh();
        },
        refresh,
        open: (id) => navigateTo(id, (item) => projectUrl(item.name)),
        openInNewWindow: (id) => {
            const item = byId(id);
            if (item === null) return;
            if (host.navigation.openExternal(projectUrl(item.name)) === "blocked") warn(projectsText("shelf.popupBlockedTitle"), projectsText("shelf.popupBlocked"));
        },
        continueWriting: (id) => navigateTo(id, (item) => (item.stats.last === null ? projectUrl(item.name) : continueUrl(item.name, item.stats.last.address))),
        library: async () => {
            const result = await host.remote.library({});
            if (result.ok) return result.value;
            host.report("projects.library-failed", `取作品目录失败：${result.code}`);
            host.notifications.notify({tone: "error", message: projectsText("shelf.libraryUnavailable", {reason: transport(result.code, result.detail)})});
            return null;
        },
        browse: (path) => browseDirectory(host.remote, path, host.text),
        create: async (values, parent) => {
            const result = await host.remote.create({title: values.title, ...(values.description === "" ? {} : {description: values.description}), parent});
            if (result.ok) {
                nextActive = result.value.id;
                activeId.value = result.value.id;
                // 主题色不在 create 的输入里：建好后再写一次作品信息。
                if (values.color !== null) {
                    const colored = await host.remote.update({id: result.value.id, color: values.color});
                    if (!colored.ok) warn(projectsText("shelf.fields.color"), projectsText("shelf.updateFailed", {reason: reason(colored.code, colored.detail)}));
                }
                await refresh(true);
                return {ok: true, id: result.value.id};
            }
            const detail = result.detail as {readonly field?: string; readonly reason?: string; readonly detail?: string; readonly path?: string} | undefined;
            switch (result.code) {
                case "invalid-metadata": {
                    const field = detail?.field === "description" ? "description" : "title";
                    return {ok: false, field, message: t("shelf.createInvalid", {field: fieldName(host.text, detail?.field ?? ""), reason: detail?.detail ?? ""})};
                }
                case "invalid-parent":
                    return {ok: false, field: "location", message: t("shelf.createInvalidParent", {reason: `${registerFailureReason(host.text, detail?.reason ?? "")}（${detail?.detail ?? ""}）`})};
                case "exists":
                    return {ok: false, field: "title", message: t("shelf.createExists", {path: detail?.path ?? ""})};
                case "write-failed":
                    return {ok: false, field: "location", message: t("shelf.createWriteFailed", {reason: detail?.detail ?? ""})};
                case "register-failed":
                    return {ok: false, field: null, message: notified("error", "shelf.createRegisterFailed", {path: detail?.path ?? "", reason: registerFailureReason(host.text, detail?.reason ?? "")})};
                case "unknown-outcome": {
                    // 新建是写操作，结果未知时不盲目重试：重新取书架，本次要建的目录（父目录加由书名生成的目录名）在上面才算成功；
                    // 书名不唯一，别的目录下的同名作品不算。父目录经服务端规范化成别的写法（符号链接）时对不上，只提示结果未知。
                    await refresh(true);
                    const expected = {parent: trimSeparators(parent), name: projectDirectoryName(values.title)};
                    const created = items.value.find((item) => item.title === values.title && samePath(splitPath(item.path), expected));
                    if (created !== undefined) {
                        activeId.value = created.id;
                        return {ok: true, id: created.id};
                    }
                    return {ok: false, field: null, message: notified("warning", "shelf.createUnknown")};
                }
                default:
                    return {ok: false, field: null, message: notified("error", "shelf.updateFailed", {reason: transport(result.code, result.detail)})};
            }
        },
        update: async (id, values) => {
            const result = await host.remote.update({id, title: values.title, description: values.description === "" ? null : values.description, color: values.color});
            if (result.ok) {
                await refresh(true);
                return {ok: true, id};
            }
            if (result.code === "invalid-metadata") {
                const detail = result.detail as {readonly field: string; readonly detail: string};
                return {ok: false, field: detail.field === "description" ? "description" : "title", message: t("shelf.createInvalid", {field: fieldName(host.text, detail.field), reason: detail.detail})};
            }
            if (result.code === "unknown-outcome") {
                // 修改是写操作，结果未知时重新取书架：服务端上这部作品已经是提交的值就是保存了。
                await refresh(true);
                const current = byId(id);
                if (current !== null && current.title === values.title && (current.description ?? "") === values.description && current.color === values.color) return {ok: true, id};
                return {ok: false, field: null, message: notified("warning", "shelf.updateUnknown")};
            }
            return {ok: false, field: null, message: notified("error", "shelf.updateFailed", {reason: reason(result.code, result.detail)})};
        },
        setCover: async (id, change) => {
            if (change.kind === "keep") return true;
            const result = change.kind === "set" ? await host.cover.upload(id, change.file) : await host.cover.remove(id);
            if (result.ok) {
                await refresh(true);
                return true;
            }
            host.report("projects.cover-failed", `封面${change.kind === "set" ? "上传" : "移除"}失败：${result.code}：${result.detail}`);
            notified("error", change.kind === "set" ? "shelf.coverFailed" : "shelf.coverRemoveFailed", {reason: result.detail === "" ? result.code : result.detail});
            return false;
        },
        rememberLibrary: async (path) => {
            const written = await host.settings.update(librarySetting, path);
            if (written.ok) return;
            host.report("projects.library-not-saved", `作品目录没有写进设置：${written.code}：${written.detail}`);
            warn(projectsText("shelf.libraryNotSavedTitle"), projectsText("shelf.libraryNotSaved", {reason: `${written.code}：${written.detail}`}));
        },
        addExisting: async (path) => {
            const registered = await host.remote.register({path});
            if (registered.ok) {
                nextActive = registered.value.id;
                activeId.value = registered.value.id;
                await refresh(true);
                return {ok: true};
            }
            if (registered.code === "unknown-outcome") {
                // 登记是写操作，结果未知时重新取书架：用户给的目录在上面就是登记了。服务端把路径规范化成别的写法（符号链接）时
                // 对不上，只提示结果未知。
                await refresh(true);
                const found = items.value.find((entry) => trimSeparators(entry.path) === trimSeparators(path));
                if (found !== undefined) {
                    activeId.value = found.id;
                    return {ok: true};
                }
                return {ok: false, message: t("open.notCompleted", {code: registered.code})};
            }
            if (registered.code !== "register-failed") return {ok: false, message: t("open.notCompleted", {code: registered.code})};
            const failure = registered.detail as {readonly reason: string; readonly detail: string};
            host.report("projects.register-failed", `登记失败：${failure.reason}：${failure.detail}`);
            return {ok: false, message: t("shelf.registerFailed", {reason: registerFailureReason(host.text, failure.reason)})};
        },
        remove: async (id) => {
            const neighbour = neighbourOf(id);
            const result = await host.remote.unregister({id});
            if (result.ok) {
                nextActive = neighbour;
                await refresh(true);
                return {ok: true};
            }
            if (result.code === "project-running") return {ok: false, message: t("shelf.removeRunning")};
            if (result.code === "unknown-outcome") {
                // 移出是写操作，结果未知时重新取书架：它不在了就是移出了，一样选中相邻的那一部。
                nextActive = neighbour;
                await refresh(true);
                return byId(id) === null ? {ok: true} : {ok: false, message: t("shelf.removeFailed", {reason: reason(result.code)})};
            }
            return {ok: false, message: t("shelf.removeFailed", {reason: reason(result.code, result.detail)})};
        },
        runCommand: async (id) => {
            const result = await host.commands.execute(id);
            if (!result.ok) notified("error", "shelf.commandFailed", {reason: result.reason});
        },
        dispose: () => {
            disposed = true;
            visible = false;
            cancelTimer?.();
            cancelTimer = null;
            refreshNotice?.dismiss();
            refreshNotice = null;
        },
    };

    /** 发一条通知并把正文交回（给调用方当失败原因）：通知交引用，随语言换文字；交回的是此刻翻好的字符串，给窗口的字段显示。 */
    function notified(tone: "error" | "warning", key: ProjectsTextKey, params?: TextParams): string {
        host.notifications.notify({tone, message: projectsText(key, params)});
        return t(key, params);
    }
}
