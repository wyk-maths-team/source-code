// assets/js/core/polling.js
//
// 前端轮询节奏的唯一来源。
//
// 为什么值得单独一个文件：这里的每个数字都会乘上在线人数，变成 Vercel 的函数调用量。
// 30 个人同时开着页面、每 60 秒轮询一次 = 每分钟 30 次回源；
// 把某个值从 60 秒改成 1.5 秒，同一个按钮就让月配额涨 40 倍。
// 这类数字散落在各个页面里时，没人会去算这笔账；集中到一个具名常量上，
// 改动前至少得先看一眼前面的注释。
//
// 用法：
//   var P = window.__POLL__ || {};
//   setInterval(poll, P.homeRecentAc || 60_000);
//
// 页面可以在加载本文件之前设置 window.__POLL__ 来覆盖（心跳那边原本就有
// window.__HB_CONFIG__ 的机制，这里保持一致的思路）。

(function () {
  'use strict';

  var DEFAULTS = {
    // 首页「最近 AC」列表 + 累计 token
    homeRecentAc: 60_000,
    // 多久没有交互就停刷（切标签页、人离开）
    homeIdle: 60_000,

    // 在线心跳：告诉服务端「我还在这儿」
    heartbeat: 180_000,
    // 多久内有交互才算活跃（低于心跳间隔会给每次 tick 都发）
    heartbeatActivity: 180_000,

    // PK 邀请红点
    pkInvite: 180_000,
    // PK 通知角标
    pkNotify: 20_000,
    // PK 房间内：对手在动 vs 静止，两种节奏
    pkRoomMoving: 5_000,
    pkRoomStill: 15_000,
    // 多久没操作就把 PK 房间轮询休眠
    pkRoomIdle: 120_000,
  };

  window.__POLL__ = Object.assign({}, DEFAULTS, window.__POLL__ || {});

  // ── 硬下限 ──
  // 任何人想往轮询里塞一个 1.5 秒的间隔，都会先在控制台看到这条警告。
  // 3 秒是「毫秒级体验」和「别把配额烧光」之间的分界线：
  // 低于这个值的轮询，用户感知不到差别，账单却能差一个数量级。
  var MIN_INTERVAL_MS = 3_000;
  Object.keys(window.__POLL__).forEach(function (key) {
    var v = Number(window.__POLL__[key]);
    if (!Number.isFinite(v) || v <= 0) {
      window.__POLL__[key] = DEFAULTS[key];
      return;
    }
    if (v < MIN_INTERVAL_MS && /Ms$|Idle$|RecentAc$|heartbeat$|Notify$|Invite$|Moving$|Still$/.test(key)) {
      console.warn('[poll] ' + key + '=' + v + 'ms 低于下限，已提升到 ' + MIN_INTERVAL_MS + 'ms');
      window.__POLL__[key] = MIN_INTERVAL_MS;
    }
  });
})();
