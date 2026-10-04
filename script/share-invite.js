// resources/script/share-invite.js
// PK 邀請分享彈窗 —— 顯示邀請連結、二維碼、複製按鈕
(function () {
  'use strict';

  // ── 動態載入 QRCode 函式庫（只在首次呼叫時）
  let _qrLibPromise = null;
  function loadQRLib() {
    if (_qrLibPromise) return _qrLibPromise;
    _qrLibPromise = new Promise((resolve, reject) => {
      if (typeof window.qrcode === 'function') return resolve(window.qrcode);
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
      s.onload = () => {
        if (typeof window.qrcode === 'function') resolve(window.qrcode);
        else reject(new Error('qrcode-generator loaded but not attached to window'));
      };
      s.onerror = () => reject(new Error('Failed to load QR library'));
      document.head.appendChild(s);
    });
    return _qrLibPromise;
  }

  // ── 複製到剪貼簿（含 fallback）
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        return true;
      } catch { return false; }
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  // ── 主入口
  window.showPKInviteShare = function (invite) {
    if (!invite || !invite.id) {
      console.warn('[share-invite] invalid invite');
      return;
    }

    const shareUrl = `${location.origin}/pk/invite?id=${encodeURIComponent(invite.id)}`;
    const toName   = invite.toDisplay || invite.to || 'your opponent';

    // 移除舊彈窗
    const old = document.getElementById('pk-share-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'pk-share-overlay';
    overlay.innerHTML = `
      <style>
        #pk-share-overlay {
          position: fixed; inset: 0;
          background: rgba(0,0,0,.75);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          z-index: 2147483645;
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
          font-family: system-ui, -apple-system, sans-serif;
          animation: pkShareFade .2s ease-out;
        }
        @keyframes pkShareFade { from { opacity: 0; } to { opacity: 1; } }
        #pk-share-overlay .pk-share-card {
          background: var(--card-bg, #fff);
          border: 2px solid var(--accent, #4a90d9);
          border-radius: 16px;
          padding: 28px 26px;
          max-width: 420px; width: 100%;
          box-shadow: 0 20px 60px rgba(0,0,0,.5);
          text-align: center;
          animation: pkShareIn .3s cubic-bezier(.34,1.56,.64,1);
          color: var(--text-primary, #111);
        }
        @keyframes pkShareIn {
          from { opacity: 0; transform: scale(.92); }
          to   { opacity: 1; transform: scale(1); }
        }
        #pk-share-overlay .pk-share-head {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 6px;
        }
        #pk-share-overlay .pk-share-title {
          font-size: 1.15rem; font-weight: 800;
          margin: 0; display: flex; align-items: center; gap: 8px;
        }
        #pk-share-overlay .pk-share-close {
          background: none; border: none;
          width: 32px; height: 32px; border-radius: 50%;
          font-size: 1rem; cursor: pointer;
          color: var(--text-secondary, #888);
        }
        #pk-share-overlay .pk-share-close:hover {
          background: rgba(0,0,0,.06);
          color: var(--text-primary, #111);
        }
        #pk-share-overlay .pk-share-sub {
          font-size: .85rem; color: var(--text-secondary, #666);
          margin-bottom: 20px;
        }
        #pk-share-overlay .pk-share-qr {
          width: 220px; height: 220px;
          margin: 0 auto 20px;
          background: #fff;
          padding: 10px;
          border-radius: 12px;
          border: 1px solid var(--border-color, #ddd);
          display: flex; align-items: center; justify-content: center;
        }
        #pk-share-overlay .pk-share-qr img {
          width: 100%; height: 100%; display: block;
        }
        #pk-share-overlay .pk-share-qr .pk-qr-loading {
          color: #999; font-size: .85rem;
        }
        #pk-share-overlay .pk-share-link-row {
          display: flex; gap: 8px; margin-bottom: 14px;
        }
        #pk-share-overlay .pk-share-link {
          flex: 1; min-width: 0;
          padding: 10px 12px;
          border: 1px solid var(--border-color, #ddd);
          border-radius: 8px;
          background: rgba(0,0,0,.03);
          color: var(--text-primary, #111);
          font-family: 'Consolas', monospace; font-size: .78rem;
          text-overflow: ellipsis; overflow: hidden; white-space: nowrap;
          user-select: all;
          text-align: left;
        }
        #pk-share-overlay .pk-share-copy {
          flex-shrink: 0;
          padding: 10px 16px;
          background: var(--accent, #4a90d9); color: #fff;
          border: none; border-radius: 8px;
          font-weight: 700; font-size: .85rem;
          cursor: pointer; font-family: inherit;
          transition: filter .15s;
        }
        #pk-share-overlay .pk-share-copy:hover { filter: brightness(1.1); }
        #pk-share-overlay .pk-share-copy.copied {
          background: #2ecc71;
        }
        #pk-share-overlay .pk-share-hint {
          font-size: .78rem; color: var(--text-secondary, #888);
          line-height: 1.5;
        }
        #pk-share-overlay .pk-share-hint strong {
          color: var(--accent, #4a90d9);
        }
                  #pk-share-overlay .pk-share-hint {
          font-size: .78rem; color: var(--text-secondary, #888);
          line-height: 1.5;
          margin-bottom: 18px;
        }
        #pk-share-overlay .pk-share-hint strong {
          color: var(--accent, #4a90d9);
        }
        /* ⭐ 新增：Go to waiting room */
        #pk-share-overlay .pk-share-wait {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 10px 22px;
          background: none;
          color: var(--accent, #4a90d9);
          border: 2px solid var(--accent, #4a90d9);
          border-radius: 8px;
          font-weight: 700; font-size: .88rem;
          text-decoration: none;
          transition: all .15s;
          cursor: pointer;
          font-family: inherit;
        }
        #pk-share-overlay .pk-share-wait:hover {
          background: var(--accent, #4a90d9);
          color: #fff;
        }
      </style>
      <div class="pk-share-card">
        <div class="pk-share-head">
          <h3 class="pk-share-title">
            <i class="fas fa-share-nodes" style="opacity:.7"></i>
            Share Invitation
          </h3>
          <button class="pk-share-close" type="button" aria-label="Close">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="pk-share-sub">
          Send this link to <strong>${esc(toName)}</strong> so they can join
        </div>
        <div class="pk-share-qr" id="pkShareQr">
          <div class="pk-qr-loading">Generating QR…</div>
        </div>
        <div class="pk-share-link-row">
          <input type="text" class="pk-share-link" id="pkShareLink"
                 value="${esc(shareUrl)}" readonly />
          <button class="pk-share-copy" type="button" id="pkShareCopy">
            <i class="fas fa-copy"></i> Copy
          </button>
        </div>
        <div class="pk-share-hint">
          Or let them scan the QR code — expires in <strong>10 minutes</strong>
        </div>
        <button type="button" class="pk-share-wait" id="pkShareWait">
          <i class="fas fa-hourglass-half"></i> Go to waiting room
        </button>
      </div>
    `;
    document.body.appendChild(overlay);

    // ── 事件綁定
    const closeBtn = overlay.querySelector('.pk-share-close');
    const copyBtn  = overlay.querySelector('#pkShareCopy');
    const linkInput = overlay.querySelector('#pkShareLink');

    function close() { overlay.remove(); }

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') {
        close();
        document.removeEventListener('keydown', onEsc);
      }
    });

    // 連結輸入框點一下全選
    linkInput.addEventListener('click', () => linkInput.select());
    linkInput.addEventListener('focus', () => linkInput.select());

    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(shareUrl);
      if (ok) {
        const orig = copyBtn.innerHTML;
        copyBtn.classList.add('copied');
        copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied';
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.innerHTML = orig;
        }, 1500);
      } else {
        alert('Copy failed — please select and copy manually.');
      }
    });
        overlay.querySelector('#pkShareWait').addEventListener('click', () => {
      window.location.href = `/pk/waiting?invite=${encodeURIComponent(invite.id)}`;
    });

    // ── 非同步生成 QR
        // ── 非同步生成 QR
    const qrEl = overlay.querySelector('#pkShareQr');
    loadQRLib()
      .then((qrcode) => {
        const qr = qrcode(0, 'M');   // 0 = 自動選型，M = 中等容錯
        qr.addData(shareUrl);
        qr.make();
        // createDataURL(cellSize, margin)
        // cellSize=6 → 約 400px 見方；margin=12 → 白邊 2 cell
        const dataUrl = qr.createDataURL(6, 12);
        qrEl.innerHTML = `<img src="${dataUrl}" alt="QR code" />`;
      })
      .catch((err) => {
        console.warn('[share-invite] QR generation failed:', err);
        qrEl.innerHTML = `<div class="pk-qr-loading">QR unavailable<br>
          <span style="font-size:.72rem">Use the link below</span></div>`;
      });
  };
})();