/**
 * 插件描述上可选的自检（构建预设与作者工具之间的约定）：作者工具在描述对象上挂这个键（不可枚举，不进清单），构建执行完描述
 * 与全部入口定义模块之后调用它，返回的每一条成为一个构建问题。用来查“定义了却没写进描述”的声明：定义它们的模块要先执行完，
 * 才知道有哪些，所以不能在生成描述时就查。
 */
export const DESCRIPTOR_CHECK: unique symbol = Symbol.for("plugin-platform.descriptor-check");

export type DescriptorCheck = () => ReadonlyArray<string>;
