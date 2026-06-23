/**
 * World Engine Calendar for new projects.
 *
 * 使用 Simple Calendar（通用单位链），支持自定义单位层级。
 * 也可改为 type: 'gregorian'（真实公历）或 type: 'custom'（完全自定义）。
 */

export default {
  type: 'simple',

  // Era 前后缀
  eraBefore: '蒙昧纪元',  // instant < 0 时
  eraAfter: '新生纪元',   // instant >= 0 时

  baseUnit: 'second',

  // 单位定义（可乱序，系统会自动拓扑排序）
  units: [
    { name: 'minute', parent: 'second', ratio: 60 },
    { name: 'hour', parent: 'minute', ratio: 60 },
    { name: 'day', parent: 'hour', ratio: 24 },
    { name: 'month', parent: 'day', ratio: 30 },
    { name: 'year', parent: 'month', ratio: 12 }
  ],

  // Format 模板
  format: '{eraName}{year}年{month}月{day}日 {hour:02}:{minute:02}:{second:02}'
};

/**
 * 其他选项：
 *
 * 1. 月份名（春之月/夏之月等）：
 *    在 month unit 添加 cycleNames:
 *    { name: 'month', parent: 'day', ratio: 90,
 *      cycleNames: ['春之月', '夏之月', '秋之月', '冬之月'] }
 *    format: '{eraName}{year}年{monthName}{day}日'
 *
 * 2. 真实公历（带闰年）：
 *    type: 'gregorian',
 *    eraBefore: '公元前',
 *    eraAfter: '公元',
 *    format: '{eraName}{year}年{month}月{day}日'
 *
 * 3. 完全自定义（如农历闰月）：
 *    type: 'custom',
 *    format(instant: bigint): string { ... },
 *    parse(input: string): bigint { ... }
 *
 * 详见 reference/world-engine/calendar-system.md
 */
