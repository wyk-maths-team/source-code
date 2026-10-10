// lib/sanitize.js
import sanitizeHtml from 'sanitize-html';

// ═══════════════ 共用設定 ═══════════════

// 允許的標籤（通用）
const ALLOWED_TAGS = [
  // 文字結構
  'p', 'br', 'hr', 'div', 'span',
  'b', 'i', 'u', 's', 'strong', 'em', 'sub', 'sup', 'mark', 'small',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'figure', 'figcaption',
  // 連結 & 圖片
  'a', 'img',
  // 數學（KaTeX）
  'math', 'semantics', 'annotation', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub',
  'mfrac', 'msqrt', 'mroot', 'mover', 'munder', 'mtable', 'mtr', 'mtd',
  'mtext', 'mspace', 'mpadded', 'mphantom', 'menclose', 'mstyle',
];

// 允許的屬性
const ALLOWED_ATTRS = {
  '*': ['class', 'style', 'id', 'title', 'aria-*', 'data-*', 'role'],
  a: ['href', 'target', 'rel'],
  img: ['src', 'alt', 'width', 'height', 'loading'],
  td: ['colspan', 'rowspan', 'align'],
  th: ['colspan', 'rowspan', 'align'],
  math: ['xmlns', 'display'],
  // KaTeX 相關
  annotation: ['encoding'],
};

// 允許的 URL scheme
const ALLOWED_SCHEMES = ['http', 'https', 'mailto', 'data'];

// ═══════════════ 通用 sanitize ═══════════════
export function sanitizeHTML(dirty) {
  if (typeof dirty !== 'string') return '';
  return sanitizeHtml(dirty, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRS,
    allowedSchemes: ALLOWED_SCHEMES,
    // data: 只允許圖片（避免 data:text/html 攻擊）
    allowedSchemesByTag: {
      img: ['data', 'http', 'https'],
    },
    // 強制 rel=noopener（防止 reverse tabnabbing）
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        rel: 'noopener noreferrer',
        target: '_blank',
      }),
    },
    // 不允許註解（可能藏 payload）
    allowedIframeHostnames: [],
    // 移除空的屬性
    exclusiveFilter(frame) {
      return frame.tag === 'iframe';   // 完全不允許 iframe
    },
    // 保留 style 屬性但只允許安全屬性
    allowedStyles: {
      '*': {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgb/],
        'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgb/],
        'text-align': [/^left$|^right$|^center$|^justify$/],
        'font-weight': [/^bold$|^normal$|^\d+$/],
        'font-style': [/^italic$|^normal$/],
        'text-decoration': [/^underline$|^line-through$|^none$/],
      },
    },
  });
}

// ═══════════════ 討論區專用（更嚴格） ═══════════════
// 學生寫的內容，不允許 style、不接受複雜標籤
export function sanitizeDiscussion(dirty) {
  if (typeof dirty !== 'string') return '';
  return sanitizeHtml(dirty, {
    allowedTags: [
      'p', 'br', 'b', 'i', 'u', 'strong', 'em', 'sub', 'sup',
      'ul', 'ol', 'li', 'blockquote', 'code', 'pre',
      'a', 'img',
      // KaTeX 產出的標籤
      'math', 'semantics', 'annotation', 'mrow', 'mi', 'mo', 'mn',
      'msup', 'msub', 'mfrac', 'msqrt', 'mroot', 'mover', 'munder',
      'mtable', 'mtr', 'mtd', 'mtext', 'mspace',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'loading'],
      annotation: ['encoding'],
    },
    allowedSchemes: ['http', 'https', 'data'],
    allowedSchemesByTag: {
      img: ['data', 'http', 'https'],
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        rel: 'noopener noreferrer',
        target: '_blank',
      }),
    },
    // 完全禁止 style 屬性
    allowedStyles: {},
  });
}