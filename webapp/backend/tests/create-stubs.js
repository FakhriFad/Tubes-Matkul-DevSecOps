#!/usr/bin/env node
/**
 * Creates minimal test stub packages in backend/node_modules/
 * so unit tests can run without `npm install`.
 * Run: node tests/create-stubs.js
 * Called automatically by: make test
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const NM = path.resolve(__dirname, '../node_modules');

function writeStub(pkg, indexContent) {
  const dir = path.join(NM, pkg);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.js'), indexContent);
  fs.writeFileSync(path.join(dir, 'package.json'),
    JSON.stringify({ name: pkg, version: '0.0.1-stub', main: 'index.js' }));
}

// ── jsonwebtoken ──────────────────────────────────────────────────────────────
writeStub('jsonwebtoken', `'use strict';
let _verify = () => ({ id: 'user-1', email: 'a@b.com', role: 'customer' });
module.exports = {
  sign:        (_p, _s, _o) => 'stub-token',
  verify:      (...a)       => _verify(...a),
  decode:      (_t)         => ({ exp: Math.floor(Date.now()/1000)+3600 }),
  __setVerify: (fn)         => { _verify = fn; },
  __reset:     ()           => { _verify = () => ({ id:'user-1', email:'a@b.com', role:'customer' }); },
};
`);

// ── ioredis ───────────────────────────────────────────────────────────────────
const ioredisDir = path.join(NM, 'ioredis', 'built');
fs.mkdirSync(ioredisDir, { recursive: true });
fs.writeFileSync(path.join(NM, 'ioredis', 'package.json'),
  JSON.stringify({ name: 'ioredis', version: '0.0.1-stub', main: 'built/index.js' }));
fs.writeFileSync(path.join(ioredisDir, 'index.js'), `'use strict';
class Redis {
  constructor() { this._store = {}; }
  async get(k)              { return this._store[k] ?? null; }
  async set(k,v)            { this._store[k]=String(v); return 'OK'; }
  async setex(k,_ttl,v)     { this._store[k]=String(v); return 'OK'; }
  async del(k)              { delete this._store[k]; return 1; }
  async incr(k)             { this._store[k]=String((parseInt(this._store[k]||'0')+1)); return parseInt(this._store[k]); }
  async expire(k,_ttl)      { return 1; }
  async ping()              { return 'PONG'; }
  on(ev, fn) { if(ev==='connect') setImmediate(fn); return this; }
  reset()    { this._store={}; }
}
module.exports = Redis;
`);

// ── bcrypt ────────────────────────────────────────────────────────────────────
writeStub('bcrypt', `'use strict';
module.exports = {
  hash:    async (v,_r) => 'hashed:'+v,
  compare: async (p,h)  => h==='hashed:'+p,
  genSalt: async (r)    => 'salt:'+r,
};
`);

// ── otplib ────────────────────────────────────────────────────────────────────
writeStub('otplib', `'use strict';
module.exports = {
  authenticator: {
    generateSecret: () => 'TESTSECRET32',
    keyuri: (e,a,s)    => 'otpauth://totp/'+a+':'+e+'?secret='+s,
    verify: ({token})  => token === '123456',
  },
};
`);

// ── prom-client ───────────────────────────────────────────────────────────────
writeStub('prom-client', `'use strict';
const noop = ()=>{};
class Registry { contentType='text/plain'; async metrics(){return '';} }
class Counter   { constructor(){} inc(){}  reset(){} }
class Histogram { constructor(){} observe(){} startTimer(){return noop;} }
class Gauge     { constructor(){} set(){} inc(){} dec(){} }
module.exports = { Registry, Counter, Histogram, Gauge, collectDefaultMetrics: noop };
`);

// ── trivial stubs (express, helmet, etc.) ─────────────────────────────────────
const trivial = {
  'express': `'use strict';
const fn=()=>{const a={};a.use=()=>a;a.get=()=>a;a.post=()=>a;a.put=()=>a;a.patch=()=>a;a.delete=()=>a;a.set=()=>a;a.listen=(_p,cb)=>{if(cb)cb();return a;};return a;};
fn.Router=()=>{const r={};r.get=()=>r;r.post=()=>r;r.put=()=>r;r.patch=()=>r;r.delete=()=>r;r.use=()=>r;return r;};
fn.json=()=>((_,__,n)=>n&&n());fn.urlencoded=()=>((_,__,n)=>n&&n());
module.exports=fn;`,
  'express-validator': `'use strict';
const c=()=>{const x={notEmpty:()=>x,isEmail:()=>x,isLength:()=>x,matches:()=>x,withMessage:()=>x,trim:()=>x,normalizeEmail:()=>x,optional:()=>x,isFloat:()=>x,isInt:()=>x,isUUID:()=>x,isURL:()=>x,isString:()=>x,escape:()=>x,toInt:()=>x};return x;};
module.exports={body:c,param:c,query:c,validationResult:()=>({isEmpty:()=>true,array:()=>[]})};`,
  'express-rate-limit': `'use strict'; module.exports=()=>((_,__,n)=>n&&n());`,
  'helmet':   `'use strict'; module.exports=()=>((_,__,n)=>n&&n());`,
  'cors':     `'use strict'; module.exports=()=>((_,__,n)=>n&&n());`,
  'morgan':   `'use strict'; module.exports=()=>((_,__,n)=>n&&n());`,
  'dotenv':   `'use strict'; module.exports={config:()=>{}};`,
  'pg':       `'use strict'; class Pool{async query(){return{rows:[]};} async connect(){return{query:async()=>({rows:[]}),release:()=>{}};} on(){}} module.exports={Pool};`,
  'winston':  `'use strict'; const n=()=>{}; const l={info:n,warn:n,error:n,http:n,debug:n}; module.exports={createLogger:()=>l,format:{combine:()=>{},timestamp:()=>{},errors:()=>{},json:()=>{},colorize:()=>{},simple:()=>{}},transports:{Console:function(){}}};`,
  'uuid':     `'use strict'; let c=0; module.exports={v4:()=>'test-uuid-'+(++c)};`,
};

for (const [pkg, code] of Object.entries(trivial)) {
  writeStub(pkg, code);
}

console.log(`Test stubs created in ${NM}`);
