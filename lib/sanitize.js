// lib/sanitize.js
// 不依賴任何外部套件，純 JS 白名單式 sanitizer

// ═══════════════ 白名單 ═══════════════
const ALLOWED_TAGS_GENERAL = new Set([
  // 文字結構
  'p','br','hr','div','span',
  'b','i','u','s','strong','em','sub','sup','mark','small',
  'h1','h2','h3','h4','h5','h6',
  'ul','ol','li','blockquote','pre','code',
  'table','thead','tbody','tfoot','tr','th','td','caption',
  'figure','figcaption',
  // 連結 & 圖片
  'a','img',
  // KaTeX / MathML
  'math','semantics','annotation','mrow','mi','mo','mn',
  'msup','msub','mfrac','msqrt','mroot','mover','munder',
  'mtable','mtr','mtd','mtext','mspace','mpadded','mphantom',
  'menclose','mstyle',
]);

const ALLOWED_TAGS_DISCUSSION = new Set([
  'p','br','b','i','u','strong','em','sub','sup',
  'ul','ol','li','blockquote','code','pre',
  'a','img',
  'math','semantics','annotation','mrow','mi','mo','mn',
  'msup','msub','mfrac','msqrt','mroot','mover','munder',
  'mtable','mtr','mtd','mtext','mspace',
]);

// 每個標籤允許的屬性（'*' 代表所有標籤共通）
const ALLOWED_ATTRS_GENERAL = {
  '*': ['class','id','title','role','style','aria-*','data-*'],
  a: ['href','target','rel'],
  img: ['src','alt','width','height','loading'],
  td: ['colspan','rowspan','align'],
  th: ['colspan','rowspan','align'],
  math: ['xmlns','display'],
  annotation: ['encoding'],
};

const ALLOWED_ATTRS_DISCUSSION = {
  a: ['href','target','rel'],
  img: ['src','alt','loading'],
  annotation: ['encoding'],
};

// URL scheme 白名單
const SAFE_SCHEMES = ['http:', 'https:', 'mailto:'];
// 圖片可用的額外 scheme
const IMG_EXTRA_SCHEMES = ['data:'];

// ═══════════════ 工具 ═══════════════
function isAttrAllowed(tag, attr, attrAllowList) {
  const list = attrAllowList['*'] || [];
  const tagList = attrAllowList[tag] || [];
  const combined = [...list, ...tagList];
  for (const pattern of combined) {
    if (pattern === attr) return true;
    if (pattern.endsWith('*')) {
      if (attr.startsWith(pattern.slice(0, -1))) return true;
    }
  }
  return false;
}

function isSchemeSafe(url, allowedSchemes) {
  if (!url) return false;
  const trimmed = String(url).trim();
  // 相對路徑 / 錨點 → 允許
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return true;
  // 檢查 scheme
  const m = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!m) return true;   // 沒有 scheme，當相對路徑
  const scheme = (m[1] + ':').toLowerCase();
  return allowedSchemes.includes(scheme);
}

