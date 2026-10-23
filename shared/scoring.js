/**
 * 教学评分规则。前端与后端共用同一份实现，保证排行榜、教师后台和游戏内显示的分数一致。
 * 纯函数，不依赖 DOM、数据库或游戏引擎。
 */

const REVENUE_TARGET = 10_000_000; // 累计算力收入满分目标（USD）
const PROFIT_TARGET = 100_000; // 单日经营现金流满分目标（USD / 天）
const CAPACITY_TARGET = 2_048; // 就绪算力满分目标（GPU）
const CASH_TARGET = 32_000_000; // 现金安全满分目标（USD）
const SPEED_DAYS = 30; // 董事会建议完成周期

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const ratio = (value, target) => clamp(num(value) / target, 0, 1);

/** 与 lib/game.ts 的 metrics() 保持一致的最低限度容量计算，用于评分。 */
export function capacityOf(state) {
  const gpu = num(state?.gpu);
  const optical = num(state?.optical);
  const storage = num(state?.storage);
  const cooling = Math.floor(num(state?.cooling) * (state?.incident > 0 && !state?.mitigated ? 0.5 : 1));
  const power = Math.floor(num(state?.power) * (1000 / (1.3 * 1.2)));
  const space = num(state?.progress) >= 100 ? 4096 : 512;
  return Math.max(0, Math.min(gpu, optical, storage, cooling, power, space));
}

/** 把游戏存档归纳成排行榜需要的字段。 */
export function summarize(state) {
  const s = state && typeof state === 'object' ? state : {};
  const day = Math.max(1, Math.floor(num(s.day, 1)));
  const cash = num(s.cash);
  const installedGpu = Math.max(0, Math.floor(num(s.gpu)));
  const capacity = capacityOf(s);
  const progress = clamp(num(s.progress), 0, 100);
  const totalRevenue = Math.max(0, num(s.totalRevenue));
  const dailyProfit = num(s.lastRevenue) - num(s.lastCost);
  return {
    day,
    cash,
    installedGpu,
    capacity,
    progress,
    totalRevenue,
    dailyProfit,
    won: s.won === true,
    lost: s.lost === true,
  };
}

const COMPONENTS = [
  {
    key: 'revenue',
    label: '累计营收',
    max: 3000,
    detail: (s) => `${formatMoney(s.totalRevenue)} / ${formatMoney(REVENUE_TARGET)}`,
    points: (s) => ratio(s.totalRevenue, REVENUE_TARGET) * 3000,
  },
  {
    key: 'cashflow',
    label: '日经营现金流',
    max: 2000,
    detail: (s) => `${formatMoney(s.dailyProfit)} / 天 · 目标 ${formatMoney(PROFIT_TARGET)}`,
    points: (s) => ratio(s.dailyProfit, PROFIT_TARGET) * 2000,
  },
  {
    key: 'capacity',
    label: '就绪算力',
    max: 2000,
    detail: (s) => `${s.capacity.toLocaleString('en-US')} / ${CAPACITY_TARGET.toLocaleString('en-US')} GPU`,
    points: (s) => ratio(s.capacity, CAPACITY_TARGET) * 2000,
  },
  {
    key: 'build',
    label: '建设进度',
    max: 1000,
    detail: (s) => `A2 机房 ${Math.round(s.progress)}%`,
    points: (s) => ratio(s.progress, 100) * 1000,
  },
  {
    key: 'cash',
    label: '现金安全',
    max: 1000,
    detail: (s) => `${formatMoney(Math.max(0, s.cash))} / ${formatMoney(CASH_TARGET)}`,
    points: (s) => ratio(Math.max(0, s.cash), CASH_TARGET) * 1000,
  },
  {
    key: 'goal',
    label: '董事会目标',
    max: 700,
    detail: (s) => (s.won ? '已达成' : '未达成'),
    points: (s) => (s.won ? 700 : 0),
  },
  {
    key: 'speed',
    label: '达成速度',
    max: 300,
    detail: (s) => (s.won ? `第 ${s.day} 天完成，建议 ${SPEED_DAYS} 天内` : '达成目标后计分'),
    points: (s) => (s.won ? ratio(Math.max(0, SPEED_DAYS - s.day), SPEED_DAYS) * 300 : 0),
  },
];

function formatMoney(value) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(Number(value)) ? Number(value) : 0);
}

/** 等级只取决于总分，方便课堂解释。 */
export function gradeOf(score) {
  if (score >= 8500) return 'S';
  if (score >= 7000) return 'A';
  if (score >= 5500) return 'B';
  if (score >= 3500) return 'C';
  return 'D';
}

export function evaluate(state) {
  const summary = summarize(state);
  const components = COMPONENTS.map((component) => ({
    key: component.key,
    label: component.label,
    max: component.max,
    points: Math.round(component.points(summary)),
    detail: component.detail(summary),
  }));
  const score = components.reduce((total, component) => total + component.points, 0);
  return {
    score,
    grade: gradeOf(score),
    components,
    summary,
    maxScore: COMPONENTS.reduce((total, component) => total + component.max, 0),
  };
}

/** 服务端校验用：存档必须是可序列化、结构合理且体积有限的 JSON。 */
export function isPlausibleState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
  if (state.version !== 1) return false;
  const day = Number(state.day);
  if (!Number.isInteger(day) || day < 1 || day > 9999) return false;
  for (const key of ['cash', 'gpu', 'optical', 'power', 'storage', 'cooling', 'progress']) {
    if (!Number.isFinite(Number(state[key]))) return false;
  }
  if (Number(state.cash) < -1e12 || Number(state.cash) > 1e12) return false;
  for (const key of ['orders', 'contracts', 'ledger', 'events', 'visited', 'spotLog']) {
    if (!Array.isArray(state[key])) return false;
    if (state[key].length > 500) return false;
  }
  return true;
}
