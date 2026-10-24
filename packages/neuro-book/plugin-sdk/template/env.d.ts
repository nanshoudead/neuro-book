// 让只认 .ts 的工具（编辑器之外的 tsc）也认得单文件组件的导入；完整的检查用 `bun run typecheck`（vue-tsc）。
declare module "*.vue" {
    import type {Component} from "vue";
    const component: Component;
    export default component;
}
