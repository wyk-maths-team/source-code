// assets/js/core/api.js
//
// 统一的 API 请求封装（新代码请用这个，不要再裸写 fetch）。
//
//   const data = await API.get('/api/problem?id=HA0001');
//   const res  = await API.post('/api/submit', { problemId, answer });
//
// 失败时抛 API.ApiError，字段：status / code / message / detail / requestId / url
// 5xx 的提示由 core/net.js 自动弹出，这里不重复弹。
//
// 注意：旧的 window.apiCall() 仍然保留（auth.js 里），不要混用。

(function () {
  'use strict';
  if (window.API) return;

  function getToken() {
    try {
      if (typeof window.getToken === 'function') return window.getToken();
      return localStorage.getItem('auth_token') || '';
    } catch (e) { return ''; }
  }

  function ApiError(info) {
    this.name = 'ApiError';
    this.status = info.status;
    this.code = info.code || ('HTTP_' + info.status);
    this.message = info.message || '请求失败';
    this.detail = info.detail || '';
    this.requestId = info.requestId || '';
    this.url = info.url || '';
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;
  ApiError.prototype.toString = function () {
    return this.code + ' (HTTP ' + this.status + '): ' + this.message;
  };

  function buildError(res, body, url) {
    return new ApiError({
      status: res.status,
      code: body && body.code,
      message: (body && (body.message || body.error)) || ('请求失败 (HTTP ' + res.status + ')'),
      detail: (body && body.detail) || '',
      requestId: (body && body.requestId) || '',
      url: url.split('?')[0]
    });
  }

  async function call(path, opts) {
    opts = opts || {};
    var headers = Object.assign({}, opts.headers || {});
    var token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;

    var init = {
      method: opts.method || 'GET',
      headers: headers,
      credentials: opts.credentials || 'same-origin'
    };

    if (opts.body !== undefined && opts.body !== null) {
      if (opts.raw) {
        init.body = opts.body;
      } else {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
        init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      }
    }

    var res;
    try {
      res = await fetch(path, init);
    } catch (e) {
      throw new ApiError({
        status: 'NETWORK',
        code: 'NETWORK',
        message: '网络请求失败',
        detail: String(e && e.message || e),
        url: path
      });
    }

    var text = '';
    try { text = await res.text(); } catch (e) { /* ignore */ }
    var body = null;
    if (text) { try { body = JSON.parse(text); } catch (e) { body = null; } }

    if (!res.ok) throw buildError(res, body, path);
    if (body === null) {
      // 非 JSON 响应（少见），返回原文本，交给调用方判断
      return text;
    }
    return body;
  }

  window.API = {
    ApiError: ApiError,
    call: call,
    get: function (p, o) { return call(p, Object.assign({ method: 'GET' }, o || {})); },
    post: function (p, body, o) { return call(p, Object.assign({ method: 'POST', body: body }, o || {})); },
    put: function (p, body, o) { return call(p, Object.assign({ method: 'PUT', body: body }, o || {})); },
    del: function (p, o) { return call(p, Object.assign({ method: 'DELETE' }, o || {})); },
    token: getToken
  };
})();
