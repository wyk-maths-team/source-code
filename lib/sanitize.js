// lib/sanitize.js
function decodeHTMLEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export function sanitizeHTML(dirty) {
  if (typeof dirty !== 'string') return '';
  let cleaned = decodeHTMLEntities(dirty);
  cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '');
  cleaned = cleaned.replace(/href\s*=\s*["']\s*javascript:[^"']*/gi, 'href="#"');
  return cleaned;
}