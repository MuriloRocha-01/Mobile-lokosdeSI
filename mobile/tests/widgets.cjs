const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')
for (const ext of ['.ts','.tsx']) require.extensions[ext] = (module, path) => module._compile(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,path)
const widgets = Object.assign({}, ...['FlexWidget','TextWidget','ListWidget'].map(name => require('react-native-android-widget/lib/commonjs/widgets/'+name)))
const { buildWidgetTree } = require('react-native-android-widget/lib/commonjs/api/build-widget-tree')
const originalLoad = Module._load
Module._load = function(name,parent,isMain) {
  if (name === 'react-native-android-widget') return widgets
  if (name === '../storage') return {getItem: async () => null}
  return originalLoad.call(this,name,parent,isMain)
}
const { FinancialWidget } = require('../src/services/widgets/native.tsx')
Module._load = originalLoad
const data = {month:'2026-10',balance:75,income:100,expense:25,recent:[{id:1,description:'Almoço',date:'2026-10-16',time:'12:35',amount:25}],days:[{date:'2026-10-16',income:100,expense:25}]}
for (const widgetName of ['FinanceSummary','FinanceAgenda']) {
  for (const state of [{token:null,message:'Entre no aplicativo'}, {token:'test',data,updated:'12:40'}, {token:'test',data:{...data,recent:[]},updated:'12:40'}]) {
    const tree = buildWidgetTree(FinancialWidget({info:{widgetName,width:280,height:300},state}))
    const serialized = JSON.stringify(tree)
    assert.ok(serialized.includes('ecossistema://widget/expense'))
    assert.ok(serialized.includes('ecossistema://widget/income'))
    if (state.data) assert.ok(serialized.includes('R$ 75,00'))
    else assert.ok(!serialized.includes('R$'))
  }
}
console.log('OK: renderizador real dos dois widgets, estados vazios, login e atalhos.')
