import pg from 'pg';
const {Pool}=pg;
let _pool=null; 
export function getPgPool(){
  if(_pool)return _pool;
  const connectionString=process.env.DATABASE_URL;
  if(!connectionString)throw new Error('DATABASE_URL is not defined');
  _pool=new Pool({
    connectionString,
    max:5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  return _pool;
}