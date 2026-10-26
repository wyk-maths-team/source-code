// api/port/upload.js
// POST /api/port/upload
// body: { images: ["data:image/...;base64,...", ...] }
// 回傳 GitHub CDN URLs
import { portAuth } from './_auth.js';
import { wrapHandler } from '../../lib/errors.js';

const MAX_IMAGES = 10;
const MAX_BYTES = 10 * 1024 * 1024;

async function handler(req, res) {
  const decoded = await portAuth(req, res);
  if (!decoded) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { images } = req.body || {};
  if (!Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ success: false, message: 'No images' });
  }
  if (images.length > MAX_IMAGES) {
    return res.status(400).json({ success: false, message: `Max ${MAX_IMAGES} images` });
  }

  try {
    const { uploadTimestampedImage } = await import('../../lib/github-upload.js');
    const urls = [];

    for (const dataUrl of images) {
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
        return res.status(400).json({ success: false, message: 'Invalid image data' });
      }
      const base64 = dataUrl.split(',')[1] || '';
      const bytes = Math.floor(base64.length * 3 / 4);
      if (bytes > MAX_BYTES) {
        return res.status(413).json({
          success: false,
          message: `Image too large (${(bytes / 1024 / 1024).toFixed(1)} MB, max 10 MB)`,
        });
      }

      const url = await uploadTimestampedImage(dataUrl, {
        folder: 'port/submissions',
        baseName: decoded.username,
      });
      urls.push(url);
    }

    return res.status(200).json({ success: true, urls });
  } catch (err) {
    console.error('[port upload]', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// 统一错误兜底：未捕获异常 -> { success:false, code, message, detail, requestId }
export default wrapHandler(handler);