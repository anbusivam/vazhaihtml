function getTransactionStatuses(txn, existingPaymentIds) {
  const paymentIds = Array.isArray(existingPaymentIds) ? existingPaymentIds : [];
  const deposit = Number(txn.deposit);
  const withdrawal = Number(txn.withdrawal);
  const hasDeposit = deposit > 0;
  const hasWithdrawal = withdrawal > 0;
  const hasCreatedPayment = Boolean(txn.paymentId) && paymentIds.includes(txn.paymentId);
  const isOrphanPayment = Boolean(txn.paymentId) && !hasCreatedPayment;
  const hasExpense = Array.isArray(txn.expenseKeys) && txn.expenseKeys.length > 0;

  const narration = String(txn.narration || '').toUpperCase();
  const isRazorpayNeft = /(?:^|[\s-])(?:DEP[-\s]*)?NEFT[-\s]*AXIS.*RAZORPAY\s+PAYMENTS\s+PVT\s+LT(?:D)?(?:\b|$)/i.test(narration);
  const isRazorpaySettlement = isRazorpayNeft ||
    (narration.startsWith('NEFT-AXIS') && narration.includes('RAZORPAY SOFTWARE PRIVATE'));
  const isFeeOrTaxEntry =
    (narration.includes('INT:') || narration.includes('CHARGES FOR :')) && narration.includes('TAX:');

  const needsPayment = hasDeposit && !hasCreatedPayment &&
    (isOrphanPayment || (!isRazorpaySettlement && !isFeeOrTaxEntry));
  const needsExpense = hasWithdrawal && !hasExpense;
  const statuses = [];

  if (needsPayment) statuses.push('needs-payment');
  if (hasCreatedPayment) statuses.push('payment-created');
  if (needsExpense) statuses.push('needs-expense');
  if (hasExpense) statuses.push('expense-created');
  if (statuses.length === 0) statuses.push('other');

  return statuses;
}

module.exports = { getTransactionStatuses };
