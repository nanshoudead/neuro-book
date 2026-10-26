/**
 * 组件记诊断的出口：`nbook.markdown` 交组件时连同方言目录一起给（`../plugin.ts` 的包装），落到诊断服务。组件不直接依赖诊断
 * 服务：Lab 与组件测试挂组件时不给它，诊断就丢掉。
 */

import type {InjectionKey} from "vue";

export type MarkdownReport = (event: string, message: string, error: unknown) => void;

export const markdownReportKey: InjectionKey<MarkdownReport> = Symbol("nbook.markdown/report");
