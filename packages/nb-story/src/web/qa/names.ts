/**
 * 答案里的人名点开人物卡（决定 16）：按名字查对象。查法用核心已有的按名字解析（`entity.card` 的 `entity` 可以写名字：
 * 可见称呼与显示名精确相等、唯一时得到对象，重名报 `entity_ambiguous`），不在网页里另写匹配规则；找不到或重名的
 * 不做成链接。按查看器的位置查（抽屉也按它打开），所以对话读到的位置之后才出现的人不成链接。
 *
 * 答案里写的是自由文字：“南嘉鱼（地狱猫）”只查括号前的名字；“读者”“众人”这类不是人名的不查。
 */

/** 不是人名的写法：出现在“谁知道什么”里，但不对应书里的对象。 */
const NOT_NAMES = new Set(["读者", "众人", "所有人", "大家", "旁人", "其他人", "没有人", "无人", "她们", "他们", "她们俩", "他们俩"]);

/** 要查的名字；不查时为 null。 */
export function nameToLook(who: string): string | null {
    const name = who.replace(/[（(][^）)]*[）)]/gu, "").trim();
    return name === "" || NOT_NAMES.has(name) ? null : name;
}

/** 查到的对象 id；找不到、重名或查询失败都是 null。 */
export type NameLookup = (name: string) => Promise<string | null>;

/**
 * 按名字缓存查询：同一个键（书、位置与数据版本由调用方编进 `scope`）下同一个名字只查一次，同时要的共用同一个请求。
 * `scope` 变了（拨了阅读位置、数据重新抽取过）就是新的缓存。
 */
export function createNameResolver(lookup: NameLookup): (scope: string, who: string) => Promise<string | null> {
    const cache = new Map<string, Promise<string | null>>();
    return (scope, who) => {
        const name = nameToLook(who);
        if (name === null) return Promise.resolve(null);
        const key = `${scope}\u0000${name}`;
        let found = cache.get(key);
        if (found === undefined) {
            found = lookup(name).catch(() => null);
            cache.set(key, found);
        }
        return found;
    };
}
