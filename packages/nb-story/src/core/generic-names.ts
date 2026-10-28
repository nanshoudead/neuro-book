/**
 * 泛称：不指向某一个具体的人、只说身份或类别的称呼（docs/specs/story/queries.md 输出 22）。
 *
 * 抽取会把“学姐”“新生”“那个女人”这类词登记成对象的称呼，段落扫描再把每处出现都记成它的出场：一个叫“新生”的对象
 * 出场 540 次，同场与关系图的权重全被带歪（2026-10-27 开发者拿《老师，男生也能报考魔女学院吗？》的图核实）。
 * 所以查询时：整个词是泛称的称呼不计出场、不在阅读页里链到对象；称呼全是泛称的对象标成无名（`anonymous`）。
 * 只认整个词：整个词等于词表里的一项，或者能完全切成词表里的几项（“志愿者学姐”= 志愿者 + 学姐，w00024 t35：马甲核对把只叫
 * “志愿者学姐”的路人连到了别人）。“墨学姐”“绯烟老师”带了专名，切不完，不是泛称。
 */

const GENERIC = new Set([
    // 学校里的身份
    "学姐", "学妹", "学长", "学弟", "同学", "学生", "新生", "老生", "志愿者", "考官", "监考老师", "老师", "导师", "教授", "主任", "年级主任", "年级长", "校长", "院长", "学院长", "会长", "副会长", "学生会长",
    // 性别与年龄
    "女人", "男人", "女子", "男子", "女孩", "男孩", "女生", "男生", "少女", "少年", "姑娘", "小姑娘", "小伙", "小伙子", "大叔", "大姐", "大姐姐", "大哥", "大哥哥", "阿姨", "叔叔", "姐姐", "哥哥", "妹妹", "弟弟", "老头", "老太婆", "老人", "孩子", "小孩", "小妹妹", "小魔女", "小学妹",
    // 场合里的角色
    "店员", "路人", "客人", "服务员", "侍者", "护士", "医生", "司机", "保安", "守卫", "黑衣人", "陌生人", "神秘人", "那个人", "那人", "对方", "少爷", "大小姐", "大少爷",
]);

/** 泛称前面常带的指示词：“那个学生”“一位老师”和“学生”“老师”一样是泛称。 */
const DEMONSTRATIVE = /^(?:那个|这个|那位|这位|那名|这名|某个|某位|一个|一名|一位|另一个|另一位|另一名)/u;

/** 整个词能完全切成泛称词表里的词（一项或几项连写）。 */
function segmentsIntoGeneric(text: string): boolean {
    if (!text) return false;
    // reachable[i]：前 i 个字能切完。词表的词都很短，逐个起点试一遍即可。
    const reachable = new Array<boolean>(text.length + 1).fill(false);
    reachable[0] = true;
    for (let end = 1; end <= text.length; end++) {
        for (let start = 0; start < end && !reachable[end]; start++) reachable[end] = reachable[start]! && GENERIC.has(text.slice(start, end));
    }
    return reachable[text.length]!;
}

/** 整个词（去掉前面的指示词后）是泛称。 */
export function isGenericName(text: string): boolean {
    const trimmed = text.trim();
    return segmentsIntoGeneric(trimmed) || segmentsIntoGeneric(trimmed.replace(DEMONSTRATIVE, ""));
}

/** 称呼全是泛称（或没有称呼）。 */
export function allGeneric(names: readonly {text: string}[]): boolean {
    return names.every(name => isGenericName(name.text));
}
