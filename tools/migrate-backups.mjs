// migrate-backups.mjs
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const token = process.env.GITHUB_BACKUP_TOKEN || process.env.GITHUB_IMAGES_TOKEN || process.env.GITHUB_TOKEN;
const owner = process.env.GITHUB_BACKUP_OWNER || process.env.GITHUB_IMAGES_OWNER || process.env.GITHUB_OWNER;
const repo  = process.env.GITHUB_BACKUP_REPO || 'backup';

if (!token || !owner || !repo) {
  console.error('❌ 缺少环境变量');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const oldBackupDir = path.join(__dirname, 'database');
const MIN_COLLECTIONS = 22; // ⭐ 你的最低底线

async function ghApi(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'migrate-backups',
      ...(options.headers || {})
    }
  });
  return res;
}

async function deleteReleaseAndTag(releaseId, tagName) {
  console.log(`   🧹 正在清理不完整的 Release 和 Tag...`);
  try {
    await ghApi(`https://api.github.com/repos/${owner}/${repo}/releases/${releaseId}`, { method: 'DELETE' });
    await ghApi(`https://api.github.com/repos/${owner}/${repo}/git/refs/tags/${tagName}`, { method: 'DELETE' });
    console.log(`   ✅ 清理完成。`);
  } catch (e) {
    console.log(`   ⚠️ 清理时发生错误: ${e.message}`);
  }
}

async function processSingleBackup(dirName) {
  const tagName = `backup-${dirName}`;
  let releaseId = null;

  try {
    // 1. 检查 Release 是否已存在
    const checkRes = await ghApi(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tagName}`);
    if (checkRes.ok) {
      console.log(`   ⚠️ Release ${tagName} 已存在，跳过。`);
      return true; // 如果是之前手动跑留下的，我们默认它是对的（或者你可以改成去校验它）
    }

    // 2. 创建 Release
    const createRes = await ghApi(`https://api.github.com/repos/${owner}/${repo}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tagName,
        name: `Migrated Backup ${dirName}`,
        body: 'Migrated from old Git Tree backups.',
        draft: false,
        prerelease: true
      })
    });
    
    if (!createRes.ok) throw new Error(`创建 Release 失败`);
    const releaseData = await createRes.json();
    releaseId = releaseData.id;

    // 3. 遍历目录下的文件
    const dirPath = path.join(oldBackupDir, dirName);
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json'));

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const rawData = fs.readFileSync(filePath);
      const compressed = zlib.gzipSync(rawData);
      const assetName = `${file}.gz`;
      
      console.log(`   ↑ 上传: ${assetName} (${(compressed.length / 1024).toFixed(1)} KB)`);
      
      const uploadRes = await fetch(`https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${assetName}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/gzip',
          'Content-Length': compressed.length.toString()
        },
        body: compressed
      });

      if (!uploadRes.ok) throw new Error(`上传失败`);
    }
    
    // ⭐ 4. 终极校验环节：去 API 查查到底传上去了几个文件
    console.log(`   🔍 正在校验 Release 完整性...`);
    const verifyRes = await ghApi(`https://api.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets`);
    if (!verifyRes.ok) throw new Error(`获取 Assets 列表失败`);
    
    const assets = await verifyRes.json();
    // 只统计以 .json.gz 结尾的，排掉 manifest
    const dataAssets = assets.filter(a => a.name.endsWith('.json.gz') && !a.name.startsWith('_'));

    if (dataAssets.length < MIN_COLLECTIONS) {
      throw new Error(`上传数量不足：只有 ${dataAssets.length} 个，要求至少 ${MIN_COLLECTIONS} 个。`);
    }

    console.log(`   ✅ ${dirName} 迁移完成且校验通过！（共 ${dataAssets.length} 个文件）`);
    return true;

  } catch (error) {
    console.error(`   ❌ 发生错误: ${error.message}`);
    if (releaseId) {
      await deleteReleaseAndTag(releaseId, tagName);
    }
    throw error;
  }
}

async function migrate() {
  if (!fs.existsSync(oldBackupDir)) {
    console.log('❌ 找不到 database/ 文件夹');
    return;
  }

  const dirs = fs.readdirSync(oldBackupDir).filter(d => fs.statSync(path.join(oldBackupDir, d)).isDirectory());
  console.log(`找到 ${dirs.length} 个旧备份，开始迁移...`);

  for (const dirName of dirs) {
    console.log(`\n======================================`);
    console.log(`📦 处理旧备份: ${dirName}`);

    let success = false;
    let retries = 5; // ⭐ 增加到 5 次机会，网络差也不怕

    while (!success && retries > 0) {
      try {
        await processSingleBackup(dirName);
        success = true;
      } catch (e) {
        retries--;
        if (retries > 0) {
          console.log(`   🔄 等待 5 秒后进行重试... (剩余重试次数: ${retries})`);
          await new Promise(r => setTimeout(r, 5000));
        } else {
          console.error(`   💀 ${dirName} 重试 5 次依然失败，跳过此备份。`);
        }
      }
    }
    
    await new Promise(r => setTimeout(r, 1500)); // 喘口气
  }
  
  console.log('\n🎉 迁移流程结束！');
}

migrate().catch(console.error);