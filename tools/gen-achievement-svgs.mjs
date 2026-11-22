// tools/gen-achievement-svgs.mjs —— 为每个成就生成独立 SVG 徽章
//
// 设计语言：
//   外框形状 = 稀有度（圆 / 圆角方 / 六边形 / 八角星 / 钻石）
//   外框描边 = 稀有度颜色
//   中心图形 = 成就类别 + 该成就的等级变化
//
// 输出：assets/svg/achievements/<id>.svg，另外拼一份 sprite.svg 给列表页用。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACHIEVEMENTS, RARITY } from '../lib/achievements.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets', 'svg', 'achievements');

const RARITY_COLORS = {
  common:    { edge: '#9ca3af', deep: '#6b7280', glow: '#d1d5db' },
  uncommon:  { edge: '#22c55e', deep: '#15803d', glow: '#86efac' },
  rare:      { edge: '#3b82f6', deep: '#1d4ed8', glow: '#93c5fd' },
  epic:      { edge: '#a855f7', deep: '#7e22ce', glow: '#d8b4fe' },
  legendary: { edge: '#f59e0b', deep: '#b45309', glow: '#fcd34d' },
};

const SIZE = 64;
const C = 32;          // 中心

// ── 外框：按稀有度换形状 ──
function frame(rarity) {
  const col = RARITY_COLORS[rarity] || RARITY_COLORS.common;
  switch (rarity) {
    case 'uncommon':
      return '<rect x="6" y="6" width="52" height="52" rx="14" fill="url(#bg)" stroke="' + col.edge + '" stroke-width="2.5"/>';
    case 'rare':
      return '<polygon points="32,4 56,18 56,46 32,60 8,46 8,18" fill="url(#bg)" stroke="' + col.edge + '" stroke-width="2.5"/>';
    case 'epic': {
      const pts = [];
      for (let i = 0; i < 16; i++) {
        const ang = (Math.PI / 8) * i - Math.PI / 2;
        const r = i % 2 === 0 ? 28 : 21;
        pts.push((32 + Math.cos(ang) * r).toFixed(2) + ',' + (32 + Math.sin(ang) * r).toFixed(2));
      }
      return '<polygon points="' + pts.join(' ') + '" fill="url(#bg)" stroke="' + col.edge + '" stroke-width="2.5"/>';
    }
    case 'legendary': {
      const pts = [];
      for (let i = 0; i < 8; i++) {
        const ang = (Math.PI / 4) * i - Math.PI / 2;
        const r = i % 2 === 0 ? 29 : 19;
        pts.push((32 + Math.cos(ang) * r).toFixed(2) + ',' + (32 + Math.sin(ang) * r).toFixed(2));
      }
      return '<polygon points="' + pts.join(' ') + '" fill="url(#bg)" stroke="' + col.edge + '" stroke-width="2.5"/>' +
             '<circle cx="32" cy="32" r="30" fill="none" stroke="' + col.glow + '" stroke-width="1.2" stroke-dasharray="3 4" opacity="0.75"/>';
    }
    default:
      return '<circle cx="32" cy="32" r="27" fill="url(#bg)" stroke="' + col.edge + '" stroke-width="2.5"/>';
  }
}

