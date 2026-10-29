/**
 * 关系图的布局方式。单独放在 `.ts` 里：`host/relations-view.ts` 这类纯 TS 模块要用它，而它们的类型检查（不经 vue-tsc 的
 * `tsc` 那一步）读不了 `.vue` 文件里的导出。`StoryNetwork.vue` 照旧导出同一个类型。
 */
export type GraphLayout = "force" | "concentric" | "circle" | "stress";
