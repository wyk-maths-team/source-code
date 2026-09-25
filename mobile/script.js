/* ============================================================
 * WYK Maths Team — Mobile App
 * 單文件：全部 CSS + HTML 生成 + 路由 + 預取 + 頁面渲染
 * ============================================================ */
(function () {
'use strict';

// ═══════════════════════════════════════════════════════════
// 1. CSS 注入
// ═══════════════════════════════════════════════════════════
const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
:root{
  --accent:#4a90d9;--accent-hover:#3a7bc8;--accent-soft:rgba(74,144,217,.14);
  --bg:#0d1117;--surface:#161b22;--surface-2:#21262d;--surface-3:#2a313a;
  --border:#30363d;--border-2:#3d444d;
  --fg:#e6edf3;--fg-muted:#8b949e;--fg-faint:#6e7681;
  --ok:#4caf50;--warn:#ffc107;--err:#f85149;--info:#58a6ff;--purple:#a371f7;
  --r-sm:8px;--r:12px;--r-lg:16px;
  --appbar-h:52px;--tabbar-h:56px;
  --sab:env(safe-area-inset-bottom,0px);
  --sat:env(safe-area-inset-top,0px);
}
[data-theme="light"]{
  --bg:#f5f7fa;--surface:#ffffff;--surface-2:#eef1f5;--surface-3:#e3e8ef;
  --border:#d8dee6;--border-2:#c8d0da;
  --fg:#1a1a2e;--fg-muted:#5a6a7e;--fg-faint:#94a3b8;
  --accent-soft:rgba(74,144,217,.10);
}
html,body{height:100%;height:100dvh;overflow:hidden;overscroll-behavior:none}
body{
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif;
  background:var(--bg);color:var(--fg);
  font-size:15px;line-height:1.45;
  -webkit-font-smoothing:antialiased;
  user-select:none;-webkit-user-select:none;
}
input,textarea{-webkit-user-select:text;user-select:text}
button{font-family:inherit;color:inherit;background:none;border:none;cursor:pointer}
a{color:inherit;text-decoration:none}
::-webkit-scrollbar{width:0;height:0}

/* ── 加載覆蓋層 ── */
#ml-loading{
  position:fixed;inset:0;z-index:9999;
  background:var(--bg);
  display:flex;align-items:center;justify-content:center;
  transition:opacity .35s ease;
}
#ml-loading.ml-hide{opacity:0;pointer-events:none}
.ml-box{text-align:center;width:min(280px,80vw)}
.ml-logo{font-size:44px;color:var(--accent);margin-bottom:16px;opacity:.9}
.ml-title{font-size:15px;font-weight:600;color:var(--fg);margin-bottom:24px;letter-spacing:.3px}
.ml-bar{height:3px;background:var(--surface-2);border-radius:2px;overflow:hidden;margin-bottom:10px}
.ml-fill{height:100%;width:0;background:linear-gradient(90deg,var(--accent),var(--info));border-radius:2px;transition:width .12s linear}
.ml-pct{font-size:11px;font-family:'SF Mono',Consolas,monospace;color:var(--fg-faint);letter-spacing:.5px}

/* ── App Shell ── */
#ml-app{display:flex;flex-direction:column;height:100dvh;background:var(--bg)}

/* ── App Bar ── */
#ml-appbar{
  position:fixed;top:0;left:0;right:0;z-index:100;
  height:calc(var(--appbar-h) + var(--sat));
  padding-top:var(--sat);
  background:rgba(22,27,34,.82);
  backdrop-filter:blur(20px) saturate(180%);
  -webkit-backdrop-filter:blur(20px) saturate(180%);
  border-bottom:1px solid var(--border);
  display:flex;align-items:center;gap:4px;
  padding-left:6px;padding-right:6px;
  transition:transform .25s cubic-bezier(.32,.72,0,1);
}
[data-theme="light"] #ml-appbar{background:rgba(255,255,255,.82)}
#ml-appbar.ml-appbar-hide{transform:translateY(-100%)}
.ml-ab-btn{
  width:38px;height:38px;border-radius:10px;
  display:flex;align-items:center;justify-content:center;
  font-size:17px;color:var(--fg);flex-shrink:0;
  transition:background .12s,transform .08s;
}
.ml-ab-btn:active{transform:scale(.9);background:var(--surface-2)}
.ml-ab-btn:disabled{opacity:.3;pointer-events:none}
.ml-ab-title{
  flex:1;min-width:0;
  font-size:15px;font-weight:700;
  padding:0 6px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  letter-spacing:-.1px;
}
.ml-ab-title.hidden{visibility:hidden}

/* ── Content ── */
#ml-content{
  flex:1;overflow-y:auto;overflow-x:hidden;
  -webkit-overflow-scrolling:touch;
  padding-top:calc(var(--appbar-h) + var(--sat));
  padding-bottom:calc(var(--tabbar-h) + var(--sab));
  overscroll-behavior:contain;
}
.ml-page{padding:14px;min-height:100%}

/* ── Tab Bar ── */
#ml-tabbar{
  position:fixed;bottom:0;left:0;right:0;z-index:100;
  height:calc(var(--tabbar-h) + var(--sab));
  padding-bottom:var(--sab);
  background:rgba(22,27,34,.85);
  backdrop-filter:blur(20px) saturate(180%);
  -webkit-backdrop-filter:blur(20px) saturate(180%);
  border-top:1px solid var(--border);
  display:flex;align-items:stretch;
}
[data-theme="light"] #ml-tabbar{background:rgba(255,255,255,.85)}
.ml-tb-btn{
  flex:1;display:flex;flex-direction:column;
  align-items:center;justify-content:center;
  color:var(--fg-faint);
  transition:color .15s,transform .12s;
  position:relative;
}
.ml-tb-btn i{font-size:20px;transition:transform .18s cubic-bezier(.34,1.56,.64,1)}
.ml-tb-btn.active{color:var(--accent)}
.ml-tb-btn.active i{transform:scale(1.08)}
.ml-tb-btn:active i{transform:scale(.86)}
.ml-tb-btn.active::before{
  content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);
  width:24px;height:2px;background:var(--accent);border-radius:0 0 2px 2px;
}

/* ── 通用元件 ── */
.ml-card{
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--r);padding:14px;
  transition:border-color .15s,transform .1s;
}
.ml-card.tap:active{transform:scale(.985);border-color:var(--border-2)}

.ml-section{margin-bottom:18px}
.ml-section-title{
  font-size:12px;font-weight:700;color:var(--fg-muted);
  text-transform:uppercase;letter-spacing:.6px;
  padding:0 2px;margin-bottom:8px;
}

.ml-btn{
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  padding:10px 16px;border-radius:10px;
  background:var(--accent);color:#fff;font-size:14px;font-weight:600;
  transition:opacity .15s,transform .08s;
}
.ml-btn:active{transform:scale(.97);opacity:.9}
.ml-btn.ghost{background:var(--surface-2);color:var(--fg);border:1px solid var(--border)}
.ml-btn.danger{background:var(--err);color:#fff}
.ml-btn.full{width:100%}

.ml-input{
  width:100%;padding:11px 14px;
  background:var(--surface-2);border:1px solid var(--border);
  border-radius:10px;color:var(--fg);font-size:15px;
  font-family:inherit;outline:none;
  transition:border-color .15s,background .15s;
}
.ml-input:focus{border-color:var(--accent);background:var(--surface)}
.ml-input::placeholder{color:var(--fg-faint)}

.ml-empty{
  text-align:center;padding:60px 20px;
  color:var(--fg-muted);font-size:14px;
}
.ml-empty i{font-size:32px;display:block;margin-bottom:12px;opacity:.4}

.ml-spinner{
  display:inline-block;width:18px;height:18px;
  border:2px solid var(--border);border-top-color:var(--accent);
  border-radius:50%;animation:mlspin .7s linear infinite;
}
@keyframes mlspin{to{transform:rotate(360deg)}}
.ml-loading-center{padding:50px 0;text-align:center}

.ml-skel{
  background:linear-gradient(90deg,var(--surface) 25%,var(--surface-2) 50%,var(--surface) 75%);
  background-size:200% 100%;animation:mlskel 1.4s infinite;
  border-radius:6px;
}
@keyframes mlskel{0%{background-position:200% 0}100%{background-position:-200% 0}}
.ml-skel-line{height:12px;margin-bottom:8px}
.ml-skel-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:14px;margin-bottom:10px}

/* ── 首頁 ── */
.ml-greet{margin-bottom:20px}
.ml-greet-h1{font-size:24px;font-weight:800;letter-spacing:-.6px;line-height:1.2;margin-bottom:4px}
.ml-greet-h1 em{font-style:normal;color:var(--accent)}
.ml-greet-sub{font-size:13px;color:var(--fg-muted)}

.ml-stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px}
.ml-stat{
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--r);padding:14px;
  position:relative;overflow:hidden;
}
.ml-stat::after{
  content:'';position:absolute;top:0;right:0;width:60px;height:60px;
  background:radial-gradient(circle at 100% 0%,var(--accent-soft),transparent 70%);
  pointer-events:none;
}
.ml-stat-val{font-size:22px;font-weight:800;letter-spacing:-.5px;line-height:1;margin-bottom:4px}
.ml-stat-lbl{font-size:11px;color:var(--fg-muted);text-transform:uppercase;letter-spacing:.5px;font-weight:600}
.ml-stat-icon{position:absolute;top:12px;right:12px;font-size:16px;color:var(--accent);opacity:.85}

.ml-quick-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:22px}
.ml-quick{
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--r);padding:14px 12px;
  display:flex;flex-direction:column;gap:8px;
  transition:transform .1s,border-color .15s;
}
.ml-quick:active{transform:scale(.97);border-color:var(--accent)}
.ml-quick i{font-size:18px;color:var(--accent)}
.ml-quick-t{font-size:13px;font-weight:700;line-height:1.2}
.ml-quick-d{font-size:11px;color:var(--fg-muted);margin-top:-4px}

