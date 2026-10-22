/**
 * 设置窗口标题区的通道（docs/specs/settings/settings-window.md 输出 3、13、19）：窗口 `provide`，页面里的 `SettingsPageActions`
 * 与 `SettingsPageList` 经它与标题区说话。不是公开接口，只给 `src/ui/settings/` 的组件与窗口自己用；页面作者用的是
 * 那两个组件与 `SettingsPageContext`。
 *
 * 通道交给页面的有四样：
 * - 页面级操作的挂载点（`actionsTarget`）：标题区右侧的一个元素，操作 Teleport 到它里面。
 * - 这一层能不能写（`writable`）：操作整体据此停用。
 * - 标题替换（`claim`）：页面里打开了下一级时，标题区换成“‹ 页面标题”返回与下一级的标题。
 * - 标题区右侧的提示文字（`claimNote`）：设置文件视图在保存被拒时把“未保存：第 N 行第 M 列：原因”写到那里。
 *
 * 时序：标题区与页面是同一次渲染里的前后两个子树，标题区的元素要等这一次挂载结束才拿得到（模板引用挂载后才设）。
 * 所以 `actionsTarget` 一开始是 null，页面先在原位渲染，目标一到就移过去，两步在同一个渲染周期里完成、不会被画出来。
 * 页面不需要也不应该等目标。
 */

import {computed, inject, shallowRef} from "vue";
import type {InjectionKey, Ref, ShallowRef} from "vue";

/** 页面登记的标题替换：`title` 画在标题区，`back` 是点“‹ 页面标题”时的动作（由页面决定怎样回到上一级）。 */
export interface SettingsTitleClaim {
    readonly title: string;
    readonly back: () => void;
}

export interface SettingsPageChrome {
    /** 页面级操作 Teleport 的目标；标题区还没挂载或已卸载时为 null。 */
    readonly actionsTarget: Readonly<ShallowRef<HTMLElement | null>>;
    /** 这一层能不能写（输出 13）。 */
    readonly writable: Readonly<Ref<boolean>>;
    /** 当前生效的标题替换；没有为 null。 */
    readonly titleClaim: Readonly<ShallowRef<SettingsTitleClaim | null>>;
    /**
     * 标题区挂载时登记它的操作挂载点，返回注销函数。注销只在目标还是自己的时候清掉：同一个窗口里标题区换了一份
     * （column 与 fill 两种页面各有一份）时，旧的卸载不会清掉新的。
     */
    attachActions(element: HTMLElement): () => void;
    /**
     * 登记标题替换，返回只撤销这一次登记的函数。后登记的盖过先登记的；撤销时只有自己还是当前登记才清，所以后来的登记
     * 已经撤销、或先后两次登记交错撤销时，旧的撤销不会误清别人的。页面在登记它的位置卸载时必须调用返回的函数。
     */
    claim(claim: SettingsTitleClaim): () => void;
    /** 设置文件视图登记的标题区右侧提示（已按显示语言写好）；没有为 null。 */
    readonly note: Readonly<Ref<string | null>>;
    /** 登记（或换掉）提示，返回只撤销这一次登记的函数；撤销与 `claim` 同一个规矩：只有自己还是当前登记才清。 */
    claimNote(note: string): () => void;
}

export const SETTINGS_PAGE_CHROME: InjectionKey<SettingsPageChrome> = Symbol("nbook.settings.page-chrome");

/** 窗口为自己创建一份通道；`writable` 是窗口模型当前标签那一层能不能写。 */
export function createPageChrome(writable: Readonly<Ref<boolean>>): SettingsPageChrome {
    const actionsTarget = shallowRef<HTMLElement | null>(null);
    const titleClaim = shallowRef<SettingsTitleClaim | null>(null);
    const note = shallowRef<{readonly text: string} | null>(null);
    return {
        actionsTarget,
        writable,
        titleClaim,
        note: computed(() => note.value?.text ?? null),
        claimNote: (text) => {
            // 同 `claim`：按对象身份认，文字相同的两次登记也不会混。
            const mine = {text};
            note.value = mine;
            return () => {
                if (note.value === mine) note.value = null;
            };
        },
        attachActions: (element) => {
            actionsTarget.value = element;
            return () => {
                if (actionsTarget.value === element) actionsTarget.value = null;
            };
        },
        claim: (claim) => {
            // 登记各用一个新对象，撤销按对象身份认：两次登记的内容相同也不会混。
            const mine: SettingsTitleClaim = {title: claim.title, back: claim.back};
            titleClaim.value = mine;
            return () => {
                if (titleClaim.value === mine) titleClaim.value = null;
            };
        },
    };
}

/** 页面里取窗口的通道；不在窗口里（例如 Lab 单独渲染一个组件）为 null，组件按没有通道的方式工作。 */
export function usePageChrome(): SettingsPageChrome | null {
    return inject(SETTINGS_PAGE_CHROME, null);
}
