import {inject, provide, type InjectionKey} from "vue";
import {sessionName, type SessionName} from "./format.js";
import type {SessionTitle} from "./types.js";

/**
 * 会话标题从页面传给下面的零件（t17）：页面把自己数据里的 `sessionTitles` 交给 `provideSessionTitles`，
 * 零件用 `useSessionTitles()` 按会话键取显示名，不必每个零件都多一个 prop。读的是 getter：页面数据换了，零件下次渲染就是新标题。
 * 没有页面提供时按空表处理（只显示短键），所以零件放在别处照样能渲染。
 */
type TitlesSource = () => Readonly<Record<string, SessionTitle>>;
const SESSION_TITLES: InjectionKey<TitlesSource> = Symbol("nbdev-session-titles");
const NONE: Readonly<Record<string, SessionTitle>> = Object.freeze({});

export function provideSessionTitles(read: () => Readonly<Record<string, SessionTitle>> | null | undefined): void {
    provide(SESSION_TITLES, () => read() ?? NONE);
}

export function useSessionTitles(): (key: string, label?: string | null) => SessionName {
    const read = inject(SESSION_TITLES, null) ?? (() => NONE);
    return (key, label = null) => sessionName(key, label, read());
}
