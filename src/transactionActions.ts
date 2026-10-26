import { refreshWidgets } from './widgets'
import { deleteTransaction, errorMessage } from './api'
import { confirmDestructive } from './confirm'
import { brl } from './format'
import { tap, warning } from './haptics'
import type { Transaction } from './types'

/**
 * Pergunta e, se a pessoa confirmar, apaga a transação (usado pela tela Finanças e pelo Extrato).
 * `onDone` roda depois de apagar; `onError` recebe a mensagem se o servidor recusar.
 */
export function confirmDeleteTransaction(item: Transaction, onDone: () => void, onError: (message: string) => void): void {
  confirmDestructive('Apagar transação?', `“${item.description}” · ${brl(item.amount)}${item.recurrence !== 'none' ? '\nIsso também encerra as repetições futuras. Os lançamentos já gerados serão mantidos.' : '\nSomente este lançamento será excluído.'}`, 'Apagar', () => {
    void (async () => {
      try {
        await deleteTransaction(item.id)
        void refreshWidgets().catch(() => {})
        tap()
        onDone()
      } catch (err) {
        warning()
        onError(errorMessage(err))
      }
    })()
  })
}
