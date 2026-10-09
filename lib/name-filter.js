// lib/name-filter.js
// 顯示名 / 自訂名稱的敏感詞過濾

// ═══════════════ 敏感詞清單 ═══════════════
// 注意：這不是完整清單，是基礎防禦
// 建議定期補充（學生會發明新的）

const BANNED_WORDS = [
  // 英文髒話（基礎）
  'fuck', 'fck', 'fuk', 'fuxk', 'fuq', 'fvck',
  'shit', 'sh1t', 'sht',
  'bitch', 'b1tch', 'btch',
  'ass', 'arse', 'a55',
  'damn', 'dick', 'd1ck',
  'cock', 'c0ck', 'cok',
  'pussy', 'pu55y', 'puss1',
  'nigger', 'n1gger', 'nigg3r',
  'nigga', 'n1gga',
  'whore', 'wh0re', 'h0r',
  'slut', '5lut',
  'cunt', 'c0nt',

  // 中文髒話（基礎）
  '操你', '草你', '操妳',
  '幹你', '干你', '幹妳',
  '屌你', '吊你',
  '傻逼', '傻B', '傻b', '沙比', '沙雕', '傻雕',
  '腦殘', '脑残', '智障', '白痴', '白癡',
  '廢物', '废物', '垃圾',   // 視情況
  '死全家', '全家死',
  '媽的', '妈的', '马的',
  '他媽', '他妈', '牠媽',
  '去死', '你死', '滾蛋',
  '賤人', '贱人', '婊子',
  '雜種', '杂种', '畜生',

  // 敏感政治 / 宗教（自行斟酌）
  // '共匪', '台獨', ...  ← 依學校政策加

  

];

// ═══════════════ 歸一化 ═══════════════
function normalize(str) {
  if (!str) return '';
  let s = String(str);

  // 全形 → 半形
  s = s.replace(/[\uFF01-\uFF5E]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  );

  // 大小寫
  s = s.toLowerCase();

  // 移除所有非字母數字中文字元（空白、標點、符號）
  s = s.replace(/[\s\-_.*~!@#$%^&()+=\[\]{};:'",<>?/\\|`]/g, '');

  // 常見混淆字元
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

  return s;
}

// ═══════════════ 主檢查函式 ═══════════════
/**
 * @param {string} name - 要檢查的名稱
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function checkDisplayName(name) {
  if (!name || typeof name !== 'string') {
    return { ok: false, reason: 'Name connot be null' };
  }

  const trimmed = name.trim();

  // 長度檢查
  if (trimmed.length === 0) {
    return { ok: false, reason: 'Name cannot be null' };
  }
  if (trimmed.length > 50) {
    return { ok: false, reason: 'Your name is too long (max=50)' };
  }





  // URL / 連結
  if (/(https?:\/\/|www\.|\.com|\.hk|\.net|\.org)/i.test(trimmed)) {
    return { ok: false, reason: 'Links should be not included' };
  }

  // 敏感詞檢查（正規化後）
  const normalized = normalize(trimmed);
  for (const word of BANNED_WORDS) {
    const normalizedWord = normalize(word);
    if (normalizedWord && normalized.includes(normalizedWord)) {
      return { ok: false, reason: 'Name should not contain inapproate words' };
    }
  }

  // 全部大寫的英文（可能是想突顯，也可能是冒充）
  if (/^[A-Z\s]{4,}$/.test(trimmed) && trimmed.length >= 4) {
    // 不強制擋，只是警示（可選）
    // return { ok: false, reason: '名稱不能全為大寫' };
  }

  return { ok: true };
}

// ═══════════════ 給前端用的（同步版本，快速反饋） ═══════════════
// ⚠️ 前端不應信任，後端一定要再檢查
export function quickCheckDisplayName(name) {
  return checkDisplayName(name);
}

export const BANNED_WORDS_LIST = BANNED_WORDS;   // 供其他模組用