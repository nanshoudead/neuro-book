/**
 * 产品版本：内置插件的版本、第三方插件 `engines.neurobook` 的兼容检查都以它为准（ADR 0027，
 * docs/specs/runtime/plugin-install.md）。
 *
 * 写成常量而不是读 `package.json`：前端构建与服务端都引用它，不必把整份包清单打进页面。与包 `package.json` 的
 * `version` 保持一致，由 `product.test.ts` 核对。
 */

export const PRODUCT_VERSION = "0.1.0";
