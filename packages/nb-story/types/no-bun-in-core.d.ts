// tsconfig.core.json 把 `bun` 与 `bun:*` 指到这个空模块：核心代码从这里取不到任何导出，类型检查就会报错。
// 不映射时 TypeScript 会退回 node_modules/@types/bun，`import … from "bun"` 能悄悄通过类型检查，只在 Node 下运行时才失败。
export {};
