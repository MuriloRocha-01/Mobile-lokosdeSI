"use no memo";
import { FlexWidget, TextWidget, ListWidget, registerWidgetTaskHandler, requestPinWidget, requestWidgetUpdate, getWidgetInfo } from 'react-native-android-widget'
import type { WidgetInfo } from 'react-native-android-widget'
import { getItem } from '../storage'
import { canRestoreSession, SERVER_URL } from '../../config/server'
import { todayIso, brl } from '../../utils/format'
import { validSnapshot, type WidgetSnapshot } from './model'

const names = ['FinanceSummary', 'FinanceAgenda']
const link = (path: string) => ({ clickAction: 'OPEN_URI', clickActionData: { uri: 'ecossistema://widget/' + path } })
const muted = '#a1a1aa', white = '#fafafa', red = '#f87171', green = '#2dd4bf'
type State = { data?: WidgetSnapshot; message?: string; updated?: string; token: string | null }
let generation = 0

async function sessionToken() {
  const server = await getItem('ecossistema.server')
  return canRestoreSession(server) ? getItem('ecossistema.token') : null
}
async function load(): Promise<State> {
  const token = await sessionToken()
  if (!token) return { token, message: 'Entre no aplicativo para ver suas finanças.' }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(SERVER_URL + '/finance/widget?today=' + todayIso(), { headers: { Authorization: 'Bearer ' + token }, signal: controller.signal })
    if (response.status === 401) return { token, message: 'Sessão expirada. Abra o app e entre novamente.' }
    if (!response.ok) throw new Error('Não disponível')
    const data: unknown = await response.json()
    if (!validSnapshot(data)) throw new Error('Resposta inválida')
    return { token, data, updated: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }
  } catch { return { token, message: 'Não foi possível atualizar. Confira a conexão e toque em Atualizar.' } }
  finally { clearTimeout(timeout) }
}
export function FinancialWidget({ info, state }: { info: Pick<WidgetInfo, 'widgetName' | 'height' | 'width'>; state: State }) {
  const agenda = info.widgetName === 'FinanceAgenda'
  const data = state.data
  return <FlexWidget style={{ width: 'match_parent', height: 'match_parent', backgroundColor: '#0f111a', borderRadius: 22, padding: 14 }}>
    <FlexWidget style={{ flexDirection: 'row', justifyContent: 'space-between', width: 'match_parent', marginBottom: 8 }}>
      <TextWidget text={agenda ? 'Agenda financeira' : 'Meu saldo'} style={{ color: white, fontSize: 16, fontWeight: 'bold' }} {...link('home')} />
      <TextWidget text="Atualizar" style={{ color: green, fontSize: 12, padding: 6 }} clickAction="refresh" accessibilityLabel="Atualizar widget" />
    </FlexWidget>
    {!data ? <TextWidget text={state.message ?? 'Abra o aplicativo.'} style={{ color: muted, fontSize: 14, paddingVertical: 16 }} {...link('home')} /> : <FlexWidget style={{ width: 'match_parent' }}>
      <TextWidget text={brl(data.balance)} style={{ color: white, fontSize: 27, fontWeight: 'bold', adjustsFontSizeToFit: true }} {...link('home')} />
      <TextWidget text={'Saldo até hoje · ' + data.month.slice(5) + '/' + data.month.slice(0,4)} style={{ color: muted, fontSize: 11, marginBottom: 8 }} />
      {agenda ? <FlexWidget style={{ width: 'match_parent' }}>
        <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', marginBottom: 6, paddingHorizontal: 4 }}>
          <TextWidget text="Dia" style={{ color: muted, fontSize: 11, width: 28 }} />
          <TextWidget text="+ Receitas" style={{ color: green, fontSize: 11, width: Math.max(80, (info.width - 64) / 2) }} />
          <TextWidget text="− Despesas" style={{ color: red, fontSize: 11 }} />
        </FlexWidget>
        <ListWidget style={{ height: Math.max(64, info.height - 205), width: 'match_parent' }}>
          {data.days.map(day => <FlexWidget key={day.date} style={{ flexDirection: 'row', width: 'match_parent', paddingVertical: 8, paddingHorizontal: 4, backgroundColor: day.date === todayIso() ? '#27272a' : '#0f111a' }} {...link('day/' + day.date)}>
            <TextWidget text={day.date.slice(8)} style={{ color: white, fontSize: 13, width: 28 }} />
            <TextWidget text={'+' + brl(day.income)} style={{ color: green, fontSize: 12, width: Math.max(80, (info.width - 64) / 2), adjustsFontSizeToFit: true }} />
            <TextWidget text={'−' + brl(day.expense)} style={{ color: red, fontSize: 12, width: Math.max(80, (info.width - 64) / 2), adjustsFontSizeToFit: true }} />
          </FlexWidget>)}
        </ListWidget>
      </FlexWidget> : <FlexWidget style={{ width: 'match_parent' }}>
        <TextWidget text="Últimas despesas do mês" style={{ color: muted, fontSize: 12, marginBottom: 5 }} />
        <ListWidget style={{ height: Math.max(64, info.height - 205), width: 'match_parent' }}>
          {data.recent.length ? data.recent.map(item => <FlexWidget key={item.id} style={{ paddingVertical: 7, width: 'match_parent' }} {...link('day/' + item.date)}>
            <TextWidget text={'− ' + brl(item.amount) + '  ' + item.description} style={{ color: red, fontSize: 13, fontWeight: 'bold' }} maxLines={1} />
            <TextWidget text={item.date.slice(8) + '/' + item.date.slice(5,7) + ' · ' + (item.time ?? 'Horário não informado')} style={{ color: muted, fontSize: 11 }} />
          </FlexWidget>) : <TextWidget text="Nenhuma despesa neste mês." style={{ color: muted, fontSize: 13 }} />}
        </ListWidget>
      </FlexWidget>}
      <TextWidget text={'Atualizado às ' + state.updated} style={{ color: muted, fontSize: 10, marginTop: 6 }} />
    </FlexWidget>}
    <FlexWidget style={{ flexDirection: 'row', justifyContent: 'space-between', width: 'match_parent', marginTop: 10 }}>
      <TextWidget text="− Despesa" style={{ color: red, fontSize: 13, padding: 9, backgroundColor: '#27272a', borderRadius: 12 }} {...link('expense')} />
      <TextWidget text="+ Receita" style={{ color: green, fontSize: 13, padding: 9, backgroundColor: '#27272a', borderRadius: 12 }} {...link('income')} />
    </FlexWidget>
  </FlexWidget>
}
async function safeState(state: State, version: number): Promise<State> {
  return version === generation && state.token === await sessionToken() ? state : { token: null, message: 'Abra o aplicativo para continuar.' }
}
export function registerWidgets() {
  registerWidgetTaskHandler(async props => {
    if (props.widgetAction === 'WIDGET_DELETED' || !names.includes(props.widgetInfo.widgetName)) return
    const version = generation
    const state = await safeState(await load(), version)
    props.renderWidget(<FinancialWidget info={props.widgetInfo} state={state} />)
  })
}
export async function refreshWidgets() {
  const existing = await Promise.all(names.map(getWidgetInfo))
  if (existing.every(items => items.length === 0)) return
  const version = generation
  const state = await safeState(await load(), version)
  for (const widgetName of names) await requestWidgetUpdate({ widgetName, renderWidget: async info => <FinancialWidget info={info} state={await safeState(state, version)} /> })
}
export async function clearWidgets() {
  generation++
  for (const widgetName of names) await requestWidgetUpdate({ widgetName, renderWidget: info => <FinancialWidget info={info} state={{ token: null, message: 'Entre no aplicativo para ver suas finanças.' }} /> })
}
export const pinWidget = (widgetName: string) => requestPinWidget({ widgetName })
