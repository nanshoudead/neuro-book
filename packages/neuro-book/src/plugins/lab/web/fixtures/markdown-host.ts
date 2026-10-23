/**
 * 单独挂 nb-markdown 组件的 Lab 场景用 nbook 的宿主（作品文件的引用是带文件图标的文件小块），与应用里 `markdownKey` 交出的
 * 组件一样。不包这一层时组件用 nb-markdown 的缺省宿主，作品文件的引用会显示成不带文件图标的“其它”。
 */

import {defineComponent, h} from "vue";
import type {Component} from "vue";

import {provideMarkdownHost} from "@notnotype/nb-markdown/host";

import {nbookMarkdownHost} from "nbook/plugins/markdown/web/host";

export function withNbookMarkdownHost(inner: Component): {default: Component} {
    return {
        default: defineComponent({
            name: "LabNbookMarkdownHost",
            inheritAttrs: false,
            setup: (_props, {attrs, slots}) => {
                provideMarkdownHost(nbookMarkdownHost({}));
                return () => h(inner, attrs, slots);
            },
        }),
    };
}