// ── 中心图形 ──
// 用几何零件拼，每个 glyph 一个函数；level 控制「几层 / 多高」，让同族成就可区分。
const GLYPHS = {
  // 里程碑：堆叠的方块，层数随等级
  stack: (n = 1) => {
    const out = [];
    const total = Math.min(5, n);
    for (let i = 0; i < total; i++) {
      const w = 26 - i * 4;
      const y = 42 - i * 6;
      out.push('<rect x="' + (C - w / 2) + '" y="' + y + '" width="' + w + '" height="5" rx="1.6" fill="currentColor"/>');
    }
    return out.join('');
  },
  // 难度：山峰，高度随等级；山顶留白让数字能压在上面
  peak: (n = 1) => {
    const h = 8 + Math.min(5, n) * 2.4;
    const base = 32;
    return '<path d="M14 ' + base + ' L' + C + ' ' + (base - h) + ' L50 ' + base + ' Z" fill="currentColor" opacity="0.85"/>' +
           '<path d="M' + C + ' ' + (base - h + 3) + ' L39 ' + (base - h + 7) + ' L25 ' + (base - h + 7) + ' Z" fill="#fff" opacity="0.85"/>';
  },
  // 连续天数：火焰，越大越旺
  flame: (n = 1) => {
    const s = 0.7 + Math.min(4, n) * 0.12;
    return '<path transform="translate(' + C + ' 34) scale(' + s.toFixed(2) + ') translate(-32 -34)" ' +
      'd="M32 12c6 8 12 13 12 21a12 12 0 0 1-24 0c0-5 3-8 5-12 1 3 3 5 5 5 2 0 3-2 3-5 0-4-1-7-1-9z" fill="currentColor"/>';
  },
  // 效率：靶心
  target: () => '<circle cx="32" cy="32" r="13" fill="none" stroke="currentColor" stroke-width="3"/>' +
                '<circle cx="32" cy="32" r="6" fill="none" stroke="currentColor" stroke-width="3"/>' +
                '<circle cx="32" cy="32" r="2.2" fill="currentColor"/>',
  // 每日挑战：太阳
  sun: () => {
    const rays = [];
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i;
      rays.push('<line x1="' + (32 + Math.cos(a) * 11).toFixed(1) + '" y1="' + (32 + Math.sin(a) * 11).toFixed(1) +
        '" x2="' + (32 + Math.cos(a) * 16).toFixed(1) + '" y2="' + (32 + Math.sin(a) * 16).toFixed(1) +
        '" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>');
    }
    return '<circle cx="32" cy="32" r="8" fill="currentColor"/>' + rays.join('');
  },
  // 夜猫子：月亮
  moon: () => '<path d="M38 14a18 18 0 1 0 0 36 14 14 0 1 1 0-36z" fill="currentColor"/>',
  // 早鸟：朝阳 + 地平线
  sunrise: () => '<path d="M18 40a14 14 0 0 1 28 0z" fill="currentColor"/>' +
                 '<line x1="12" y1="45" x2="52" y2="45" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  // 准确率：环形进度
  ring: (pct = 0.5) => {
    const r = 13, circ = 2 * Math.PI * r;
    const on = circ * pct;
    return '<circle cx="32" cy="32" r="' + r + '" fill="none" stroke="currentColor" stroke-width="3.5" opacity="0.25"/>' +
           '<circle cx="32" cy="32" r="' + r + '" fill="none" stroke="currentColor" stroke-width="3.5" ' +
           'stroke-dasharray="' + on.toFixed(1) + ' ' + (circ - on).toFixed(1) + '" stroke-linecap="round" transform="rotate(-90 32 32)"/>';
  },
  // 社区：书
  book: () => '<path d="M20 16h20a4 4 0 0 1 4 4v28a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4V20a4 4 0 0 1 4-4z" fill="none" stroke="currentColor" stroke-width="3"/>' +
              '<line x1="32" y1="16" x2="32" y2="52" stroke="currentColor" stroke-width="2.4"/>',
  // 点赞
  heart: () => '<path d="M32 48S16 38 16 27a9 9 0 0 1 16-5 9 9 0 0 1 16 5c0 11-16 21-16 21z" fill="currentColor"/>',
  // 对话
  chat: () => '<rect x="14" y="18" width="36" height="24" rx="7" fill="none" stroke="currentColor" stroke-width="3"/>' +
              '<path d="M24 42l-4 8 12-8z" fill="currentColor"/>',
  // 灯（提示）
  bulb: () => '<circle cx="32" cy="27" r="10" fill="none" stroke="currentColor" stroke-width="3"/>' +
              '<rect x="28" y="37" width="8" height="10" rx="2" fill="currentColor"/>',
  // 日历
  calendar: () => '<rect x="14" y="18" width="36" height="30" rx="5" fill="none" stroke="currentColor" stroke-width="3"/>' +
                  '<line x1="14" y1="27" x2="50" y2="27" stroke="currentColor" stroke-width="2.6"/>' +
                  '<line x1="24" y1="14" x2="24" y2="22" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>' +
                  '<line x1="40" y1="14" x2="40" y2="22" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  // 时钟
  clock: () => '<circle cx="32" cy="32" r="15" fill="none" stroke="currentColor" stroke-width="3"/>' +
               '<line x1="32" y1="32" x2="32" y2="22" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>' +
               '<line x1="32" y1="32" x2="40" y2="36" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  // 闪电
  bolt: () => '<path d="M36 12L20 36h10l-4 16 18-26H34z" fill="currentColor"/>',
  // 皇冠
  crown: () => '<path d="M14 44V24l9 8 9-14 9 14 9-8v20z" fill="currentColor"/>',
  // 盾
  shield: () => '<path d="M32 12l16 6v14c0 10-7 16-16 20-9-4-16-10-16-20V18z" fill="none" stroke="currentColor" stroke-width="3"/>',
  // 宝石
  gem: () => '<path d="M32 14l12 8-4 22-8 6-8-6-4-22z" fill="currentColor"/>',
  // 星
  star: () => '<path d="M32 12l5 13 14 1-11 9 3 14-11-8-11 8 3-14-11-9 14-1z" fill="currentColor"/>',
  // 硬币
  coin: () => '<circle cx="32" cy="32" r="14" fill="none" stroke="currentColor" stroke-width="3"/>' +
              '<path d="M32 24v16M28 28h8M28 36h8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  // 钞票
  bill: () => '<rect x="14" y="22" width="36" height="20" rx="4" fill="none" stroke="currentColor" stroke-width="3"/>' +
              '<circle cx="32" cy="32" r="5" fill="currentColor"/>',
  // 钱袋
  sack: () => '<path d="M24 24h16l6 20a6 6 0 0 1-6 6H24a6 6 0 0 1-6-6z" fill="currentColor"/>' +
              '<path d="M26 24l-3-8h18l-3 8z" fill="currentColor" opacity="0.8"/>',
  // 拳头（PK 胜利）
  fist: () => '<rect x="18" y="26" width="28" height="18" rx="7" fill="currentColor"/>' +
              '<rect x="22" y="18" width="7" height="12" rx="3.5" fill="currentColor"/>' +
              '<rect x="31" y="16" width="7" height="14" rx="3.5" fill="currentColor"/>' +
              '<rect x="40" y="18" width="7" height="12" rx="3.5" fill="currentColor"/>',
  // 骰子
  dice: () => '<rect x="18" y="18" width="28" height="28" rx="6" fill="none" stroke="currentColor" stroke-width="3"/>' +
              '<circle cx="26" cy="26" r="2.6" fill="currentColor"/><circle cx="38" cy="26" r="2.6" fill="currentColor"/>' +
              '<circle cx="32" cy="32" r="2.6" fill="currentColor"/>' +
              '<circle cx="26" cy="38" r="2.6" fill="currentColor"/><circle cx="38" cy="38" r="2.6" fill="currentColor"/>',
  // 旗帜
  flag: () => '<line x1="22" y1="14" x2="22" y2="50" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>' +
              '<path d="M22 16h20l-5 8 5 8H22z" fill="currentColor"/>',
  // 爆炸（两败俱伤）
  burst: () => {
    const pts = [];
    for (let i = 0; i < 12; i++) {
      const a = (Math.PI / 6) * i;
      const r = i % 2 === 0 ? 16 : 9;
      pts.push((32 + Math.cos(a) * r).toFixed(1) + ',' + (32 + Math.sin(a) * r).toFixed(1));
    }
    return '<polygon points="' + pts.join(' ') + '" fill="currentColor"/>';
  },
  // 印章（AI 批改）
  stamp: () => '<rect x="16" y="36" width="32" height="7" rx="2.5" fill="currentColor"/>' +
               '<path d="M26 36V28a6 6 0 0 1 12 0v8z" fill="currentColor"/>',
  // 机器人
  bot: () => '<rect x="18" y="22" width="28" height="20" rx="6" fill="none" stroke="currentColor" stroke-width="3"/>' +
             '<circle cx="26" cy="31" r="2.6" fill="currentColor"/><circle cx="38" cy="31" r="2.6" fill="currentColor"/>' +
             '<line x1="32" y1="14" x2="32" y2="22" stroke="currentColor" stroke-width="2.6"/>',
  // 眼睛（隐藏成就）
  eye: () => '<path d="M14 32s7-11 18-11 18 11 18 11-7 11-18 11-18-11-18-11z" fill="none" stroke="currentColor" stroke-width="3"/>' +
             '<circle cx="32" cy="32" r="5" fill="currentColor"/>',
  // 手（永不言弃）
  hand: () => '<path d="M24 44V26a3 3 0 0 1 6 0v-6a3 3 0 0 1 6 0v6a3 3 0 0 1 6 0v18z" fill="currentColor"/>',
  // 羽毛
  feather: () => '<path d="M20 46c0-14 10-24 24-26-2 14-12 24-24 26z" fill="currentColor"/>' +
                 '<line x1="20" y1="46" x2="34" y2="32" stroke="#fff" stroke-width="2" opacity="0.6"/>',
  // 齿轮
  gear: () => {
    const teeth = [];
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i;
      teeth.push('<rect x="29" y="14" width="6" height="8" rx="1.5" fill="currentColor" transform="rotate(' + (i * 45) + ' 32 32)"/>');
    }
    return '<circle cx="32" cy="32" r="9" fill="currentColor"/>' + teeth.join('');
  },
  // 显微镜（Surgical）
  micro: () => '<circle cx="32" cy="26" r="8" fill="none" stroke="currentColor" stroke-width="3"/>' +
               '<line x1="32" y1="34" x2="32" y2="44" stroke="currentColor" stroke-width="3"/>' +
               '<line x1="22" y1="46" x2="42" y2="46" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  // 钻石（Flawless）
  diamond: () => '<path d="M20 24h24l-12 24z" fill="currentColor"/>' +
                 '<path d="M20 24l4-8h16l4 8z" fill="currentColor" opacity="0.75"/>',
  // 望远镜（Meticulous）—— 用两个圆 + 柄
  scope: () => '<circle cx="24" cy="36" r="7" fill="none" stroke="currentColor" stroke-width="3"/>' +
               '<circle cx="43" cy="24" r="6" fill="none" stroke="currentColor" stroke-width="3"/>' +
               '<line x1="29" y1="32" x2="38" y2="27" stroke="currentColor" stroke-width="3"/>',
  // 调色板（Precise）
  palette: () => '<circle cx="32" cy="32" r="15" fill="none" stroke="currentColor" stroke-width="3"/>' +
                 '<circle cx="26" cy="27" r="2.6" fill="currentColor"/><circle cx="38" cy="27" r="2.6" fill="currentColor"/>' +
                 '<circle cx="26" cy="38" r="2.6" fill="currentColor"/>',
  // 仪表（Accurate / speed）
  gauge: () => '<path d="M16 40a16 16 0 0 1 32 0" fill="none" stroke="currentColor" stroke-width="3"/>' +
               '<line x1="32" y1="40" x2="42" y2="28" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  // 线条图（Sharp）
  chart: () => '<polyline points="16,42 24,32 32,36 40,22 48,26" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
               '<line x1="14" y1="46" x2="50" y2="46" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  // 简单柱状（Steady Hand）
  bars: () => '<rect x="18" y="34" width="6" height="12" rx="2" fill="currentColor"/>' +
              '<rect x="29" y="26" width="6" height="20" rx="2" fill="currentColor"/>' +
              '<rect x="40" y="30" width="6" height="16" rx="2" fill="currentColor"/>',
  // 靶心带箭（One Shot）
  shot: () => '<circle cx="32" cy="32" r="12" fill="none" stroke="currentColor" stroke-width="3"/>' +
              '<circle cx="32" cy="32" r="4" fill="currentColor"/>' +
              '<line x1="32" y1="32" x2="48" y2="16" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  // 层叠（difficulty hunter）
  layers: () => '<path d="M32 16l16 8-16 8-16-8z" fill="currentColor"/>' +
                '<path d="M16 32l16 8 16-8" fill="none" stroke="currentColor" stroke-width="2.6"/>' +
                '<path d="M16 40l16 8 16-8" fill="none" stroke="currentColor" stroke-width="2.6"/>',
  // 水滴（first blood）
  drop: () => '<path d="M32 14c8 10 12 15 12 21a12 12 0 0 1-24 0c0-6 4-11 12-21z" fill="currentColor"/>',
  // 幼苗
  sprout: () => '<path d="M32 48V28" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>' +
                '<path d="M32 30c0-8-6-12-14-12 0 8 6 12 14 12z" fill="currentColor"/>' +
                '<path d="M32 34c0-8 6-12 14-12 0 8-6 12-14 12z" fill="currentColor" opacity="0.75"/>',
  // 咖啡杯
  cup: () => '<path d="M18 24h24v14a8 8 0 0 1-8 8h-8a8 8 0 0 1-8-8z" fill="currentColor"/>' +
             '<path d="M42 27h4a5 5 0 0 1 0 10h-4" fill="none" stroke="currentColor" stroke-width="2.6"/>',
  // 奔跑的人
  run: () => '<circle cx="34" cy="18" r="4" fill="currentColor"/>' +
             '<path d="M26 48l6-12-6-6 10-6 8 6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  // 奖牌
  medal: () => '<circle cx="32" cy="36" r="10" fill="none" stroke="currentColor" stroke-width="3"/>' +
               '<path d="M24 16l6 12M40 16l-6 12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  // 地标
  landmark: () => '<path d="M32 14l18 10H14z" fill="currentColor"/>' +
                 '<rect x="18" y="26" width="4" height="16" fill="currentColor"/><rect x="30" y="26" width="4" height="16" fill="currentColor"/>' +
                 '<rect x="42" y="26" width="4" height="16" fill="currentColor"/>' +
                 '<rect x="14" y="44" width="36" height="4" rx="1.5" fill="currentColor"/>',
  // 山
  mountain: () => '<path d="M12 46l14-22 10 15 6-9 10 16z" fill="currentColor"/>',
  // 火箭
  rocket: () => '<path d="M32 12c8 6 12 16 12 26l-12 6-12-6c0-10 4-20 12-26z" fill="currentColor"/>' +
                '<circle cx="32" cy="26" r="4" fill="#fff" opacity="0.85"/>',
  // 流星
  meteor: () => '<circle cx="24" cy="40" r="9" fill="currentColor"/>' +
                '<path d="M32 32L50 14M34 40L50 24M26 32L42 16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity="0.65"/>',
  // 火（streak 小）
  wind: () => '<path d="M20 24h18a6 6 0 1 1-6 6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>' +
              '<path d="M20 34h14a5 5 0 1 1-5 5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  // 星火 / 闪光
  sparkle: () => '<path d="M32 14l4 12 12 4-12 4-4 12-4-12-12-4 12-4z" fill="currentColor"/>',
  // 手（butterfingers）
  handspark: () => '<path d="M24 44V28a3 3 0 0 1 6 0v-4a3 3 0 0 1 6 0v4a3 3 0 0 1 6 0v16z" fill="currentColor"/>' +
                   '<path d="M44 20l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="currentColor" opacity="0.8"/>',
  // 箭头回转
  rewind: () => '<path d="M18 34a14 14 0 1 1 5 11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>' +
                '<path d="M18 24v10h10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  // 飞鸟（早鸟）
  dove: () => '<path d="M14 34c8-2 12-8 18-8s10 6 18 8c-6 8-14 12-18 12s-12-4-18-12z" fill="currentColor"/>',
  // 羽毛笔
  quill: () => '<path d="M44 16L24 40l-4 8 8-4 20-24z" fill="currentColor"/>',
  // 手指标（clicked）
  pointer: () => '<path d="M30 16l14 20-7 1 5 10-6 3-5-10-6 6z" fill="currentColor"/>',
};

