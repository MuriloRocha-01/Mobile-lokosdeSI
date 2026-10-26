/** Divide em centavos; as primeiras parcelas recebem o resto da divisão. */
export function installmentPreview(amount: number, countText: string, paymentText: string, withInterest: boolean) {
  const count = /^\d{1,3}$/.test(countText) ? Number(countText) : 0
  if (!Number.isFinite(amount) || amount <= 0 || count < 2 || count > 120) return null
  const principal = Math.round(amount * 100)
  const payment = /^\d+(?:[.,]\d{1,2})?$/.test(paymentText) ? Math.round(Number(paymentText.replace(',', '.')) * 100) : 0
  const total = withInterest ? payment * count : principal
  if (total < principal || total > 99999999999 || Math.floor(total / count) < 1) return null
  return { count, total: total / 100, interest: (total - principal) / 100, first: Math.ceil(total / count) / 100, last: Math.floor(total / count) / 100, payment: payment / 100 }
}
