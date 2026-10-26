// lib/name-filter.js
// 顯示名 / 自訂名稱的敏感詞過濾

// ═══════════════ 基礎敏感詞清單 ═══════════════
// 注意：這不是完整清單，是基礎防禦
// 政治/宗教/地區詞請放 POLICY_BANNED_WORDS，由外部政策決定

const BASE_BANNED_WORDS = [
  // 英文髒話 / 侮辱
  'fuck', 'fuk', 'fuxk', 'fuq', 'fvck', 'fck',
  'motherfucker', 'motherfuck',
  'shit', 'sht',
  'bitch', 'btch',
  'asshole', 'arsehole',
  'dick', 'd1ck', 'dickhead',
  'cock', 'c0ck',
  'pussy', 'puss1',
  'cunt', 'c0nt',
  'whore', 'wh0re',
  'slut', '5lut',
  'bastard',
  'damn','gay','lesbian','bisexual',

  // 仇恨 / 歧視侮辱（不是身份詞）
  'nigger', 'nigga', 'n1gger', 'n1gga',
  'faggot', 'fag', 'dyke', 'tranny',
  'retard', 'retarded',
  'chink', 'gook', 'kike', 'spic', 'wetback',

  // 中文髒話 / 侮辱
  '操你', '草你', '操妳', '操你妈', '操你媽', '草泥马', '草泥馬',
  '幹你', '干你', '幹妳', '干妳', '幹你娘', '干你娘', '幹你老母', '干你老母',
  '屌你', '吊你', '屌你老母', '吊你老母', 'diu你', 'diu你老母',
  '扑街', '撲街', '冚家铲', '冚家鏟',
  '傻逼', '傻B', '傻b', '沙比', '沙雕', '傻雕', '煞笔', '煞筆',
  '腦殘', '脑残', '智障', '白痴', '白癡', '低能', '弱智',
  '廢物', '废物', '垃圾',
  '死全家', '全家死', '媽的', '妈的', '他媽', '他妈', '牠媽',
  '去死', '你死', '滾蛋', '滚蛋',
  '賤人', '贱人', '婊子', '雜種', '杂种', '畜生', '狗娘養', '狗娘养',
  '性无能', '性無能', '娘炮', '死娘炮',

  // 拼音 / 縮寫
  'caonima', 'caonm', 'ganni', 'gannima',
  'nmsl', 'cnm', 'tmd', 'nmd', 'sb',

  // 色情 / NSFW
  'porn', 'porno', 'xxx', 'nude', 'nudes', 'onlyfans', 'sexcam', 'camgirl',
  'futanari',
  '约炮', '約炮', '一夜情', '援交', '賣淫', '卖淫', '嫖娼',
  '性服务', '性服務', '裸聊', '色情',

  // 暴力 / 自傷
  '杀你', '殺你', '砍你', '炸死', '血洗', '屠殺', '屠杀', '自殺', '自杀',
  'kys', 'kill yourself', 'kill myself',

  // 廣告 / 導流
  '加微信', '加賴', '加line', '加qq', '掃碼', '扫码', '點擊鏈接', '点击链接',
];

// ═══════════════ 政治 / 宗教 / 地區敏感詞 ═══════════════
// 不在此硬編碼。請由學校法務/政策單位以外部設定檔提供，例如：
//
// import { POLICY_BANNED_WORDS } from './policy-words.js';
//
// 或從後端設定、環境變數、資料庫載入。
const POLICY_BANNED_WORDS = ['']; 

const BANNED_WORDS = [...BASE_BANNED_WORDS, ...POLICY_BANNED_WORDS];

// 保留名稱：避免冒充官方
const RESERVED_NAMES = [
  'admin', 'administrator', 'moderator', 'mod', 'owner',
  'system', 'official', 'staff',
  '管理員', '管理员', '版主', '系統', '系统', '官方', '客服',
  '校長', '校长', '老師', '老师', '警察', '政府',
];

// ═══════════════ 歸一化 ═══════════════
function normalize(str) {
  if (!str) return { compact: '', collapsed: '', tokens: [] };

  let s = String(str).normalize('NFKC').toLowerCase();

  // 移除控制字元、零寬字元、方向控制
  s = s.replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');

  // leet / 混淆字元（必須在移除標點前做）
  s = s
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b')
    .replace(/9/g, 'g')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's');

  // 非字母、數字、中文 → 空白；保留 token 給英文短詞精確比對
  const spaced = s.replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, ' ').trim();
  const compact = spaced.replace(/\s+/g, '');
  const collapsed = compact.replace(/(.)\1+/g, '$1');
  const tokens = spaced.split(/\s+/).filter(Boolean);

  return { compact, collapsed, tokens };
}

function normalizeForWord(str) {
  return normalize(str).compact;
}

function isAsciiWord(str) {
  return /^[a-z]+$/.test(str);
}

function containsBannedWord(normalized) {
  for (const word of BANNED_WORDS) {
    const nw = normalizeForWord(word);
    if (!nw) continue;

    // 英文短詞用 token 精確比對，避免 ass 誤傷 class/pass/bass
    if (isAsciiWord(nw) && nw.length <= 3) {
      if (normalized.tokens.includes(nw)) return word;
      continue;
    }

    if (normalized.compact.includes(nw)) return word;

    // 處理重複字元繞過：fuuuuck -> fuck
    if (nw.length >= 4 && normalized.collapsed.includes(nw)) return word;
  }
  return null;
}

// ═══════════════ 主檢查函式 ═══════════════
/**
 * @param {string} name - 要檢查的名稱
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function checkDisplayName(name) {
  if (!name || typeof name !== 'string') {
    return { ok: false, reason: 'Name cannot be null' };
  }

  const trimmed = name.trim();
  const charLength = [...trimmed].length;

  // 長度檢查
  if (charLength === 0) {
    return { ok: false, reason: 'Name cannot be null' };
  }
  if (charLength > 50) {
    return { ok: false, reason: 'Your name is too long (max=50)' };
  }

  // 不可見 / 控制字元
  if (/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/.test(trimmed)) {
    return { ok: false, reason: 'Name contains invalid characters' };
  }

  // URL / 連結
  if (/(https?:\/\/|www\.|[a-z0-9-]+\.(com|net|org|hk|tw|cn|io|me|gg|app|dev|edu|gov)(\/|\b))/i.test(trimmed)) {
    return { ok: false, reason: 'Links should not be included' };
  }

  // Email
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(trimmed)) {
    return { ok: false, reason: 'Email addresses should not be included' };
  }

  // 敏感詞檢查（正規化後）
  const normalized = normalize(trimmed);
  const banned = containsBannedWord(normalized);
  if (banned) {
    return { ok: false, reason: 'Name contains inappropriate words' };
  }

  // 保留名稱
  const lower = trimmed.toLowerCase();
  if (RESERVED_NAMES.some(r => lower === r.toLowerCase())) {
    return { ok: false, reason: 'This name is reserved' };
  }

  return { ok: true };
}

// ═══════════════ 給前端用的（同步版本，快速反饋） ═══════════════
// ⚠️ 前端不應信任，後端一定要再檢查
export function quickCheckDisplayName(name) {
  return checkDisplayName(name);
}

export const BANNED_WORDS_LIST = BANNED_WORDS;
export const RESERVED_NAMES_LIST = RESERVED_NAMES;