// 大号数字，用作 milestone / difficulty 的主视觉
function numeral(txt, size = 20) {
  return '<text x="32" y="39" text-anchor="middle" font-family="ui-sans-serif,system-ui,-apple-system,sans-serif" ' +
    'font-size="' + size + '" font-weight="800" fill="currentColor" letter-spacing="-0.5">' + txt + '</text>';
}

// ── 每个成就 → glyph + 等级 ──
function glyphFor(id, a) {
  const g = GLYPHS;
  // 里程碑
  const mMatch = /^solved-(\d+)$/.exec(id);
  if (mMatch) {
    const n = Number(mMatch[1]);
    return numeral(n >= 1000 ? (n / 1000) + 'k' : String(n), n >= 1000 ? 16 : 20);
  }
  if (id === 'first-blood') return g.drop();

  // 难度
  const hMatch = /^hard-(\d)$/.exec(id);
  if (hMatch) {
    const n = Number(hMatch[1]);
    // 山画在上半部，数字压在下半部，两者不打架
    return g.peak(n - 2) +
      '<text x="32" y="48" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" ' +
      'font-size="14" font-weight="800" fill="currentColor">Lv.' + n + '</text>';
  }
  if (id === 'difficulty-hunter') return g.layers();

  // 连续
  const sMatch = /^streak-(\d+)$/.exec(id);
  if (sMatch) {
    const n = Number(sMatch[1]);
    const lvl = n <= 3 ? 1 : n <= 7 ? 2 : n <= 30 ? 3 : 4;
    return g.flame(lvl);
  }

  // 效率
  if (id === 'first-try') return g.shot();
  if (id === 'first-try-10') return g.target();
  if (id === 'first-try-50') return g.sparkle();
  const dMatch = /^daily-(\d+)$/.exec(id);
  if (dMatch) return g.sun();

  // 趣味
  if (id === 'night-owl') return g.moon();
  if (id === 'early-bird') return g.dove();
  if (id === 'perfect-day') return g.sparkle();
  if (id === 'midnight-sharp') return g.clock();
  if (id === 'butterfingers') return g.handspark();
  if (id === 'rewind') return g.rewind();
  if (id === 'speed-demon') return g.gauge();
  if (id === 'never-give-up') return g.hand();

  // 准确率
  const aMatch = /^accuracy-(\d+)$/.exec(id);
  if (aMatch) return g.ring(Number(aMatch[1]) / 100);
  if (id === 'accuracy-30') return g.bars();
  if (id === 'accuracy-40') return g.chart();
  if (id === 'accuracy-50') return g.gauge();
  if (id === 'accuracy-60') return g.ring(0.6);
  if (id === 'accuracy-70') return g.gear();
  if (id === 'accuracy-80') return g.micro();
  if (id === 'accuracy-90') return g.diamond();

  // 社区
  if (id === 'preacher') return g.book();
  if (id === 'prolific') return g.quill();
  if (id === 'well-liked') return g.heart();
  if (id === 'patron') return g.heart();
  if (id === 'debater') return g.chat();
  if (id === 'curious-mind') return g.bulb();
  if (id === 'self-reliant') return g.shield();
  if (id === 'clicked') return g.pointer();

  // 习惯
  if (id === 'weekend-warrior') return g.calendar();
  if (id === 'lunch-break') return g.sun();
  if (id === 'last-light') return g.moon();
  if (id === 'comeback') return g.rewind();

  // AI 批改
  if (id === 'first-opinion') return g.stamp();
  if (id === 'trusted-grader') return g.bot();
  if (id === 'on-a-roll') return g.flame(4);

  // 消费
  if (id === 'investor') return g.sack();
  if (id === 'big-day') return g.bill();

  // PK
  if (id === 'pk-victor') return g.fist();
  if (id === 'pk-streak-5') return g.bolt();
  if (id === 'pk-all-in') return g.dice();
  if (id === 'pk-walkover') return g.flag();
  if (id === 'pk-mutual-loss') return g.burst();

  return g.star();
}

