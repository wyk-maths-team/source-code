import fs from 'node:fs';
import path from 'node:path';
const ROOT='C:/moj';
const env={};
for (const line of fs.readFileSync(path.join(ROOT,'.env.local'),'utf8').split(/\r?\n/)) {
  const t=line.trim(); if(!t||t.startsWith('#')||!t.includes('='))continue;
  const i=t.indexOf('='); env[t.slice(0,i).trim()]=t.slice(i+1).trim().replace(/^["']|["']$/g,'');
}
const { MongoClient } = await import('mongodb');
const c=new MongoClient(env.MONGODB_URI); await c.connect();
const col=c.db(env.MONGODB_DB||'wyk_math').collection('problems');
const MAIN=['Algebra','Geometry','Combinatorics','NumberTheory'];
const AUX=['triangle','counting','optimization','digits','equation','area','surds','trigonometry','circle','polynomial','modular-arithmetic','diophantine','series','logarithms','coordinate-method','quadratic','exponential','divisibility','roots','angles','sequence','inequality','fractions','square','prime','sum','symmetric','area-method','solid-geometry','simplification','ratios','probability','floor-function','length','absolute-value','vectors'];
const docs=await col.find({id:/^CHSMLHXJ/},{projection:{_id:0}}).sort({id:1}).toArray();
let bad=0;
for (const d of docs){
  const errs=[];
  if(!/^CHSMLHXJ\d{2}$/.test(d.id)) errs.push('id');
  if(!d.name||!d.name.includes('新疆')) errs.push('name');
  if(d.public!==false) errs.push('public');
  if(!d.tags.includes('CHSML')||!d.tags.includes('bug')) errs.push('tag-CHSML/bug');
  if(!d.tags.some(t=>MAIN.includes(t))) errs.push('no-main-tag');
  const aux=d.tags.filter(t=>!MAIN.includes(t)&&t!=='CHSML'&&t!=='bug');
  if(aux.length<1||aux.length>3) errs.push('aux-count='+aux.length);
  for(const t of aux) if(!AUX.includes(t)) errs.push('bad-aux:'+t);
  if(/\$\$/.test(d.statement)) errs.push('has-double-dollar');
  const dollarCount=(d.statement.match(/\$/g)||[]).length;
  if(dollarCount%2!==0) errs.push('odd-$(%d)'.replace('%d',dollarCount));
  if(d.FS && d.ans!=='') errs.push('FS-but-ans');
  if(!d.FS && d.ans==='') errs.push('filler-no-ans');
  if(d.logic!=='') errs.push('logic');
  if(errs.length){bad++;console.log('❌',d.id,errs.join(' | '));}
  else console.log('✅',d.id,'ok');
}
console.log('bad =',bad,' total =',docs.length);
await c.close();
