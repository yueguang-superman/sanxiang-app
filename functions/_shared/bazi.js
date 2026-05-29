const stems = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
const branches = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
const stemElement = { 甲: "木", 乙: "木", 丙: "火", 丁: "火", 戊: "土", 己: "土", 庚: "金", 辛: "金", 壬: "水", 癸: "水" };
const branchElement = { 子: "水", 丑: "土", 寅: "木", 卯: "木", 辰: "土", 巳: "火", 午: "火", 未: "土", 申: "金", 酉: "金", 戌: "土", 亥: "水" };
const monthBranches = ["寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥", "子", "丑"];
const monthBoundaries = [
  [2, 4], [3, 6], [4, 5], [5, 6], [6, 6], [7, 7],
  [8, 8], [9, 8], [10, 8], [11, 7], [12, 7], [1, 6],
];

const ganzhi = (index) => stems[((index % 10) + 10) % 10] + branches[((index % 12) + 12) % 12];

const jdn = (year, month, day) => {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524;
};

const solarYear = (date) => {
  const year = date.getFullYear();
  const lichun = new Date(year, 1, 4, 0, 0, 0);
  return date < lichun ? year - 1 : year;
};

const monthIndex = (date) => {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  for (let i = monthBoundaries.length - 1; i >= 0; i -= 1) {
    const [bm, bd] = monthBoundaries[i];
    if (bm === 1) {
      if (m === 1 && d >= bd) return 11;
    } else if (m > bm || (m === bm && d >= bd)) {
      return i;
    }
  }
  return 11;
};

const monthStemStart = (yearStemIndex) => {
  if ([0, 5].includes(yearStemIndex)) return 2;
  if ([1, 6].includes(yearStemIndex)) return 4;
  if ([2, 7].includes(yearStemIndex)) return 6;
  if ([3, 8].includes(yearStemIndex)) return 8;
  return 0;
};

const hourBranchIndex = (hour) => {
  if (hour === 23) return 0;
  return Math.floor((hour + 1) / 2) % 12;
};

const hourStemStart = (dayStemIndex) => {
  if ([0, 5].includes(dayStemIndex)) return 0;
  if ([1, 6].includes(dayStemIndex)) return 2;
  if ([2, 7].includes(dayStemIndex)) return 4;
  if ([3, 8].includes(dayStemIndex)) return 6;
  return 8;
};

const tenGod = (dayStem, otherStem) => {
  const relations = {
    木: { 木: "比劫", 火: "食伤", 土: "财星", 金: "官杀", 水: "印星" },
    火: { 火: "比劫", 土: "食伤", 金: "财星", 水: "官杀", 木: "印星" },
    土: { 土: "比劫", 金: "食伤", 水: "财星", 木: "官杀", 火: "印星" },
    金: { 金: "比劫", 水: "食伤", 木: "财星", 火: "官杀", 土: "印星" },
    水: { 水: "比劫", 木: "食伤", 火: "财星", 土: "官杀", 金: "印星" },
  };
  return relations[stemElement[dayStem]][stemElement[otherStem]];
};

export const calculateBazi = (birth) => {
  const [year, month, day] = String(birth.birthDate || "").split("-").map(Number);
  const [hour = 12, minute = 0] = String(birth.birthTime || "12:00").split(":").map(Number);
  if (!year || !month || !day) throw new Error("出生日期无效。");

  const date = new Date(year, month - 1, day, hour, minute);
  const gzYear = solarYear(date);
  const yearIndex = gzYear - 1984;
  const yearPillar = ganzhi(yearIndex);

  const mIndex = monthIndex(date);
  const yStemIndex = stems.indexOf(yearPillar[0]);
  const monthStemIndex = (monthStemStart(yStemIndex) + mIndex) % 10;
  const monthPillar = stems[monthStemIndex] + monthBranches[mIndex];

  const dayIndex = (jdn(year, month, day) + 49) % 60;
  const dayPillar = ganzhi(dayIndex);

  const hBranchIndex = hourBranchIndex(hour);
  const dStemIndex = stems.indexOf(dayPillar[0]);
  const hStemIndex = (hourStemStart(dStemIndex) + hBranchIndex) % 10;
  const hourPillar = stems[hStemIndex] + branches[hBranchIndex];

  const pillars = [
    { label: "年柱", value: yearPillar },
    { label: "月柱", value: monthPillar },
    { label: "日柱", value: dayPillar },
    { label: "时柱", value: hourPillar },
  ];

  const elements = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
  for (const pillar of pillars) {
    elements[stemElement[pillar.value[0]]] += 1;
    elements[branchElement[pillar.value[1]]] += 1;
  }

  const dayMaster = dayPillar[0];
  const gods = pillars
    .filter((pillar) => pillar.label !== "日柱")
    .map((pillar) => `${pillar.label}${pillar.value[0]}为${tenGod(dayMaster, pillar.value[0])}`);

  const sorted = Object.entries(elements).sort((a, b) => b[1] - a[1]);
  const strongest = sorted[0][0];
  const weakest = sorted[sorted.length - 1][0];
  const summary = `日主为${dayMaster}${stemElement[dayMaster]}。五行以${strongest}气较显，${weakest}气较少；宜看岁运补偏救弊，不宜单凭一柱断吉凶。`;

  return {
    pillars,
    elements,
    dayMaster,
    tenGods: gods,
    summary,
    luckHint: `以${dayMaster}日为身，参考月令${monthPillar[1]}与五行偏枯，先取平衡，再论财官印食。`,
  };
};
