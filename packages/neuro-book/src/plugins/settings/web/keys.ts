/**
 * 设置窗口自己处理的几个快捷键（docs/specs/settings/settings-window.md 输出 21、23）：`Mod+F` 聚焦搜索、`Mod+S` 保存设置
 * 文件。不进命令表：它们只在焦点在窗口里时生效，窗口外照旧是浏览器与编辑器的。
 *
 * 按物理键（`event.code`）比，不按字符：别的键盘布局（俄文、希腊文）下 `event.key` 不是拉丁字母。`Mod` 按平台取：macOS
 * 上是 Command，其它平台是 Ctrl（macOS 上 `Ctrl+F` 在文本框里是光标前进一格，不能拦）。
 */

import {currentKeyPlatform} from "nbook/plugins/commands/shared/contracts";

/** `Mod+<code>`，没有别的修饰键。 */
export function isModKey(event: KeyboardEvent, code: string): boolean {
    if (event.code !== code || event.altKey || event.shiftKey) return false;
    return currentKeyPlatform() === "mac" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** 输入法正在组字（Safari 结束组字的那一下是 `isComposing` 为假、`keyCode` 为 229）：这时的按键不算快捷键。 */
export function composing(event: KeyboardEvent): boolean {
    return event.isComposing || event.keyCode === 229;
}
