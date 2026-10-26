import type { PaymentMethod, FinanceCard } from './types'
export const PAYMENT_METHODS: { id: PaymentMethod; label: string }[] = [
  { id: 'credit_card', label: 'Cartão de crédito' },
  { id: 'debit_card', label: 'Cartão de débito' },
  { id: 'cash', label: 'Dinheiro' },
  { id: 'pix', label: 'Pix' },
  { id: 'meal_voucher', label: 'Vale-alimentação' },
]
export const paymentLabel = (method: PaymentMethod | null) => PAYMENT_METHODS.find((option) => option.id === method)?.label ?? 'Não informado'
export const requiresCard = (method: PaymentMethod | null) => method === 'credit_card' || method === 'debit_card' || method === 'meal_voucher'
export const cardLabel = (card: FinanceCard) => card.name + (card.last_four ? ' •••• ' + card.last_four : '')
