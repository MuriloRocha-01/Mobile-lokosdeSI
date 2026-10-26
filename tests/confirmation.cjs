const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const Module = require('node:module')
require.extensions['.ts']=(m,p)=>m._compile(ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,p)
const original=Module._load
let buttons, calls=0
const native={Platform:{OS:'android'},Alert:{alert:(_t,_m,b)=>{buttons=b}}}
Module._load=function(id,...args){return id==='react-native'?native:original.call(this,id,...args)}
const {confirmAction,confirmDestructive}=require('../src/confirm.ts')
confirmAction('Cadastrar?', 'Recebimento R$ 10', 'Confirmar',()=>calls++)
assert.equal(calls,0)
assert.equal(buttons[0].style,'cancel')
assert.equal(buttons[1].style,'default')
buttons[1].onPress(); assert.equal(calls,1)
confirmDestructive('Apagar?', 'Despesa R$ 10', 'Apagar',()=>calls++)
assert.equal(calls,1); assert.equal(buttons[1].style,'destructive')
buttons[1].onPress(); assert.equal(calls,2)
native.Platform.OS='web'
global.confirm=()=>false
confirmAction('Cadastrar?', '', 'Confirmar',()=>calls++)
assert.equal(calls,2)
global.confirm=()=>true
confirmAction('Cadastrar?', '', 'Confirmar',()=>calls++)
assert.equal(calls,3)
console.log('OK: cadastro e exclusão só executam após confirmação; cancelar não altera registros.')
