/** 拥有者的错误码：一个字面量数组既给运行时用，也派生联合类型。 */
export const ERROR_CODES = ["io-error", "not-found", "unknown-outcome"] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** 双向穷举：目录里的码集合必须与联合类型完全一致（缺了或多了都是编译错误）。 */
export type ExactCodes<Catalog extends Record<string, unknown>> =
    [Exclude<ErrorCode, keyof Catalog>] extends [never]
        ? ([Exclude<keyof Catalog, ErrorCode>] extends [never] ? true : {extraCodes: Exclude<keyof Catalog, ErrorCode>})
        : {missingCodes: Exclude<ErrorCode, keyof Catalog>};