function buildSvg(id, a) {
  const col = RARITY_COLORS[a.rarity] || RARITY_COLORS.common;
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + SIZE + ' ' + SIZE + '" width="64" height="64" role="img" aria-label="' + a.name + '">' +
    '<defs>' +
      '<radialGradient id="bg" cx="32%" cy="24%" r="82%">' +
        '<stop offset="0%" stop-color="' + col.edge + '" stop-opacity="1"/>' +
        '<stop offset="55%" stop-color="' + col.deep + '" stop-opacity="0.95"/>' +
        '<stop offset="100%" stop-color="#0b1220" stop-opacity="0.98"/>' +
      '</radialGradient>' +
      '<filter id="sh" x="-30%" y="-30%" width="160%" height="160%">' +
        '<feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-color="#000" flood-opacity="0.45"/>' +
      '</filter>' +
    '</defs>' +
    frame(a.rarity) +
    '<g color="#ffffff" style="color:#ffffff" filter="url(#sh)">' + glyphFor(id, a) + '</g>' +
  '</svg>';
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const ids = Object.keys(ACHIEVEMENTS);
let n = 0;
const symbols = [];

for (const id of ids) {
  const a = ACHIEVEMENTS[id];
  const svg = buildSvg(id, a);
  fs.writeFileSync(path.join(OUT_DIR, id + '.svg'), svg, 'utf8');
  // sprite 里把 <svg> 换成 <symbol>，前端用 <use>
  const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  symbols.push('<symbol id="ach-' + id + '" viewBox="0 0 ' + SIZE + ' ' + SIZE + '">' + inner + '</symbol>');
  n++;
}

fs.writeFileSync(
  path.join(OUT_DIR, 'sprite.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">' + symbols.join('') + '</svg>',
  'utf8'
);
console.log('wrote ' + n + ' achievement SVGs + sprite.svg to assets/svg/achievements/');
