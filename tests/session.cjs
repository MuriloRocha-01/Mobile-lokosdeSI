const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (m,p) => m._compile(ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,p)
const api = require('../src/api.ts')
const reply = (status, body) => new Response(JSON.stringify(body),{status})
async function main() {
 let renewals=0, logouts=0, saved=0, writes=0
 api.configureApi({baseUrl:'https://test.invalid',token:'expired',refreshToken:'refresh-test',onUnauthorized:()=>logouts++,onRenewed:async()=>{saved++}})
 global.fetch=async (url,init)=>{
  if(url.endsWith('/auth/refresh')) { renewals++; await new Promise(r=>setTimeout(r,15)); return reply(200,{access_token:'new'}) }
  if(init.headers.Authorization==='Bearer expired') return reply(401,{})
  writes++; return reply(200,{id:1})
 }
 await Promise.all([api.getMe(),api.getMe(),api.createTransaction({type:'expense',amount:10,category_id:1,date:'2026-10-20'})])
 assert.deepEqual([renewals,logouts,saved,writes],[1,0,1,3])
 api.configureApi({token:'expired',refreshToken:'refresh-test'})
 global.fetch=async url=>{ if(url.endsWith('/auth/refresh')) throw new Error('offline'); return reply(401,{}) }
 await assert.rejects(api.getMe()); assert.equal(logouts,0)
 global.fetch=async()=>reply(401,{})
 await assert.rejects(api.getMe()); assert.equal(logouts,1)
 api.configureApi({token:'expired',refreshToken:'refresh-test'})
 let release
 global.fetch=async url=>url.endsWith('/auth/refresh') ? new Promise(r=>{release=r}) : reply(401,{})
 const inFlight=api.getMe()
 while(!release) await new Promise(r=>setTimeout(r,1))
 api.configureApi({token:null,refreshToken:null})
 release(reply(200,{access_token:'must-not-restore'}))
 await assert.rejects(inFlight); assert.equal(saved,1)
 console.log('Session renewal: concurrency, offline, rejection and logout race passed')
}
main().catch(e=>{console.error(e);process.exitCode=1})
