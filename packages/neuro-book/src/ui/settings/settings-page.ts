/**
 * 包一个 page 分区的实现（docs/specs/settings/settings-window.md“分区声明”）：设置窗口创建页面时只传 `context`，页面还要的
 * 属性由 `props` 补上（`nbook/ui/bound-component`）。返回值按结构写，就是 `SettingsPageImplementation`。
 */

import type {Component} from "vue";

import {boundComponent} from "nbook/ui/bound-component";

export function settingsPage(load: () => Promise<Component | {readonly default: Component}>, props?: () => Readonly<Record<string, unknown>>): {load(): Promise<Component>} {
    return boundComponent("SettingsPage", load, props);
}
