// lib/ai-fallback.js
//
// AI 批改失败后的统一处理。
//
// 以前的做法：API 失败就把 task 留在 pending，让本地 grader（bridge）捡走。
// 那条链路现在不用了 —— 失败就再打一次 API，还失败就明确告诉用户稍后再来。
//
// 两个必须守住的点：
//   1. 绝不能把 task 留在 pending。bridge 只扫 status: 'pending'，
//      留一个 pending 等于把已经放弃的任务重新丢进队列。
//   2. 放弃必须发生在平台 300 秒上限之前。超时被掐断时函数来不及写状态，
//      task 会永远停在 pending —— 所以下面的时间预算比"多试几次"更重要。

export const GIVE_UP_MESSAGE =
  'The grader is not responding right now. Your answer is saved — please try again in a few minutes.';

export const AUTH_FAIL_MESSAGE =
  'Grading is unavailable right now (the AI service rejected our credentials). Please try again later.';

/** 一次批改最多占用多少时间；给写库、扣费、响应留 60 秒余量 */
export const DEADLINE_MS = 240_000;
/** 剩余时间低于这个值就不再开新的模型调用 */
export const MIN_ATTEMPT_MS = 15_000;
/** 两轮尝试之间歇一下，别把上游当靶子打 */
export const RETRY_DELAY_MS = 1_200;

export function remainingMs(startedAt) {
  return DEADLINE_MS - (Date.now() - startedAt);
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * 把任务标成失败，让 bridge 扫不到。
 * 记录失败本身不该掩盖原始错误，所以内部全部吞掉异常。
 */
export async function markTaskFailed(db, taskId, errors, extra = {}) {
  const text = (Array.isArray(errors) ? errors.join('; ') : String(errors || '')).slice(0, 500);
  try {
    await db.collection('steps_grading_tasks').updateOne(
      { taskId },
      {
        $set: {
          status: 'error',
          error: text || 'AI unavailable',
          completedAt: new Date(),
          ...extra,
        },
        // 清掉旧 bridge 协议留下的锁定字段，别让任何残留逻辑以为还要接手
        $unset: { apiLockedAt: '' },
      }
    );
  } catch (e) {
    console.error('[ai-fallback] failed to record task failure:', e && e.message);
  }
  return text;
}
