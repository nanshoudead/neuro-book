/**
 * 字段的路径与值的不可变更新（docs/specs/ui/forms.md 输出 3、4、6）。
 *
 * 路径在内部是片段数组，对外编码成 RFC 6901 的 JSON Pointer。不用 TypeBox 错误里的 `instancePath` 当路径：它不转义
 * 属性名里的 `/`，`"a/b"` 与嵌套的 `a.b` 会落到同一个字符串上。
 */

export type PathSegment = string | number;
export type FieldPath = ReadonlyArray<PathSegment>;

export function toPointer(path: FieldPath): string {
    return path.map((segment) => `/${String(segment).replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
}

export function getAt(value: unknown, path: FieldPath): unknown {
    let current = value;
    for (const segment of path) {
        if (current === null || typeof current !== "object") return undefined;
        current = (current as Record<PathSegment, unknown>)[segment];
    }
    return current;
}

/**
 * 写时复制：沿路径复制每一层，未改动的分支保留原引用；从不修改传入的值（设置传进来的值是冻结的）。路径中间缺的
 * 层按下一段的类型补出对象或数组。
 */
export function setAt(value: unknown, path: FieldPath, next: unknown): unknown {
    if (path.length === 0) return next;
    const [head, ...rest] = path;
    const child = setAt(getAt(value, [head!]), rest, next);
    if (typeof head === "number") {
        const array = Array.isArray(value) ? [...value] : [];
        array[head] = child;
        return array;
    }
    const base = value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {...base, [head!]: child};
}

/** 删去路径末端：对象删键（不写 `undefined`），数组移除这一项。路径不存在时原样返回。 */
export function removeAt(value: unknown, path: FieldPath): unknown {
    if (path.length === 0) return undefined;
    const parentPath = path.slice(0, -1);
    const last = path[path.length - 1]!;
    const parent = getAt(value, parentPath);
    if (Array.isArray(parent) && typeof last === "number") {
        if (last < 0 || last >= parent.length) return value;
        return setAt(value, parentPath, [...parent.slice(0, last), ...parent.slice(last + 1)]);
    }
    if (parent === null || typeof parent !== "object" || !Object.hasOwn(parent, last)) return value;
    const {[last]: _removed, ...kept} = parent as Record<string, unknown>;
    return setAt(value, parentPath, kept);
}