/* ── Updates ── */
.ml-update{
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--r);padding:12px 14px;margin-bottom:10px;
  cursor:pointer;transition:border-color .15s;
}
.ml-update:active{border-color:var(--border-2)}
.ml-update-head{display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap}
.ml-badge{
  font-size:10px;font-weight:800;padding:2px 8px;border-radius:6px;
  text-transform:uppercase;letter-spacing:.4px;
}
.ml-badge.new{background:rgba(76,175,80,.18);color:#8fdf8f}
.ml-badge.info{background:rgba(88,166,255,.18);color:#8ec3ff}
.ml-badge.warning{background:rgba(255,193,7,.18);color:#ffd54f}
[data-theme="light"] .ml-badge.new{color:#2e7d32}
[data-theme="light"] .ml-badge.info{color:#1565c0}
[data-theme="light"] .ml-badge.warning{color:#b45309}
.ml-update-time{font-size:11px;color:var(--fg-faint);font-family:Consolas,monospace}
.ml-update-title{font-size:14px;font-weight:700;margin-bottom:4px}
.ml-update-body{font-size:13px;color:var(--fg-muted);line-height:1.55;display:none;padding-top:8px;border-top:1px solid var(--border);margin-top:8px}
.ml-update.open .ml-update-body{display:block}
.ml-update-excerpt{font-size:12.5px;color:var(--fg-muted);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}

/* ── 題目列表 ── */
.ml-prob-filters{
  display:flex;gap:6px;margin-bottom:12px;overflow-x:auto;
  padding:2px;scrollbar-width:none;
}
.ml-prob-filters::-webkit-scrollbar{display:none}
.ml-chip{
  padding:7px 14px;border-radius:20px;
  background:var(--surface);border:1px solid var(--border);
  font-size:13px;font-weight:600;color:var(--fg-muted);
  white-space:nowrap;flex-shrink:0;
  transition:all .15s;
}
.ml-chip.active{background:var(--accent);color:#fff;border-color:var(--accent)}
.ml-chip:active{transform:scale(.95)}

.ml-prob{
  background:var(--surface);border:1px solid var(--border);
  border-left:3px solid var(--border);
  border-radius:var(--r);padding:12px 14px;margin-bottom:8px;
  display:flex;gap:12px;align-items:flex-start;
  transition:transform .1s,border-color .15s;
}
.ml-prob:active{transform:scale(.99)}
.ml-prob.passed{border-left-color:var(--ok)}
.ml-prob.failed{border-left-color:var(--err)}
.ml-prob-main{flex:1;min-width:0}
.ml-prob-top{display:flex;gap:8px;align-items:center;margin-bottom:4px;flex-wrap:wrap}
.ml-prob-id{font-family:'SF Mono',Consolas,monospace;font-size:12px;font-weight:700;color:var(--accent)}
.ml-prob-name{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.ml-prob-meta{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--fg-muted);margin-top:4px;align-items:center}
.ml-prob-tags{display:flex;gap:4px;flex-wrap:wrap}
.ml-tag{
  font-size:10px;padding:2px 7px;border-radius:5px;
  background:var(--surface-2);color:var(--fg-muted);
  font-weight:600;
}
.ml-prob-diff{
  font-family:'SF Mono',Consolas,monospace;font-size:12px;font-weight:700;
  padding:2px 8px;border-radius:6px;background:var(--surface-2);
}
.ml-prob-fav{
  font-size:16px;color:var(--fg-faint);
  padding:4px;flex-shrink:0;
  transition:color .15s,transform .1s;
}
.ml-prob-fav.on{color:#f1c40f}
.ml-prob-fav:active{transform:scale(.8)}

.ml-prob-status{font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;flex-shrink:0}
.ml-prob-status.passed{background:rgba(76,175,80,.15);color:#8fdf8f}
.ml-prob-status.failed{background:rgba(248,81,73,.15);color:#ff8888}

/* ── 題目詳情 ── */
.ml-pd-title{font-size:20px;font-weight:800;margin-bottom:4px;letter-spacing:-.4px;line-height:1.3}
.ml-pd-meta{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--fg-muted);margin-bottom:14px}
.ml-pd-statement{font-size:14.5px;line-height:1.7;color:var(--fg);margin-bottom:16px;word-wrap:break-word}
.ml-pd-statement img{max-width:100%;height:auto;border-radius:8px}
.ml-pd-statement p{margin-bottom:.8em}
.ml-pd-statement code{background:var(--surface-2);padding:1px 5px;border-radius:4px;font-size:.9em}

.ml-answer-row{
  display:flex;gap:8px;margin-bottom:10px;
}
.ml-answer-row .ml-input{flex:1}
.ml-feedback{
  margin-top:10px;padding:10px 14px;border-radius:10px;
  font-size:13px;font-weight:600;display:none;
}
.ml-feedback.show{display:block}
.ml-feedback.ac{background:rgba(76,175,80,.15);color:#8fdf8f;border:1px solid rgba(76,175,80,.3)}
.ml-feedback.wa{background:rgba(248,81,73,.15);color:#ff8888;border:1px solid rgba(248,81,73,.3)}
.ml-feedback.pending{background:rgba(255,193,7,.15);color:#ffd54f;border:1px solid rgba(255,193,7,.3)}

/* ── Submissions / Contest 列表 ── */
.ml-sub{
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--r);padding:11px 14px;margin-bottom:8px;
  display:flex;gap:12px;align-items:center;
  transition:transform .1s;
}
.ml-sub:active{transform:scale(.99)}
.ml-sub-date{
  display:flex;flex-direction:column;flex-shrink:0;min-width:74px;
  border-right:1px solid var(--border);padding-right:10px;
  font-family:'SF Mono',Consolas,monospace;
  font-size:11px;color:var(--fg-muted);line-height:1.4;
}
.ml-sub-date .d{font-weight:700;color:var(--fg)}
.ml-sub-date .t{font-size:10.5px;color:var(--fg-faint)}
.ml-sub-main{flex:1;min-width:0}
.ml-sub-prob{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ml-sub-user{font-size:11.5px;color:var(--fg-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ml-sub-status{font-size:11px;font-weight:700;padding:3px 9px;border-radius:8px;flex-shrink:0}
.ml-sub-status.ac{background:rgba(76,175,80,.15);color:#8fdf8f}
.ml-sub-status.wa{background:rgba(248,81,73,.15);color:#ff8888}
.ml-sub-status.partial{background:rgba(255,193,7,.15);color:#ffd54f}
.ml-sub-status.pending{background:rgba(160,160,160,.15);color:#aaa}
.ml-sub-status.system{background:rgba(163,113,247,.15);color:#c0a2e8}
[data-theme="light"] .ml-sub-status.ac{color:#2e7d32}
[data-theme="light"] .ml-sub-status.wa{color:#c62828}
[data-theme="light"] .ml-sub-status.partial{color:#b45309}

/* ── 排行榜 ── */
.ml-rank-top{
  display:flex;align-items:flex-end;justify-content:center;
  gap:10px;padding:20px 10px 24px;margin-bottom:14px;
}
.ml-rank-podium{
  flex:1;max-width:110px;text-align:center;
  display:flex;flex-direction:column;align-items:center;
}
.ml-rank-avatar{
  width:56px;height:56px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  font-size:20px;font-weight:800;color:#fff;
  margin-bottom:8px;border:2px solid var(--border);
}
.ml-rank-podium.r1 .ml-rank-avatar{width:68px;height:68px;font-size:24px;border-color:#ffd700;box-shadow:0 0 20px rgba(255,215,0,.35)}
.ml-rank-podium.r2 .ml-rank-avatar{border-color:#c0c0c0}
.ml-rank-podium.r3 .ml-rank-avatar{border-color:#cd7f32}
.ml-rank-name{
  font-size:12px;font-weight:700;
  max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.ml-rank-solves{font-size:11px;color:var(--fg-muted);margin-top:2px;font-family:Consolas,monospace}

.ml-rank-item{
  display:flex;align-items:center;gap:12px;
  padding:10px 14px;background:var(--surface);
  border:1px solid var(--border);border-radius:10px;margin-bottom:6px;
}
.ml-rank-item .rk{
  width:28px;text-align:center;font-weight:800;font-size:13px;
  color:var(--fg-muted);font-family:Consolas,monospace;flex-shrink:0;
}
.ml-rank-item .av{
  width:34px;height:34px;border-radius:50%;
  background:var(--surface-2);color:var(--fg-muted);
  display:flex;align-items:center;justify-content:center;
  font-weight:700;font-size:13px;flex-shrink:0;overflow:hidden;
}
.ml-rank-item .av img{width:100%;height:100%;object-fit:cover}
.ml-rank-item .nm{flex:1;min-width:0;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ml-rank-item .sc{font-family:Consolas,monospace;font-weight:700;color:var(--accent);font-size:14px;flex-shrink:0}
.ml-rank-item.me{background:var(--accent-soft);border-color:var(--accent)}

.ml-rank-self{
  position:sticky;bottom:8px;margin-top:12px;
  background:var(--surface-2);border:1px solid var(--accent);
  box-shadow:0 -6px 24px rgba(0,0,0,.25);
}

/* ── Me 頁 ── */
.ml-me-head{text-align:center;padding:20px 0 24px}
.ml-me-avatar{
  width:80px;height:80px;border-radius:50%;margin:0 auto 12px;
  background:linear-gradient(135deg,var(--accent),#2e5fa0);
  display:flex;align-items:center;justify-content:center;
  font-size:32px;color:#fff;overflow:hidden;
  box-shadow:0 6px 24px rgba(74,144,217,.3);
}
.ml-me-avatar img{width:100%;height:100%;object-fit:cover}
.ml-me-name{font-size:20px;font-weight:800;margin-bottom:3px}
.ml-me-sub{font-size:13px;color:var(--fg-muted)}

.ml-me-stats{
  display:grid;grid-template-columns:repeat(3,1fr);gap:8px;
  margin-bottom:24px;
}
.ml-me-stat{
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--r);padding:12px 8px;text-align:center;
}
.ml-me-stat-v{font-size:19px;font-weight:800;letter-spacing:-.3px;line-height:1;margin-bottom:4px}
.ml-me-stat-l{font-size:10px;color:var(--fg-muted);text-transform:uppercase;letter-spacing:.5px;font-weight:600}

.ml-list{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;margin-bottom:16px}
.ml-list-item{
  display:flex;align-items:center;gap:12px;
  padding:14px 16px;
  border-bottom:1px solid var(--border);
  font-size:15px;font-weight:500;
  transition:background .12s;
}
.ml-list-item:last-child{border-bottom:none}
.ml-list-item:active{background:var(--surface-2)}
.ml-list-item i.ico{width:20px;text-align:center;color:var(--accent);flex-shrink:0}
.ml-list-item .lbl{flex:1;min-width:0}
.ml-list-item .chev{color:var(--fg-faint);font-size:12px}
.ml-list-item.danger .lbl,.ml-list-item.danger i.ico{color:var(--err)}

/* ── Settings ── */
.ml-set-group{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;margin-bottom:14px}
.ml-set-item{
  display:flex;align-items:center;gap:12px;
  padding:13px 16px;border-bottom:1px solid var(--border);
}
.ml-set-item:last-child{border-bottom:none}
.ml-set-item .lbl{flex:1;font-size:14.5px;font-weight:500}
.ml-set-item .hint{font-size:11.5px;color:var(--fg-muted);display:block;margin-top:2px;font-weight:400}
.ml-switch{
  position:relative;width:44px;height:26px;flex-shrink:0;
  background:var(--surface-3);border-radius:14px;
  cursor:pointer;transition:background .18s;
}
.ml-switch::after{
  content:'';position:absolute;top:3px;left:3px;
  width:20px;height:20px;border-radius:50%;
  background:#fff;transition:transform .18s;
  box-shadow:0 1px 3px rgba(0,0,0,.2);
}
.ml-switch.on{background:var(--accent)}
.ml-switch.on::after{transform:translateX(18px)}

.ml-seg{display:flex;gap:4px;background:var(--surface-2);border-radius:8px;padding:3px;flex-shrink:0}
.ml-seg-btn{padding:5px 10px;border-radius:6px;font-size:12px;font-weight:600;color:var(--fg-muted);transition:all .15s}
.ml-seg-btn.active{background:var(--surface);color:var(--fg);box-shadow:0 1px 3px rgba(0,0,0,.15)}

/* ── Login ── */
#ml-login{display:flex;align-items:center;justify-content:center;min-height:100dvh;padding:24px;background:var(--bg)}
.ml-login-card{width:100%;max-width:380px;padding:32px 24px}
.ml-login-logo{text-align:center;margin-bottom:28px}
.ml-login-logo i{font-size:38px;color:var(--accent)}
.ml-login-logo h1{font-size:22px;font-weight:800;margin-top:12px;letter-spacing:-.4px}
.ml-login-logo p{font-size:13px;color:var(--fg-muted);margin-top:4px}
.ml-login-form{display:flex;flex-direction:column;gap:12px}
.ml-login-err{font-size:13px;color:var(--err);text-align:center;min-height:18px}
.ml-login-divider{display:flex;align-items:center;gap:12px;margin:20px 0;color:var(--fg-faint);font-size:11px;font-weight:600}
.ml-login-divider::before,.ml-login-divider::after{content:'';flex:1;height:1px;background:var(--border)}
.ml-ms-btn{
  display:flex;align-items:center;justify-content:center;gap:10px;
  width:100%;padding:11px;border-radius:10px;
  background:var(--surface);border:1px solid var(--border);
  color:var(--fg);font-weight:600;font-size:14px;
  transition:background .15s;
}
.ml-ms-btn:active{background:var(--surface-2)}

/* ── Toast ── */
#ml-toast{
  position:fixed;top:calc(var(--appbar-h) + var(--sat) + 12px);
  left:50%;transform:translateX(-50%) translateY(-20px);
  background:var(--surface-2);color:var(--fg);
  padding:10px 18px;border-radius:12px;
  font-size:13px;font-weight:600;
  box-shadow:0 8px 24px rgba(0,0,0,.35);
  border:1px solid var(--border);
  opacity:0;pointer-events:none;
  transition:opacity .2s,transform .2s;
  z-index:9998;max-width:90vw;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
#ml-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}

/* ── Modal ── */
.ml-modal{
  position:fixed;inset:0;z-index:9997;
  background:rgba(0,0,0,.6);
  display:flex;align-items:flex-end;justify-content:center;
  opacity:0;pointer-events:none;transition:opacity .2s;
}
.ml-modal.show{opacity:1;pointer-events:auto}
.ml-modal-card{
  width:100%;max-width:500px;
  background:var(--surface);border-top-left-radius:20px;border-top-right-radius:20px;
  padding:20px;padding-bottom:calc(20px + var(--sab));
  transform:translateY(100%);transition:transform .3s cubic-bezier(.32,.72,0,1);
  max-height:85dvh;overflow-y:auto;
}
.ml-modal.show .ml-modal-card{transform:translateY(0)}
.ml-modal-handle{width:36px;height:4px;background:var(--border-2);border-radius:2px;margin:0 auto 16px}
.ml-modal-title{font-size:17px;font-weight:800;margin-bottom:14px;text-align:center}

/* ── 滾動時 AppBar 隱藏 ── */
.ml-scrolling #ml-appbar{transform:translateY(-100%)}

@media (min-width:600px){
  .ml-page{max-width:600px;margin:0 auto;padding:20px}
}
`;

// ═══════════════════════════════════════════════════════════
// 2. 常量 & 全域狀態
// ═══════════════════════════════════════════════════════════
const AUTH_URL = 'https://cdn.jsdelivr.net/gh/wyk-math-team/resources/script/auth.js';
const APP_URL  = 'https://cdn.jsdelivr.net/gh/wyk-math-team/resources/script/app.js';

const LS = {
  problems: 'mobile_problems_v1',
  states: 'mobile_states_v1',
  fav: 'mobile_fav_v1',
  settings: 'mobile_settings_v1',
};

const DEFAULT_SETTINGS = {
  theme: 'dark',
  showDifficulty: true,
  showTags: true,
  showSolves: true,
  showFavorite: true,
  compact: false,
  animations: true,
  pageSize: 30,
};

const TABS = [
  { id: 'home',        icon: 'fa-house',         label: 'Home',        match: /^\/?$/ },
  { id: 'problems',    icon: 'fa-list-check',    label: 'Problems',    match: /^\/problems/ },
  { id: 'submissions', icon: 'fa-paper-plane',   label: 'Submissions', match: /^\/submissions/ },
  { id: 'contests',    icon: 'fa-trophy',        label: 'Contests',    match: /^\/contests/ },
  { id: 'rank',        icon: 'fa-ranking-star',  label: 'Rank',        match: /^\/rank/ },
  { id: 'me',          icon: 'fa-user',          label: 'Me',          match: /^\/(me|settings)/ },
];

const state = {
  user: null,
  problems: null,
  states: null,
  favorites: null,
  settings: { ...DEFAULT_SETTINGS },
  route: { path: '/', parts: [] },
  problemsLoaded: false,
  loadedPages: new Set(),
  lastScrollTop: 0,
  appReady: false,
};

// ═══════════════════════════════════════════════════════════
// 3. 工具
// ═══════════════════════════════════════════════════════════
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}
function escAttr(s) { return esc(s); }

function toast(msg) {
  let t = $('#ml-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'ml-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 1800);
}

function fmtSize(b) {
  if (!b || b < 0) return '';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

function fmtDateTime(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return { date: '—', time: '—' };
  const pad = n => String(n).padStart(2, '0');
  const local = new Date(d.getTime() + 8 * 3600000);
  const yy = local.getUTCFullYear();
  const mm = pad(local.getUTCMonth() + 1);
  const dd = pad(local.getUTCDate());
  const hh = pad(local.getUTCHours());
  const mi = pad(local.getUTCMinutes());
  const ss = pad(local.getUTCSeconds());
  return { date: `${yy}-${mm}-${dd}`, time: `${hh}:${mi}:${ss}` };
}

function faviconOf(name) {
  const first = String(name || '?').trim()[0] || '?';
  return first.toUpperCase();
}

// ═══════════════════════════════════════════════════════════
// 4. 進度條
// ═══════════════════════════════════════════════════════════
const _progressStart = Date.now();

function tickProgress() {
  const fill = $('#mlFill');
  const pct  = $('#mlPct');
  const wrap = $('#ml-loading');
  if (!fill || !pct || !wrap) return;

  let target;
  if (state.appReady) {
    const cur = parseFloat(fill.style.width) || 0;
    target = cur + (100 - cur) * 0.25;
    if (target > 99.5) {
      fill.style.width = '100%';
      pct.textContent = '100%';
      setTimeout(() => {
        wrap.classList.add('ml-hide');
        setTimeout(() => wrap.remove(), 400);
      }, 160);
      return;
    }
  } else {
    const elapsed = Date.now() - _progressStart;
    const t = Math.min(1, elapsed / 4500);
    const eased = 1 - Math.pow(1 - t, 3);
    target = eased * 88;
    if (elapsed > 5000) {
      const over = Math.min(1, (elapsed - 5000) / 3000);
      target = 88 + over * 11;
    }
    target = Math.min(target, 99);
    const cur = parseFloat(fill.style.width) || 0;
    if (cur > target) target = cur;
  }
  fill.style.width = target.toFixed(2) + '%';
  pct.textContent = Math.floor(target) + '%';
  requestAnimationFrame(tickProgress);
}

// ═══════════════════════════════════════════════════════════
// 5. LocalStorage 緩存
// ═══════════════════════════════════════════════════════════
function lsRead(key, ttl) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (ttl && data.ts && Date.now() - data.ts > ttl) return null;
    return data;
  } catch { return null; }
}
function lsWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), v: value })); } catch {}
}

function loadSettings() {
  const c = lsRead(LS.settings);
  if (c && c.v && typeof c.v === 'object') {
    Object.assign(state.settings, c.v);
  }
  applyTheme();
  applyAnimations();
}
function saveSettings() {
  lsWrite(LS.settings, state.settings);
  applyTheme();
  applyAnimations();
}
function applyTheme() {
  const t = state.settings.theme === 'auto'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : state.settings.theme;
  document.documentElement.setAttribute('data-theme', t);
}
function applyAnimations() {
  document.documentElement.style.setProperty(
    '--_anim',
    state.settings.animations ? '1' : '0'
  );
}

function loadProblemsCache() {
  const c = lsRead(LS.problems, 24 * 60 * 60 * 1000);
  if (c && c.v && Array.isArray(c.v.problems)) {
    state.problems = c.v.problems;
    state.problemsLoaded = true;
    return true;
  }
  return false;
}
function saveProblemsCache(problems) {
  lsWrite(LS.problems, { problems });
}
function loadStatesCache() {
  const c = lsRead(LS.states, 24 * 60 * 60 * 1000);
  if (c && c.v) { state.states = c.v; return true; }
  return false;
}
function saveStatesCache(states) { lsWrite(LS.states, states); }
function loadFavCache() {
  const c = lsRead(LS.fav, 24 * 60 * 60 * 1000);
  if (c && Array.isArray(c.v)) { state.favorites = new Set(c.v); return true; }
  return false;
}
function saveFavCache() {
  lsWrite(LS.fav, Array.from(state.favorites || []));
}

// ═══════════════════════════════════════════════════════════
// 6. 路由
// ═══════════════════════════════════════════════════════════
function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const parts = raw.split('/').filter(Boolean).map(decodeURIComponent);
  return { path: '/' + parts.join('/'), parts };
}

function navigate(path) {
  const hash = '#' + path;
  if (location.hash === hash) {
    renderRoute();
  } else {
    location.hash = hash;
  }
}

function routeTitle() {
  const p = state.route.parts;
  if (p.length === 0) return 'WYK Maths Team';
  const head = p[0];
  const headName = head.charAt(0).toUpperCase() + head.slice(1);
  if (head === 'me' || head === 'settings') return '';
  if (head === 'submissions') return 'Submissions';
  if (head === 'rank') return 'Rank';
  if (p.length === 1) return headName;
  return headName + ' - ' + decodeURIComponent(p[p.length - 1]);
}

// ═══════════════════════════════════════════════════════════
// 7. App Bar
// ═══════════════════════════════════════════════════════════
function renderAppBar({ leftIcon = 'fa-chevron-left', rightIcon = 'fa-chevron-right',
                        onLeft, onRight, leftDisabled, rightDisabled } = {}) {
  const bar = $('#ml-appbar');
  if (!bar) return;
  const title = routeTitle();

  bar.innerHTML = `
    <button class="ml-ab-btn" id="ml-ab-back" ${leftDisabled ? 'disabled' : ''}>
      <i class="fas ${leftIcon}"></i>
    </button>
    <div class="ml-ab-title${title ? '' : ' hidden'}">${esc(title)}</div>
    <button class="ml-ab-btn" id="ml-ab-fwd" ${rightDisabled ? 'disabled' : ''}>
      <i class="fas ${rightIcon}"></i>
    </button>
  `;

  const back = $('#ml-ab-back');
  const fwd  = $('#ml-ab-fwd');

  if (back) back.onclick = () => {
    if (onLeft) onLeft();
    else history.back();
  };
  if (fwd) fwd.onclick = () => {
    if (onRight) onRight();
    else history.forward();
  };
}

// ═══════════════════════════════════════════════════════════
// 8. Tab Bar
// ═══════════════════════════════════════════════════════════
function renderTabBar() {
  const bar = $('#ml-tabbar');
  if (!bar) return;
  const path = state.route.path;
  bar.innerHTML = TABS.map(t => {
    const active = t.match.test(path) ? ' active' : '';
    return `<button class="ml-tb-btn${active}" data-tab="${t.id}" aria-label="${t.label}">
      <i class="fas ${t.icon}"></i>
    </button>`;
  }).join('');
  $$('.ml-tb-btn', bar).forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.tab;
      const target = { home: '/', problems: '/problems', submissions: '/submissions',
                       contests: '/contests', rank: '/rank', me: '/me' }[id];
      navigate(target);
    };
  });
}

// ═══════════════════════════════════════════════════════════
// 9. API 封裝
// ═══════════════════════════════════════════════════════════
async function api(path, method, body) {
  if (typeof window.apiCall === 'function') {
    return window.apiCall(path, method, body);
  }
  // 保底
  const opts = { method: method || 'GET', headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const token = localStorage.getItem('auth_token');
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, opts);
  return res.json();
}

// ═══════════════════════════════════════════════════════════
// 10. 預取
// ═══════════════════════════════════════════════════════════
async function prefetchAll() {
  const jobs = [
    // 題目列表
    (async () => {
      try {
        if (loadProblemsCache()) return;
        const d = await api('/api/problem?all=1');
        if (d && d.success && Array.isArray(d.problems)) {
          state.problems = d.problems;
          state.problemsLoaded = true;
          saveProblemsCache(d.problems);
        }
      } catch (e) { console.warn('prefetch problems failed', e); }
    })(),
    // 用戶 states + favorites
    (async () => {
      try {
        if (loadStatesCache() && loadFavCache()) return;
        const d = await api('/api/users?action=preload');
        if (d && d.success) {
          state.states = d.states || {};
          state.favorites = new Set(d.favorites || []);
          saveStatesCache(state.states);
          saveFavCache();
        }
      } catch (e) { console.warn('prefetch preload failed', e); }
    })(),
    // 公告
    (async () => {
      try {
        const d = await fetch('/api/updates').then(r => r.json());
        if (d && d.success && Array.isArray(d.updates)) {
          state._updates = d.updates;
        }
      } catch (e) {}
    })(),
  ];
  await Promise.allSettled(jobs);
}

// ═══════════════════════════════════════════════════════════
// 11. 頁面渲染器
// ═══════════════════════════════════════════════════════════

// ── Home ──
async function renderHome() {
  const content = $('#ml-content');
  const u = state.user || {};
  const hour = new Date().getHours();
  const greet = hour < 5 ? 'Late night' :
                hour < 12 ? 'Good morning' :
                hour < 18 ? 'Good afternoon' : 'Good evening';

  const totalProblems = state.problems ? state.problems.length : 0;
  let solvedCount = 0;
  if (state.states) {
    solvedCount = Object.values(state.states).filter(v => v === 'passed').length;
  }

  content.innerHTML = `
    <div class="ml-page">
      <div class="ml-greet">
        <h1 class="ml-greet-h1">${esc(greet)},<br><em>${esc(u.displayName || u.username || 'Guest')}</em></h1>
        <p class="ml-greet-sub">What are we solving today?</p>
      </div>

      <div class="ml-stats-grid">
        <div class="ml-stat">
          <i class="fas fa-check-circle ml-stat-icon"></i>
          <div class="ml-stat-val">${solvedCount}</div>
          <div class="ml-stat-lbl">Solved</div>
        </div>
        <div class="ml-stat">
          <i class="fas fa-book ml-stat-icon"></i>
          <div class="ml-stat-val">${totalProblems}</div>
          <div class="ml-stat-lbl">Total</div>
        </div>
      </div>

      <div class="ml-section-title">Quick Access</div>
      <div class="ml-quick-grid">
        <a class="ml-quick" data-nav="/problems" data-filter="unsolved">
          <i class="fas fa-fire"></i>
          <div class="ml-quick-t">Continue</div>
          <div class="ml-quick-d">Unsolved problems</div>
        </a>
        <a class="ml-quick" data-nav="/problems" data-filter="fav">
          <i class="fas fa-star"></i>
          <div class="ml-quick-t">Bookmarks</div>
          <div class="ml-quick-d">Saved for later</div>
        </a>
        <a class="ml-quick" data-nav="/submissions">
          <i class="fas fa-paper-plane"></i>
          <div class="ml-quick-t">My Submissions</div>
          <div class="ml-quick-d">Latest attempts</div>
        </a>
        <a class="ml-quick" data-nav="/contests">
          <i class="fas fa-trophy"></i>
          <div class="ml-quick-t">Contests</div>
          <div class="ml-quick-d">Join events</div>
        </a>
      </div>

      <div class="ml-section-title">Recent Updates</div>
      <div id="ml-updates">
        ${renderUpdatesSkeleton()}
      </div>
    </div>
  `;

  // 綁定 quick
  $$('.ml-quick[data-nav]', content).forEach(el => {
    el.onclick = () => {
      const f = el.dataset.filter;
      if (f) sessionStorage.setItem('ml_prob_filter', f);
      navigate(el.dataset.nav);
    };
  });

  // 載入 updates
  loadUpdates();
}

function renderUpdatesSkeleton() {
  let h = '';
  for (let i = 0; i < 3; i++) {
    h += `<div class="ml-skel-card">
      <div class="ml-skel ml-skel-line" style="width:30%"></div>
      <div class="ml-skel ml-skel-line" style="width:85%"></div>
      <div class="ml-skel ml-skel-line" style="width:60%"></div>
    </div>`;
  }
  return h;
}

async function loadUpdates() {
  const wrap = $('#ml-updates');
  if (!wrap) return;
  try {
    let updates = state._updates;
    if (!updates) {
      const d = await fetch('/api/updates').then(r => r.json());
      updates = d.success ? d.updates : [];
      state._updates = updates;
    }
    if (!updates.length) {
      wrap.innerHTML = `<div class="ml-empty"><i class="fas fa-inbox"></i>No updates yet</div>`;
      return;
    }
    wrap.innerHTML = updates.map((u, i) => `
      <div class="ml-update" data-i="${i}">
        <div class="ml-update-head">
          <span class="ml-badge ${esc(u.badge)}">${esc(u.badgeText || u.badge)}</span>
          <span class="ml-update-time">${esc(u.time || '')}</span>
        </div>
        ${u.title ? `<div class="ml-update-title">${esc(u.title)}</div>` : ''}
        <div class="ml-update-excerpt" data-excerpt>${stripHtml(u.content || '').slice(0, 120)}</div>
        <div class="ml-update-body">${u.content || ''}</div>
      </div>
    `).join('');
    $$('.ml-update', wrap).forEach(el => {
      el.onclick = () => {
        const open = el.classList.toggle('open');
        const ex = el.querySelector('[data-excerpt]');
        if (ex) ex.style.display = open ? 'none' : '';
      };
    });
  } catch (e) {
    wrap.innerHTML = `<div class="ml-empty"><i class="fas fa-triangle-exclamation"></i>Failed to load updates</div>`;
  }
}

function stripHtml(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return (d.textContent || '').trim();
}

// ── Problems 列表 ──
async function renderProblems() {
  const content = $('#ml-content');
  const savedFilter = sessionStorage.getItem('ml_prob_filter') || 'all';
  sessionStorage.removeItem('ml_prob_filter');

  content.innerHTML = `
    <div class="ml-page">
      <div class="ml-prob-filters" id="ml-prob-filters">
        <button class="ml-chip" data-f="all">All</button>
        <button class="ml-chip" data-f="unsolved">Unsolved</button>
        <button class="ml-chip" data-f="solved">Solved</button>
        <button class="ml-chip" data-f="fav">Bookmarks</button>
      </div>
      <div id="ml-prob-list">
        ${renderProblemsSkeleton()}
      </div>
    </div>
  `;

  // chip 綁定
  let filter = savedFilter;
  const setFilter = (f) => {
    filter = f;
    $$('#ml-prob-filters .ml-chip').forEach(b => b.classList.toggle('active', b.dataset.f === f));
    renderProbList(f);
  };
  $$('#ml-prob-filters .ml-chip').forEach(b => {
    b.onclick = () => setFilter(b.dataset.f);
  });

  // 首次
  if (!state.problemsLoaded) {
    // 等預取
    const wait = setInterval(() => {
      if (state.problemsLoaded) {
        clearInterval(wait);
        setFilter(filter);
      }
    }, 100);
    setTimeout(() => {
      clearInterval(wait);
      if (!state.problemsLoaded) setFilter(filter);
    }, 4000);
  } else {
    setFilter(filter);
  }
}

function renderProblemsSkeleton() {
  let h = '';
  for (let i = 0; i < 6; i++) {
    h += `<div class="ml-skel-card">
      <div class="ml-skel ml-skel-line" style="width:20%"></div>
      <div class="ml-skel ml-skel-line" style="width:70%"></div>
      <div class="ml-skel ml-skel-line" style="width:40%"></div>
    </div>`;
  }
  return h;
}

function renderProbList(filter) {
  const wrap = $('#ml-prob-list');
  if (!wrap) return;
  const all = state.problems || [];
  const s = state.settings;
  const states = state.states || {};
  const favs = state.favorites || new Set();

  let items = all.slice();
  if (filter === 'unsolved') items = items.filter(p => states[p.id] !== 'passed');
  else if (filter === 'solved') items = items.filter(p => states[p.id] === 'passed');
  else if (filter === 'fav') items = items.filter(p => favs.has(p.id));

  if (!items.length) {
    wrap.innerHTML = `<div class="ml-empty"><i class="fas fa-inbox"></i>No problems</div>`;
    return;
  }

  const limit = s.pageSize || 30;
  const shown = items.slice(0, limit);
  const hasMore = items.length > limit;

  wrap.innerHTML = shown.map(p => probCardHtml(p, s, states, favs)).join('')
    + (hasMore ? `<button class="ml-btn ghost full" id="ml-load-more" style="margin-top:8px">Load ${items.length - limit} more</button>` : '');

  bindProbCards(wrap);
  if (hasMore) {
    const btn = $('#ml-load-more');
    if (btn) btn.onclick = () => {
      btn.remove();
      const rest = items.slice(limit);
      const html = rest.map(p => probCardHtml(p, s, states, favs)).join('');
      wrap.insertAdjacentHTML('beforeend', html);
      bindProbCards(wrap);
    };
  }
}

function probCardHtml(p, s, states, favs) {
  const st = states[p.id] || 'not_started';
  const cls = st === 'passed' ? 'passed' : st === 'failed' ? 'failed' : '';
  const isFav = favs.has(p.id);
  const diff = p.difficulty;
  const diffText = !diff ? '∞' : diff.toFixed(2);

  let statusHtml = '';
  if (st === 'passed') statusHtml = `<span class="ml-prob-status passed"><i class="fas fa-check"></i> AC</span>`;
  else if (st === 'failed') statusHtml = `<span class="ml-prob-status failed"><i class="fas fa-times"></i> WA</span>`;

  return `
    <div class="ml-prob ${cls}" data-id="${escAttr(p.id)}">
      <div class="ml-prob-main">
        <div class="ml-prob-top">
          <span class="ml-prob-id">${esc(p.id)}</span>
          <span class="ml-prob-name">${esc(p.name || '')}</span>
          ${statusHtml}
        </div>
        <div class="ml-prob-meta">
          ${s.showDifficulty ? `<span class="ml-prob-diff">Lv.${diffText}</span>` : ''}
          ${s.showSolves ? `<span><i class="fas fa-user-check"></i> ${p.solves || 0}</span>` : ''}
          ${s.showTags && p.tags && p.tags.length
            ? `<div class="ml-prob-tags">${p.tags.slice(0, 3).map(t => `<span class="ml-tag">${esc(t)}</span>`).join('')}${p.tags.length > 3 ? `<span class="ml-tag">+${p.tags.length - 3}</span>` : ''}</div>`
            : ''}
        </div>
      </div>
      ${s.showFavorite ? `<button class="ml-prob-fav${isFav ? ' on' : ''}" data-fav="${escAttr(p.id)}">
        <i class="fas fa-star"></i>
      </button>` : ''}
    </div>`;
}

function bindProbCards(root) {
  $$('.ml-prob', root).forEach(el => {
    el.onclick = (e) => {
      if (e.target.closest('[data-fav]')) return;
      const id = el.dataset.id;
      navigate('/problems/' + encodeURIComponent(id));
    };
  });
  $$('[data-fav]', root).forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.dataset.fav;
      const isOn = btn.classList.contains('on');
      btn.classList.toggle('on');
      if (isOn) state.favorites.delete(id);
      else state.favorites.add(id);
      saveFavCache();
      try {
        const d = await api('/api/users?action=favorite', 'POST', { problemId: id });
        if (d && d.success && Array.isArray(d.favorites)) {
          state.favorites = new Set(d.favorites);
          saveFavCache();
        }
      } catch (err) {
        // 回滾
        btn.classList.toggle('on');
        if (isOn) state.favorites.add(id);
        else state.favorites.delete(id);
        saveFavCache();
      }
    };
  });
}

// ── Problem Detail ──
async function renderProblemDetail(id) {
  const content = $('#ml-content');
  content.innerHTML = `<div class="ml-page"><div class="ml-loading-center"><span class="ml-spinner"></span></div></div>`;

  // 找相鄰題目
  const all = state.problems || [];
  const idx = all.findIndex(p => p.id === id);
  const prevId = idx > 0 ? all[idx - 1].id : null;
  const nextId = idx >= 0 && idx < all.length - 1 ? all[idx + 1].id : null;

  renderAppBar({
    leftIcon: 'fa-chevron-left',
    rightIcon: 'fa-chevron-right',
    leftDisabled: !prevId,
    rightDisabled: !nextId,
    onLeft: prevId ? () => navigate('/problems/' + encodeURIComponent(prevId)) : null,
    onRight: nextId ? () => navigate('/problems/' + encodeURIComponent(nextId)) : null,
  });

  try {
    const d = await api('/api/problem?action=page&id=' + encodeURIComponent(id));
    if (!d || !d.success || !d.problem) throw new Error('Not found');
    const p = d.problem;
    const st = d.state || 'not_started';
    const fav = !!d.favorited;
    if (!state.favorites) state.favorites = new Set();
    if (fav) state.favorites.add(id);
    else state.favorites.delete(id);
    saveFavCache();

    const s = state.settings;
    const diffText = !p.difficulty ? '∞' : Number(p.difficulty).toFixed(2);

    content.innerHTML = `
      <div class="ml-page">
        <div class="ml-pd-title">${esc(p.name || p.id)}</div>
        <div class="ml-pd-meta">
          <span class="ml-prob-id">${esc(p.id)}</span>
          ${s.showDifficulty ? `<span>Lv.${diffText}</span>` : ''}
          ${s.showTags && p.tags && p.tags.length
            ? `<div class="ml-prob-tags">${p.tags.map(t => `<span class="ml-tag">${esc(t)}</span>`).join('')}</div>` : ''}
          <button class="ml-prob-fav${fav ? ' on' : ''}" data-fav="${escAttr(id)}" style="margin-left:auto">
            <i class="fas fa-star"></i>
          </button>
        </div>
        <div class="ml-pd-statement" id="ml-pd-statement"></div>

        <div id="ml-pd-answer-zone">
          <div class="ml-answer-row">
            <input type="text" class="ml-input" id="ml-pd-answer" placeholder="Your answer" autocomplete="off" inputmode="decimal">
            <button class="ml-btn" id="ml-pd-submit">Submit</button>
          </div>
          <div class="ml-feedback" id="ml-pd-feedback"></div>
        </div>
      </div>
    `;

    // 渲染 statement（用 DOMPurify 如果有）
    const stmt = $('#ml-pd-statement');
    if (stmt) {
      let html = p.statement || '';
      if (window.DOMPurify) {
        html = DOMPurify.sanitize(html, {
          ADD_TAGS: ['svg', 'path', 'g', 'defs', 'clipPath', 'rect', 'circle', 'line', 'polyline', 'polygon', 'text', 'tspan', 'linearGradient', 'radialGradient', 'stop', 'use', 'foreignObject'],
          ADD_ATTR: ['viewBox', 'd', 'cx', 'cy', 'r', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'points', 'fill', 'stroke', 'stroke-width', 'transform', 'xmlns'],
        });
      }
      stmt.innerHTML = html;
      // KaTeX
      if (typeof renderMathInElement === 'function') {
        renderMathInElement(stmt, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
          ],
        });
      }
    }

    // 收藏
    const favBtn = $('[data-fav]', content);
    if (favBtn) {
      favBtn.onclick = async () => {
        const on = favBtn.classList.toggle('on');
        if (on) state.favorites.add(id); else state.favorites.delete(id);
        saveFavCache();
        try {
          const r = await api('/api/users?action=favorite', 'POST', { problemId: id });
          if (r && r.success && Array.isArray(r.favorites)) {
            state.favorites = new Set(r.favorites);
            saveFavCache();
          }
        } catch {}
      };
    }

    // 提交
    const answerInp = $('#ml-pd-answer');
    const submitBtn = $('#ml-pd-submit');
    const fb = $('#ml-pd-feedback');

    // 恢復上次答案
    try {
      const saved = JSON.parse(localStorage.getItem('pd_user_answers') || '{}');
      if (saved[id] && answerInp) answerInp.value = saved[id];
    } catch {}

    const doSubmit = async () => {
      const ans = (answerInp.value || '').trim();
      if (!ans) { toast('Enter an answer'); return; }
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="ml-spinner" style="width:14px;height:14px;border-width:2px"></span>';
      try {
        const r = await api('/api/submit', 'POST', { problemId: id, answer: ans, type: 'text', image: '' });
        if (r && r.success) {
          const correct = r.correct || r.score === 100;
          const score = typeof r.score === 'number' ? r.score : (correct ? 100 : 0);
          if (correct) {
            fb.className = 'ml-feedback show ac';
            fb.textContent = '✓ Accepted';
            state.states = state.states || {};
            state.states[id] = 'passed';
            saveStatesCache(state.states);
          } else if (score > 0) {
            fb.className = 'ml-feedback show partial';
            fb.textContent = `Partial ${score}%`;
          } else {
            fb.className = 'ml-feedback show wa';
            fb.textContent = '✗ Wrong Answer';
            state.states = state.states || {};
            if (state.states[id] !== 'passed') state.states[id] = 'failed';
            saveStatesCache(state.states);
          }
        } else {
          fb.className = 'ml-feedback show wa';
          fb.textContent = r.message || 'Error';
        }
      } catch (e) {
        fb.className = 'ml-feedback show wa';
        fb.textContent = 'Network error';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit';
      }
    };
    submitBtn.onclick = doSubmit;
    answerInp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); doSubmit(); }
    });

  } catch (e) {
    content.innerHTML = `<div class="ml-page"><div class="ml-empty"><i class="fas fa-triangle-exclamation"></i>Problem not found</div></div>`;
  }
}

// ── Submissions ──
async function renderSubmissions() {
  const content = $('#ml-content');
  content.innerHTML = `
    <div class="ml-page">
      <div id="ml-subs-list">
        <div class="ml-loading-center"><span class="ml-spinner"></span></div>
      </div>
    </div>`;

  try {
    const d = await api('/api/submissions?all=1&page=1&limit=50');
    if (!d || !d.success) throw new Error();
    const subs = d.submissions || [];
    if (!subs.length) {
      $('#ml-subs-list').innerHTML = `<div class="ml-empty"><i class="fas fa-inbox"></i>No submissions</div>`;
      return;
    }
    $('#ml-subs-list').innerHTML = subs.map(s => subCardHtml(s)).join('');
    $$('.ml-sub', content).forEach(el => {
      el.onclick = () => {
        const subid = el.dataset.subid;
        if (subid) navigate('/submissions/' + encodeURIComponent(subid));
      };
    });
  } catch (e) {
    $('#ml-subs-list').innerHTML = `<div class="ml-empty"><i class="fas fa-triangle-exclamation"></i>Failed to load</div>`;
  }
}

function subCardHtml(s) {
  const dt = fmtDateTime(s.timestamp);
  const statusClass = statusCls(s.status);
  return `
    <div class="ml-sub" data-subid="${escAttr(s.subid || '')}">
      <div class="ml-sub-date">
        <span class="d">${esc(dt.date)}</span>
        <span class="t">${esc(dt.time)}</span>
      </div>
      <div class="ml-sub-main">
        <div class="ml-sub-prob">${esc(s.problemName || s.problemId || '—')}</div>
        <div class="ml-sub-user">${esc(s.displayName || s.username || '')}</div>
      </div>
      <span class="ml-sub-status ${statusClass}">${esc(s.status || 'Pending')}</span>
    </div>`;
}

function statusCls(st) {
  if (!st) return 'pending';
  if (st === 'Accepted') return 'ac';
  if (st === 'Wrong Answer') return 'wa';
  if (st.startsWith('Partial')) return 'partial';
  if (st === 'System Error') return 'system';
  return 'pending';
}

// ── Submission Detail ──
async function renderSubmissionDetail(subid) {
  const content = $('#ml-content');
  content.innerHTML = `<div class="ml-page"><div class="ml-loading-center"><span class="ml-spinner"></span></div></div>`;
  renderAppBar();
  try {
    const d = await api('/api/submissions?action=detail&subid=' + encodeURIComponent(subid));
    if (!d || !d.success) throw new Error();
    const s = d.submission;
    const dt = fmtDateTime(s.timestamp);
    const statusClass = statusCls(d.status || (s.correct ? 'Accepted' : 'Wrong Answer'));

    content.innerHTML = `
      <div class="ml-page">
        <div class="ml-card">
          <div style="font-size:16px;font-weight:700;margin-bottom:6px">${esc(d.problemName || s.problemId)}</div>
          <div style="font-size:12px;color:var(--fg-muted);margin-bottom:12px">
            ${esc(dt.date)} ${esc(dt.time)} · ${esc(s.username)}
          </div>
          <div class="ml-sub-status ${statusClass}" style="display:inline-block">${esc(d.status || 'Pending')}</div>
        </div>
        ${s.answer !== undefined ? `
          <div class="ml-section-title" style="margin-top:18px">Answer</div>
          <div class="ml-card" style="font-family:Consolas,monospace;font-size:14px;word-break:break-all">${esc(s.answer || '(empty)')}</div>
        ` : s.answerHidden ? `
          <div class="ml-section-title" style="margin-top:18px">Answer</div>
          <div class="ml-card" style="color:var(--fg-muted);font-style:italic">Hidden</div>
        ` : ''}
        ${s.comment ? `
          <div class="ml-section-title" style="margin-top:18px">Comment</div>
          <div class="ml-card">${esc(s.comment)}</div>
        ` : ''}
      </div>`;
  } catch (e) {
    content.innerHTML = `<div class="ml-page"><div class="ml-empty"><i class="fas fa-triangle-exclamation"></i>Not found</div></div>`;
  }
}

// ── Contests ──
async function renderContests() {
  const content = $('#ml-content');
  content.innerHTML = `
    <div class="ml-page">
      <div id="ml-contests-list"><div class="ml-loading-center"><span class="ml-spinner"></span></div></div>
    </div>`;

  try {
    const d = await api('/api/contests?action=list&page=1&limit=30');
    if (!d || !d.success) throw new Error();
    const cs = d.contests || [];
    if (!cs.length) {
      $('#ml-contests-list').innerHTML = `<div class="ml-empty"><i class="fas fa-inbox"></i>No contests</div>`;
      return;
    }
    const now = Date.now();
    $('#ml-contests-list').innerHTML = cs.map(c => {
      const start = new Date(c.startTime).getTime();
      const dur = (Number(c.duration) || 0) * 60000;
      const end = start + dur;
      let status = 'upcoming';
      if (now > end) status = 'ended';
      else if (now >= start) status = 'ongoing';
      return contestCardHtml(c, status);
    }).join('');
    $$('.ml-sub', content).forEach(el => {
      el.onclick = () => navigate('/contests/' + encodeURIComponent(el.dataset.cid));
    });
  } catch (e) {
    $('#ml-contests-list').innerHTML = `<div class="ml-empty"><i class="fas fa-triangle-exclamation"></i>Failed to load</div>`;
  }
}

function contestCardHtml(c, status) {
  const start = new Date(c.startTime);
  const pad = n => String(n).padStart(2, '0');
  const local = new Date(start.getTime() + 8 * 3600000);
  const date = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
  const statusMap = { upcoming: 'Pending', ongoing: 'Ongoing', ended: 'Ended' };
  const cls = { upcoming: 'partial', ongoing: 'ac', ended: 'pending' };
  return `
    <div class="ml-sub" data-cid="${escAttr(c.id)}">
      <div class="ml-sub-date">
        <span class="d">${esc(date)}</span>
        <span class="t">${esc(time)}</span>
      </div>
      <div class="ml-sub-main">
        <div class="ml-sub-prob">${esc(c.name || ('Contest #' + c.id))}</div>
        <div class="ml-sub-user">${c.contestantCount || 0} participants · ${Number(c.duration) || 0}m</div>
      </div>
      <span class="ml-sub-status ${cls[status]}">${statusMap[status]}</span>
    </div>`;
}

// ── Contest Detail ──
async function renderContestDetail(id) {
  const content = $('#ml-content');
  content.innerHTML = `<div class="ml-page"><div class="ml-loading-center"><span class="ml-spinner"></span></div></div>`;
  renderAppBar();
  try {
    const d = await api('/api/contests?action=page&id=' + encodeURIComponent(id));
    if (!d || !d.success) throw new Error();
    const c = d.contest;
    const start = new Date(c.startTime);
    const pad = n => String(n).padStart(2, '0');
    const local = new Date(start.getTime() + 8 * 3600000);
    const dateStr = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;

    const canSeeProblems = c.problems && c.problems.length && (c.status === 'ongoing' || c.status === 'ended') && c.isParticipant;

    content.innerHTML = `
      <div class="ml-page">
        <h2 style="font-size:20px;font-weight:800;margin-bottom:6px">${esc(c.name)}</h2>
        <div style="font-size:12px;color:var(--fg-muted);margin-bottom:16px">
          ${esc(dateStr)} · ${c.duration}m · ${c.participantCount} participants
        </div>

        ${canSeeProblems ? `
          <div class="ml-section-title">Problems</div>
          ${c.problems.map(p => {
            const st = (c.userContestStates || {})[p.id] || 'not_started';
            const cls = st === 'passed' ? 'passed' : st === 'failed' ? 'failed' : '';
            return `<div class="ml-prob ${cls}" data-cid="${escAttr(id)}" data-pid="${escAttr(p.id)}" style="cursor:pointer">
              <div class="ml-prob-main">
                <div class="ml-prob-top">
                  <span class="ml-prob-id">${esc(p.id)}</span>
                  <span class="ml-prob-name">${esc(p.name || '')}</span>
                </div>
              </div>
            </div>`;
          }).join('')}
        ` : `
          <div class="ml-empty"><i class="fas fa-lock"></i>${c.status === 'upcoming' ? 'Contest not started' : 'Problems not available'}</div>
        `}
      </div>`;

    $$('.ml-prob[data-pid]', content).forEach(el => {
      el.onclick = () => navigate('/problems/' + encodeURIComponent(el.dataset.pid));
    });
  } catch (e) {
    content.innerHTML = `<div class="ml-page"><div class="ml-empty"><i class="fas fa-triangle-exclamation"></i>Not found</div></div>`;
  }
}

// ── Rank ──
async function renderRank() {
  const content = $('#ml-content');
  content.innerHTML = `<div class="ml-page"><div class="ml-loading-center"><span class="ml-spinner"></span></div></div>`;
  try {
    const d = await api('/api/users?action=leaderboard');
    if (!d || !d.success) throw new Error();
    const list = d.leaderboard || [];

    let html = `<div class="ml-page">`;

    if (list.length >= 3) {
      const [r1, r2, r3] = list;
      html += `<div class="ml-rank-top">
        ${rankPodiumHtml(r2, 2)}
        ${rankPodiumHtml(r1, 1)}
        ${rankPodiumHtml(r3, 3)}
      </div>`;
    }

    html += `<div>`;
    const rest = list.slice(3);
    if (rest.length) {
      html += rest.map(u => rankItemHtml(u)).join('');
    }

    // 自己
    const me = state.user && state.user.username;
    if (me) {
      const meIdx = list.findIndex(x => x.username === me);
      if (meIdx >= 0) {
        html += `<div class="ml-rank-self">${rankItemHtml(list[meIdx], true)}</div>`;
      }
    }
    html += `</div></div>`;
    content.innerHTML = html;
  } catch (e) {
    content.innerHTML = `<div class="ml-page"><div class="ml-empty"><i class="fas fa-triangle-exclamation"></i>Failed to load</div></div>`;
  }
}

function rankPodiumHtml(u, r) {
  const name = u.displayName || u.username;
  const avatar = u.pfp
    ? `<img src="${escAttr(u.pfp)}" alt="">`
    : faviconOf(name);
  return `<div class="ml-rank-podium r${r}">
    <div class="ml-rank-avatar">${avatar}</div>
    <div class="ml-rank-name">${esc(name)}</div>
    <div class="ml-rank-solves">${u.solves || 0}</div>
  </div>`;
}
function rankItemHtml(u, isSelf) {
  const name = u.displayName || u.username;
  const avatar = u.pfp ? `<img src="${escAttr(u.pfp)}" alt="">` : faviconOf(name);
  return `<div class="ml-rank-item${isSelf ? ' me' : ''}">
    <div class="rk">#${u.rank}</div>
    <div class="av">${avatar}</div>
    <div class="nm">${esc(name)}</div>
    <div class="sc">${u.solves || 0}</div>
  </div>`;
}

// ── Me ──
async function renderMe() {
  const content = $('#ml-content');
  const u = state.user || {};
  const states = state.states || {};
  const solved = Object.values(states).filter(v => v === 'passed').length;
  const total = state.problems ? state.problems.length : 0;
  const pct = total ? Math.round(solved / total * 100) : 0;

  const avatar = u.pfp
    ? `<img src="${escAttr(u.pfp)}" alt="">`
    : '<i class="fas fa-user"></i>';

  content.innerHTML = `
    <div class="ml-page">
      <div class="ml-me-head">
        <div class="ml-me-avatar">${avatar}</div>
        <div class="ml-me-name">${esc(u.displayName || u.username || 'Guest')}</div>
        <div class="ml-me-sub">@${esc(u.username || '')}</div>
      </div>
      <div class="ml-me-stats">
        <div class="ml-me-stat">
          <div class="ml-me-stat-v">${solved}</div>
          <div class="ml-me-stat-l">Solved</div>
        </div>
        <div class="ml-me-stat">
          <div class="ml-me-stat-v">${pct}%</div>
          <div class="ml-me-stat-l">Progress</div>
        </div>
        <div class="ml-me-stat">
          <div class="ml-me-stat-v">${total}</div>
          <div class="ml-me-stat-l">Total</div>
        </div>
      </div>

      <div class="ml-list">
        <div class="ml-list-item" data-nav="/submissions">
          <i class="fas fa-paper-plane ico"></i>
          <span class="lbl">My Submissions</span>
          <i class="fas fa-chevron-right chev"></i>
        </div>
        <div class="ml-list-item" data-filter="fav">
          <i class="fas fa-star ico"></i>
          <span class="lbl">Bookmarks</span>
          <i class="fas fa-chevron-right chev"></i>
        </div>
        <div class="ml-list-item" data-nav="/contests">
          <i class="fas fa-trophy ico"></i>
          <span class="lbl">Contests</span>
          <i class="fas fa-chevron-right chev"></i>
        </div>
      </div>

      <div class="ml-list">
        <div class="ml-list-item" data-nav="/settings">
          <i class="fas fa-gear ico"></i>
          <span class="lbl">Settings</span>
          <i class="fas fa-chevron-right chev"></i>
        </div>
        <div class="ml-list-item" id="ml-me-logout">
          <i class="fas fa-right-from-bracket ico" style="color:var(--err)"></i>
          <span class="lbl" style="color:var(--err)">Sign Out</span>
        </div>
      </div>
    </div>`;

  $$('[data-nav]', content).forEach(el => {
    el.onclick = () => navigate(el.dataset.nav);
  });
  const favNav = $('[data-filter="fav"]', content);
  if (favNav) favNav.onclick = () => {
    sessionStorage.setItem('ml_prob_filter', 'fav');
    navigate('/problems');
  };
  $('#ml-me-logout').onclick = () => {
    if (!confirm('Sign out?')) return;
    try { localStorage.removeItem('auth_token'); } catch {}
    if (typeof window.logout === 'function') window.logout();
    setTimeout(() => location.reload(), 60);
  };
}

// ── Settings ──
async function renderSettings() {
  const content = $('#ml-content');
  const s = state.settings;

  content.innerHTML = `
    <div class="ml-page">
      <div class="ml-section-title">Appearance</div>
      <div class="ml-set-group">
        <div class="ml-set-item">
          <span class="lbl">Theme</span>
          <div class="ml-seg" data-seg="theme">
            <button class="ml-seg-btn${s.theme === 'dark' ? ' active' : ''}" data-v="dark">Dark</button>
            <button class="ml-seg-btn${s.theme === 'light' ? ' active' : ''}" data-v="light">Light</button>
            <button class="ml-seg-btn${s.theme === 'auto' ? ' active' : ''}" data-v="auto">Auto</button>
          </div>
        </div>
        <div class="ml-set-item">
          <span class="lbl">Compact Mode</span>
          <div class="ml-switch${s.compact ? ' on' : ''}" data-sw="compact"></div>
        </div>
        <div class="ml-set-item">
          <span class="lbl">More Animations</span>
          <div class="ml-switch${s.animations ? ' on' : ''}" data-sw="animations"></div>
        </div>
        <div class="ml-set-item">
          <span class="lbl">Cards per Page</span>
          <div class="ml-seg" data-seg="pageSize">
            <button class="ml-seg-btn${s.pageSize === 20 ? ' active' : ''}" data-v="20">20</button>
            <button class="ml-seg-btn${s.pageSize === 30 ? ' active' : ''}" data-v="30">30</button>
            <button class="ml-seg-btn${s.pageSize === 50 ? ' active' : ''}" data-v="50">50</button>
          </div>
        </div>
      </div>

      <div class="ml-section-title">Problem List</div>
      <div class="ml-set-group">
        <div class="ml-set-item">
          <span class="lbl">Show Difficulty</span>
          <div class="ml-switch${s.showDifficulty ? ' on' : ''}" data-sw="showDifficulty"></div>
        </div>
        <div class="ml-set-item">
          <span class="lbl">Show Tags</span>
          <div class="ml-switch${s.showTags ? ' on' : ''}" data-sw="showTags"></div>
        </div>
        <div class="ml-set-item">
          <span class="lbl">Show Solve Count</span>
          <div class="ml-switch${s.showSolves ? ' on' : ''}" data-sw="showSolves"></div>
        </div>
        <div class="ml-set-item">
          <span class="lbl">Show Favorite Star</span>
          <div class="ml-switch${s.showFavorite ? ' on' : ''}" data-sw="showFavorite"></div>
        </div>
      </div>

      <div class="ml-section-title">Account</div>
      <div class="ml-list">
        <div class="ml-list-item" data-act="password">
          <i class="fas fa-key ico"></i>
          <span class="lbl">Change Password</span>
          <i class="fas fa-chevron-right chev"></i>
        </div>
        <div class="ml-list-item" data-act="name">
          <i class="fas fa-signature ico"></i>
          <span class="lbl">Change Display Name</span>
          <i class="fas fa-chevron-right chev"></i>
        </div>
        <div class="ml-list-item danger" data-act="logout">
          <i class="fas fa-right-from-bracket ico"></i>
          <span class="lbl">Sign Out</span>
        </div>
      </div>
    </div>`;

  // 開關
  $$('[data-sw]', content).forEach(el => {
    el.onclick = () => {
      const k = el.dataset.sw;
      const next = !state.settings[k];
      state.settings[k] = next;
      el.classList.toggle('on', next);
      saveSettings();
    };
  });
  // 分段
  $$('[data-seg]', content).forEach(seg => {
    const k = seg.dataset.seg;
    $$('.ml-seg-btn', seg).forEach(btn => {
      btn.onclick = () => {
        let v = btn.dataset.v;
        if (k === 'pageSize') v = parseInt(v, 10);
        state.settings[k] = v;
        $$('.ml-seg-btn', seg).forEach(b => b.classList.toggle('active', b === btn));
        saveSettings();
      };
    });
  });
  // 帳號
  $$('[data-act]', content).forEach(el => {
    el.onclick = async () => {
      const a = el.dataset.act;
      if (a === 'password') {
        const oldP = prompt('Current password');
        if (!oldP) return;
        const newP = prompt('New password (min 4 chars)');
        if (!newP) return;
        try {
          const r = await api('/api/users?action=changepassword', 'POST', { oldPassword: oldP, newPassword: newP });
          toast(r.success ? 'Password updated' : (r.message || 'Failed'));
        } catch { toast('Network error'); }
      } else if (a === 'name') {
        const cur = state.user ? (state.user.displayName || state.user.username) : '';
        const nn = prompt('New display name', cur);
        if (!nn || !nn.trim()) return;
        try {
          const r = await api('/api/users?action=changename', 'POST', { newname: nn.trim() });
          if (r.success) {
            state.user.displayName = nn.trim();
            toast('Updated');
          } else toast(r.message || 'Failed');
        } catch { toast('Network error'); }
      } else if (a === 'logout') {
        if (!confirm('Sign out?')) return;
        try { localStorage.removeItem('auth_token'); } catch {}
        if (typeof window.logout === 'function') window.logout();
        setTimeout(() => location.reload(), 60);
      }
    };
  });
}

// ═══════════════════════════════════════════════════════════
// 12. 路由分派
// ═══════════════════════════════════════════════════════════
async function renderRoute() {
  state.route = parseRoute();
  const p = state.route.parts;
  renderTabBar();

  // 滾動復位
  const content = $('#ml-content');
  if (content) content.scrollTop = 0;

  // AppBar 預設狀態
  renderAppBar({
    leftDisabled: p.length <= 1,
    rightDisabled: true,
  });

  if (p.length === 0) {
    await renderHome();
  } else if (p[0] === 'problems') {
    if (p[1]) await renderProblemDetail(decodeURIComponent(p[1]));
    else await renderProblems();
  } else if (p[0] === 'submissions') {
    if (p[1]) await renderSubmissionDetail(decodeURIComponent(p[1]));
    else await renderSubmissions();
  } else if (p[0] === 'contests') {
    if (p[1]) await renderContestDetail(decodeURIComponent(p[1]));
    else await renderContests();
  } else if (p[0] === 'rank') {
    await renderRank();
  } else if (p[0] === 'me') {
    await renderMe();
  } else if (p[0] === 'settings') {
    await renderSettings();
  } else {
    await renderHome();
  }
}

// ═══════════════════════════════════════════════════════════
// 13. 滾動時隱藏 AppBar
// ═══════════════════════════════════════════════════════════
function bindScrollBehavior() {
  const content = $('#ml-content');
  if (!content) return;
  content.addEventListener('scroll', () => {
    const st = content.scrollTop;
    const diff = st - state.lastScrollTop;
    if (st > 60 && diff > 6) {
      document.body.classList.add('ml-scrolling');
    } else if (diff < -6 || st < 60) {
      document.body.classList.remove('ml-scrolling');
    }
    state.lastScrollTop = st;
  }, { passive: true });
}

// ═══════════════════════════════════════════════════════════
// 14. Login 頁
// ═══════════════════════════════════════════════════════════
function renderLogin() {
  const root = $('#ml-root');
  document.getElementById('ml-loading')?.remove();
  document.body.style.overflow = 'auto';
  root.innerHTML = `
    <div id="ml-login">
      <div class="ml-login-card">
        <div class="ml-login-logo">
          <i class="fas fa-cube"></i>
          <h1>WYK Maths Team</h1>
          <p>Sign in to continue</p>
        </div>
        <form class="ml-login-form" id="ml-login-form" autocomplete="on">
          <input type="text" class="ml-input" id="ml-login-u" placeholder="Username" autocomplete="username" autocapitalize="none" spellcheck="false">
          <input type="password" class="ml-input" id="ml-login-p" placeholder="Password" autocomplete="current-password">
          <div class="ml-login-err" id="ml-login-err"></div>
          <button type="submit" class="ml-btn full" id="ml-login-btn">Sign In</button>
        </form>
        <div class="ml-login-divider">OR</div>
        <button class="ml-ms-btn" id="ml-login-ms">
          <svg width="18" height="18" viewBox="0 0 23 23" aria-hidden="true">
            <rect x="0" y="0" width="10.5" height="10.5" fill="#F25022"/>
            <rect x="12.5" y="0" width="10.5" height="10.5" fill="#7FBA00"/>
            <rect x="0" y="12.5" width="10.5" height="10.5" fill="#00A4EF"/>
            <rect x="12.5" y="12.5" width="10.5" height="10.5" fill="#FFB900"/>
          </svg>
          Continue with Microsoft
        </button>
      </div>
    </div>`;

  const form = $('#ml-login-form');
  const uInp = $('#ml-login-u');
  const pInp = $('#ml-login-p');
  const btn  = $('#ml-login-btn');
  const err  = $('#ml-login-err');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = uInp.value.trim();
    const p = pInp.value;
    if (!u || !p) { err.textContent = 'Enter username and password'; return; }
    err.textContent = '';
    btn.disabled = true;
    btn.innerHTML = '<span class="ml-spinner" style="width:14px;height:14px;border-width:2px"></span>';

    const loginStart = Date.now();
    try {
      const result = await window.login(u, p);
      // 卡 5 秒
      const elapsed = Date.now() - loginStart;
      const remain = Math.max(0, 5000 - elapsed);
      await new Promise(r => setTimeout(r, remain));

      if (result && result.success) {
        location.reload();
        return;
      }
      err.textContent = (result && result.message) || 'Invalid credentials';
    } catch (e2) {
      const elapsed = Date.now() - loginStart;
      const remain = Math.max(0, 5000 - elapsed);
      await new Promise(r => setTimeout(r, remain));
      err.textContent = 'Network error';
    }
    btn.disabled = false;
    btn.textContent = 'Sign In';
  });

  $('#ml-login-ms').onclick = () => {
    location.href = '/api/auth/microsoft';
  };
}

// ═══════════════════════════════════════════════════════════
// 15. 啟動
// ═══════════════════════════════════════════════════════════
function mountApp() {
  const root = $('#ml-root');
  root.innerHTML = `
    <div id="ml-app">
      <header id="ml-appbar"></header>
      <main id="ml-content"></main>
      <nav id="ml-tabbar"></nav>
    </div>`;
  document.body.style.overflow = 'hidden';
  bindScrollBehavior();

  // hash 變化
  window.addEventListener('hashchange', renderRoute);

  // 首次渲染
  renderRoute();
}

async function boot() {
  // 1) 注入 CSS
  const styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  // 2) 進度條
  requestAnimationFrame(tickProgress);

  // 3) 讀本地 settings
  loadSettings();

  // 4) 等 auth.js 就緒
  await new Promise(r => {
    const check = () => {
      if (typeof window.isLoggedIn === 'function') r();
      else setTimeout(check, 40);
    };
    check();
  });

  // 5) 檢查登入
  if (!window.isLoggedIn()) {
    renderLogin();
    state.appReady = true;
    return;
  }

  state.user = window.getCurrentUser() || {};

  // 6) 讀本地緩存
  loadProblemsCache();
  loadStatesCache();
  loadFavCache();

  // 7) mount app
  mountApp();

  // 8) 完成 → 隱藏 loading
  state.appReady = true;

  // 9) 背景預取（低優先）
  setTimeout(() => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(prefetchAll, { timeout: 2000 });
    } else {
      setTimeout(prefetchAll, 300);
    }
  }, 200);
}

// 啟動
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

})();