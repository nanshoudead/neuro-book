/**
 * 插件 SDK 的组件入口：nb-ui 的组件，第三方插件以 `@notnotype/nb-plugin-sdk/components` 导入（docs/specs/runtime/plugin-code-loading.md
 * 的“共享入口即兼容承诺”）。nb-ui 是不发布的私有包，作者装不到它；组件的构建期实现与类型随 SDK 包分发，插件运行时宿主模块表给的
 * 是宿主自己用的那一份。
 */

export * from "@notnotype/nb-ui/components";
