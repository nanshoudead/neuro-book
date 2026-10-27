/**
 * 宿主页面（失败页、找不到页面、离线横幅、加载页）的文字都在宿主目录里，命名空间 `nbook.host`
 * （docs/specs/runtime/browser-host.md 输出 8）。组件用 `hostText(key)` 构造引用，再经 `useText().t` 翻译，
 * 不各自手写命名空间。
 */

import {textRef} from "@notnotype/nb-ui/text";
import type {TextParams, TextRef} from "@notnotype/nb-ui/text";

export const HOST_NAMESPACE = "nbook.host";

export function hostText(key: string, params?: TextParams): TextRef {
    return textRef(key, params, HOST_NAMESPACE);
}
