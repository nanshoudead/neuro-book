/**
 * Simple Calendar 示例：奇幻世界四季历法
 *
 * 特点：
 * - 一年 4 个月（春夏秋冬），每月 90 天
 * - 一天 24 小时
 * - 支持星期（7天循环）
 * - Era 前后缀（新纪元/旧纪元）
 */

export default {
  type: 'simple',

  eraBefore: '旧纪元',  // instant < 0 时的纪元名
  eraAfter: '新纪元',   // instant >= 0 时的纪元名

  baseUnit: 'second',   // instant 的单位（1 刻 = 1 秒）

  units: [
    // 从小到大定义单位（顺序可以乱，系统会自动拓扑排序）
    { name: 'minute', parent: 'second', ratio: 60 },
    { name: 'hour', parent: 'minute', ratio: 60 },
    { name: 'day', parent: 'hour', ratio: 24 },

    // 星期（可选，用于显示周几）
    {
      name: 'week',
      parent: 'day',
      ratio: 7,
      cycleNames: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
      startOffset: 0  // instant=0 是周一
    },

    // 月份（4 个月，每月 90 天）
    {
      name: 'month',
      parent: 'day',
      ratio: 90,
      cycleNames: ['春之月', '夏之月', '秋之月', '冬之月']
    },

    // 年（一年 = 4 个月）
    { name: 'year', parent: 'month', ratio: 4 }
  ],

  // Format 模板（可用 token 见 reference/world-engine/calendar-system.md）
  format: '{eraName}{year}年{monthName}{day}日 {week} {hour:02}:{minute:02}'
};

/**
 * 示例输出：
 *
 * instant = 0
 * → "新纪元1年春之月1日 周一 00:00"
 *
 * instant = 31536000  (约一年后)
 * → "新纪元2年春之月1日 周一 00:00"
 */
