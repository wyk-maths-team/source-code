// lib/logic-runner.js
import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten';

// ⭐ 單例：整個 process 只載入一次 WASM
let _qjsPromise = null;
function getQJS() {
  if (!_qjsPromise) _qjsPromise = getQuickJS();
  return _qjsPromise;
}

const EXEC_TIMEOUT_MS = 1500;
const MEM_LIMIT_BYTES = 16 * 1024 * 1024;   // 16 MB
const MAX_COMMENT_LEN = 1000;

/**
 * 在隔離的 QuickJS WASM VM 裡執行題目的 logic。
 * @param {string} logicStr  例如 `(ans, uans) => ({ score: 100, comment: '' })`
 * @param {*} ans            正確答案
 * @param {*} userAnswer     用戶答案
 * @returns {Promise<{score:number, comment:string, systemError:boolean}>}
 */
export async function runCustomLogic(logicStr, ans, userAnswer) {
  let vm = null;
  try {
    const QuickJS = await getQJS();
    vm = QuickJS.newContext();

    vm.runtime.setMemoryLimit(MEM_LIMIT_BYTES);
    vm.runtime.setMaxStackSize(512 * 1024);
    vm.runtime.setInterruptHandler(
      shouldInterruptAfterDeadline(Date.now() + EXEC_TIMEOUT_MS)
    );

    const ansJson  = JSON.stringify(ans);
    const userJson = JSON.stringify(userAnswer);
    const code = `"use strict";(${logicStr})(${ansJson},${userJson});`;

    let evalResult;
    try {
      evalResult = vm.evalCode(code);
    } catch (e) {
      if (e && /interrupted/i.test(e.message || '')) {
        return { score: 0, comment: 'Logic timeout', systemError: true };
      }
      throw e;
    }

    // 執行失敗（拋錯）
    if (evalResult.error) {
      const errVal = vm.dump(evalResult.error);
      evalResult.error.dispose();
      const msg = (errVal && errVal.message) ? String(errVal.message) : 'Unknown error';
      return { score: 0, comment: 'Logic error: ' + msg, systemError: true };
    }

    const value = vm.dump(evalResult.value);
    evalResult.value.dispose();

    // 與原邏輯相同的回傳驗證
    if (typeof value === 'number') {
      return {
        score: Math.min(100, Math.max(0, value)),
        comment: '',
        systemError: false,
      };
    }
    if (value && typeof value === 'object' && typeof value.score === 'number') {
      return {
        score: Math.min(100, Math.max(0, value.score)),
        comment: String(value.comment || '').slice(0, MAX_COMMENT_LEN),
        systemError: false,
      };
    }
    return { score: 0, comment: 'Invalid logic return value', systemError: true };
  } catch (err) {
    return { score: 0, comment: 'Logic error: ' + (err.message || 'unknown'), systemError: true };
  } finally {
    try { if (vm) vm.dispose(); } catch {}
  }
}