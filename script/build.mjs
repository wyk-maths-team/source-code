import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';

async function build() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI environment variable not set.');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB.');

    const dbName = process.env.MONGODB_DB || 'wyk_math';
    const db = client.db(dbName);
    console.log(`📚 Using database: ${dbName}`);

    // 聚合管道：公开 + 至少一个人解过
    const pipeline = [
      { $match: { public: true } },
      {
        $lookup: {
          from: 'userstats',
          let: { pidStr: { $toString: '$id' } },
          pipeline: [
            { $project: { statesArray: { $objectToArray: '$states' } } },
            { $unwind: '$statesArray' },
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$statesArray.v', 'passed'] },
                    { $eq: ['$statesArray.k', '$$pidStr'] }
                  ]
                }
              }
            },
            { $count: 'count' }
          ],
          as: 'solvesData'
        }
      },
      { $addFields: { solves: { $ifNull: [{ $arrayElemAt: ['$solvesData.count', 0] }, 0] } } },
      { $match: { solves: { $gt: 0 } } },
      {
        $project: {
          id: 1,
          name: 1,
          statement: 1,
          difficulty: 1,
          tags: 1,
          solves: 1 // 可保留，但前端用不到
        }
      }
    ];

    const problems = await db.collection('problems').aggregate(pipeline).toArray();
    console.log(`📦 Found ${problems.length} problems meeting criteria.`);

    // 清空输出目录（避免残留旧文件）
    const outDir = './static/problems';
    if (fs.existsSync(outDir)) {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outDir, { recursive: true });

    // 为每个题目生成 JSON
    for (const p of problems) {
      const content = {
        name: p.name,
        statement: p.statement,
        difficulty: p.difficulty,
        tags: p.tags,
      };
      fs.writeFileSync(
        path.join(outDir, `${p.id}.json`),
        JSON.stringify(content, null, 2)
      );
    }

    // 生成索引文件
    const index = problems.map(p => ({
      id: p.id,
      name: p.name,
      difficulty: p.difficulty,
      tags: p.tags,
    }));
    fs.writeFileSync('./static/problems/index.json', JSON.stringify(index, null, 2));

    console.log(`✅ Built ${problems.length} static problem files.`);
  } catch (err) {
    console.error('❌ Build failed:', err);
  } finally {
    await client.close();
  }
}

build();