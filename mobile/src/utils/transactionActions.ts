import { deleteTransaction, errorMessage } from '../services/api'
import { confirmDestructive } from './confirm'
import { brl } from './format'
import { tap, warning } from './haptics'
import type { Transaction } from '../@types/api'

/**
 * Pergunta e, se a pessoa confirmar, apaga a transação (usado pela tela Finanças e pelo Extrato).
 * `onDone` roda depois de apagar; `onError` recebe a mensagem se o servidor recusar.
 */
export function confirmDeleteTransaction(item: Transaction, onDone: () => void, onError: (message: string) => void): void {
  confirmDestructive('Apagar transação?', `“${item.description}” · ${brl(item.amount)}`, 'Apagar', () => {
    void (async () => {
      try {
        await deleteTransaction(item.id)
        tap()
        onDone()
      } catch (err) {
        warning()
        onError(errorMessage(err))
      }
    })()
  })
}
