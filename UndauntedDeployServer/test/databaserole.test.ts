import './setup';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
test('database-only role refuses deploy service startup before listening',()=>{
 const result=spawnSync(process.execPath,[path.resolve(__dirname,'../src/server.js')],{
  env:{...process.env,SERVER_ROLE:'database-only',PORT:'0'},encoding:'utf8',timeout:5000
 });
 assert.equal(result.status,1);
 assert.match(result.stderr,/Deploy service disabled on database-only node/);
});
