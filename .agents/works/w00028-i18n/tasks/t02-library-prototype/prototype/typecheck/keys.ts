/**
 * 键类型：从 JSON 目录的类型派生。`resolveJsonModule` 下 JSON 值的类型是 `string`，不是字面量，
 * 所以能派生出“键”，派生不出“参数”（参数要么在运行时校验，要么目录改写成 `as const` 的 TS 对象）。
 */

type PluralSuffix = "_zero" | "_one" | "_two" | "_few" | "_many" | "_other";

/** 目录对象的叶子路径，点号拼接；复数后缀折叠成同一个逻辑键。 */
export type KeyOf<T, Prefix extends string = ""> = {
    [K in keyof T & string]: T[K] extends string
        ? `${Prefix}${K extends `${infer Base}${PluralSuffix}` ? Base : K}`
        : T[K] extends Record<string, unknown>
            ? KeyOf<T[K], `${Prefix}${K}.`>
            : never;
}[keyof T & string];

/** 带命名空间的完整键：`<ns>:<key>`。 */
export type NamespacedKey<Catalogs extends Record<string, unknown>> = {
    [Ns in keyof Catalogs & string]: `${Ns}:${KeyOf<Catalogs[Ns]>}`;
}[keyof Catalogs & string];

export interface TypedT<Catalogs extends Record<string, unknown>> {
    (key: NamespacedKey<Catalogs>, params?: Record<string, string | number | undefined>): string;
}

/** 把任意 `t(key, params)` 收窄成只接受目录里存在的键。 */
export function typed<Catalogs extends Record<string, unknown>>(t: (key: string, params?: Record<string, unknown>) => string): TypedT<Catalogs> {
    return t as TypedT<Catalogs>;
}

/** 在某个命名空间内取键，调用点不用重复写命名空间。 */
export function scoped<Catalogs extends Record<string, unknown>, Ns extends keyof Catalogs & string>(t: TypedT<Catalogs>, ns: Ns): (key: KeyOf<Catalogs[Ns]>, params?: Record<string, string | number | undefined>) => string {
    return (key, params) => t(`${ns}:${key}` as NamespacedKey<Catalogs>, params);
}
