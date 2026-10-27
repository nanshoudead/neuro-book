/**
 * 上次的界面语言（docs/specs/runtime/browser-host.md）：设置插件激活前、设置快照超时或引导失败时，宿主用它决定界面语言，
 * 免得英文用户先看到一次中文。只记来自用户设置的值，不记缺省值；读到的值不在宿主语言集合里时当作没有。
 */

import {HOST_LOCALES} from "nbook/shared/host-locales";

export const HOST_LOCALE_KEY = "nbook.host-locale";

export interface LocaleHintStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export function readLocaleHint(storage: () => LocaleHintStorage): string | null {
    try {
        const value = storage().getItem(HOST_LOCALE_KEY);
        return value !== null && HOST_LOCALES.some((locale) => locale.tag === value) ? value : null;
    } catch {
        // 本地存储不可用（隐私模式、被禁用）时就是“没有记录”，按缺省语言启动；不是要上报的错误。
        return null;
    }
}

export function writeLocaleHint(storage: () => LocaleHintStorage, tag: string, warn: (message: string) => void): void {
    try {
        storage().setItem(HOST_LOCALE_KEY, tag);
    } catch (error) {
        warn(`cannot remember the display language: ${error instanceof Error ? error.message : String(error)}`);
    }
}
