// lib/bankFilter.js —— 哪些题不进「主题库」（题库列表 / 搜索 / 统计）
//
// DSE 卷子是按整份卷子组织的，单独的题出现在题库列表里没有意义，
// 而且会和常规练习题混在一起。这里统一给查询加一条排除条件。
//
// ⚠️ 注意范围：以 M0 / M1 / M2 开头的题都会被排除，包括
//    M0-IN01（复合不等式）、M2-D1（微分）这类常规练习题。
//    如果只想排卷子，把正则改成 /^M[012]DSE/ 即可。

const PREFIX_RE = /^M[012]/;

/** 生成「题库里不显示」的查询片段 */
export function excludeFromBank() {
  return { id: { $not: PREFIX_RE } };
}

/** 判断单道题是否应该出现在题库里 */
export function isVisibleInBank(id) {
  return !PREFIX_RE.test(String(id || ''));
}