function escapeAttrValue(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 簡易 HTML tokenizer + 白名單過濾
 * 不做完整的 DOM 樹重建，但足以擋住常見 XSS
 */
function sanitizeCore(dirty, { allowedTags, allowedAttrs, isDiscussion }) {
  if (typeof dirty !== 'string') return '';

  let out = '';
  let i = 0;
  const len = dirty.length;

  while (i < len) {
    const lt = dirty.indexOf('<', i);
    if (lt === -1) {
      out += dirty.slice(i);
      break;
    }
    // 前面的文字
    out += dirty.slice(i, lt);

    // 處理 <
    const rest = dirty.slice(lt);

    // 註解 <!-- ... -->
    if (rest.startsWith('<!--')) {
      const end = rest.indexOf('-->');
      if (end === -1) { out += '&lt;'; i = lt + 1; continue; }
      i = lt + end + 3;
      continue;
    }

    // DOCTYPE / CDATA / Processing instruction → 丢掉
    if (/^<[!?]/.test(rest)) {
      const end = rest.indexOf('>');
      if (end === -1) { out += '&lt;'; i = lt + 1; continue; }
      i = lt + end + 1;
      continue;
    }

    // 尋找 tag 結尾
    const gt = rest.indexOf('>');
    if (gt === -1) { out += '&lt;'; i = lt + 1; continue; }

    const fullTag = rest.slice(0, gt + 1);   // "<tag ...>"
    const isClose = /^<\//.test(fullTag);
    const selfClose = /\/>$/.test(fullTag);

    // 解析 tag 名
    const m = fullTag.match(/^<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/);
    if (!m) { out += '&lt;'; i = lt + 1; continue; }
    const tag = m[1].toLowerCase();

    // 不在白名單 → 丢掉整個 tag
    if (!allowedTags.has(tag)) {
      i = lt + gt + 1;
      continue;
    }

    if (isClose) {
      // 不允許 script/style/iframe（其實上面已經擋了）
      out += `</${tag}>`;
      i = lt + gt + 1;
      continue;
    }

    // 解析屬性（簡易版）
    const attrStr = fullTag.slice(m[0].length, gt - (selfClose ? 1 : 0));
    const attrs = [];
    const attrRe = /([a-zA-Z_:][a-zA-Z0-9:._-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let am;
    while ((am = attrRe.exec(attrStr)) !== null) {
      const attrName = am[1].toLowerCase();
      const attrVal = am[2] != null ? am[2] : (am[3] != null ? am[3] : (am[4] != null ? am[4] : ''));

      // 移除 on* 事件屬性
      if (/^on/i.test(attrName)) continue;

      // 白名單檢查
      if (!isAttrAllowed(tag, attrName, allowedAttrs)) continue;

      // 檢查 URL 屬性
      if (attrName === 'href' || attrName === 'src') {
        const schemes = tag === 'img' ? [...SAFE_SCHEMES, ...IMG_EXTRA_SCHEMES] : SAFE_SCHEMES;
        if (!isSchemeSafe(attrVal, schemes)) continue;
      }

      // style 屬性：討論區直接略過；一般版做最簡過濾
      if (attrName === 'style') {
        if (isDiscussion) continue;
        // 只保留無害屬性
        const safeStyle = String(attrVal)
          .split(';')
          .map(s => s.trim())
          .filter(s => /^(color|background-color|text-align|font-weight|font-style|text-decoration)\s*:/i.test(s))
          .filter(s => !/expression|javascript:|url\s*\(/i.test(s))
          .join('; ');
        if (!safeStyle) continue;
        attrs.push(`style="${escapeAttrValue(safeStyle)}"`);
        continue;
      }

      attrs.push(`${attrName}="${escapeAttrValue(attrVal)}"`);
    }

    // a 標籤強制加 rel/target
    if (tag === 'a') {
      const hasRel = attrs.some(a => a.startsWith('rel='));
      const hasTarget = attrs.some(a => a.startsWith('target='));
      if (!hasRel) attrs.push('rel="noopener noreferrer"');
      if (!hasTarget) attrs.push('target="_blank"');
    }

    const attrFinal = attrs.length ? ' ' + attrs.join(' ') : '';
    out += `<${tag}${attrFinal}${selfClose ? ' /' : ''}>`;
    i = lt + gt + 1;
  }

  return out;
}

// ═══════════════ 對外 API ═══════════════
export function sanitizeHTML(dirty) {
  return sanitizeCore(dirty, {
    allowedTags: ALLOWED_TAGS_GENERAL,
    allowedAttrs: ALLOWED_ATTRS_GENERAL,
    isDiscussion: false,
  });
}

export function sanitizeDiscussion(dirty) {
  return sanitizeCore(dirty, {
    allowedTags: ALLOWED_TAGS_DISCUSSION,
    allowedAttrs: ALLOWED_ATTRS_DISCUSSION,
    isDiscussion: true,
  });
}