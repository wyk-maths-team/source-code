// lib/port-grade-prompt.js
export function buildPortGradePrompt({ statement, referenceAnswer, studentSteps, maxScore, subject }) {
  // 中文科目采用繁体中文批改（DSE 标准）
  const isChinese = ['chin', 'maths', 'phy', 'chem', 'bio'].includes(subject);
  const language = isChinese ? '繁體中文' : 'English';
  
  return `
你是一位资深的香港中学文凭考试 (DSE) 阅卷员。
请严格按照 Marking Scheme (评分标准) 的级别批改以下学生的答案。
语言要求：你的评语必须使用 ${language}。

【题目】：
${statement}

【参考答案 / 评分标准】：
${referenceAnswer}
(本题满分：${maxScore ?? '未设定'})

【学生作答】：
${studentSteps}

批改要求：
1. 逐步给分：即使最终答案错误，只要中间步骤正确，必须给出步骤分（Step marks）。
2. 警告机制：如果提供的【参考答案/评分标准】存在歧义、缺少分值，或者本题设定的满分 (${maxScore}) 与参考答案中的分值不匹配，必须在 JSON 的 warnings 字段中指出。
3. 输出格式：只返回纯 JSON，不要包裹 \`\`\`json 等代码块。
格式如下：
{
  "score": <最终得分数字>,
  "comment": "<详细的评语，使用 Markdown 格式，需明确指出得分点、失分点及错因>",
  "warnings": ["<警告信息，如果没有请留空数组>"]
}
`;
}