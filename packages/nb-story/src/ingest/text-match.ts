/**
 * 在一段文字里找出一批字串中出现了哪些。编译的称呼匹配（compile.ts）与“已有记录”的相关对象（context.ts）共用。
 */

/**
 * 返回一个函数：给一段文字，找出 `texts` 里在其中出现过的那些。按前两个 UTF-16 码元分桶，扫一遍文字、只在命中的
 * 桶里逐个比，所以用时随文字长度增长，不随字串个数增长。字串至少要有两个码元（称呼至少两个字）。
 */
export function occurrenceFinder(texts: Iterable<string>): (text: string) => Set<string> {
    const buckets = new Map<string, string[]>();
    for (const text of new Set(texts)) {
        const head = text.slice(0, 2);
        buckets.set(head, [...(buckets.get(head) ?? []), text]);
    }
    return text => {
        const found = new Set<string>();
        for (let i = 0; i + 1 < text.length; i++) {
            const bucket = buckets.get(text.slice(i, i + 2));
            if (bucket) for (const candidate of bucket) if (text.startsWith(candidate, i)) found.add(candidate);
        }
        return found;
    };
}
