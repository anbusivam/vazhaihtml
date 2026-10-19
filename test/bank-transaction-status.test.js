const test = require('node:test');
const assert = require('node:assert/strict');
const { getTransactionStatuses } = require('../netlify/functions/bank-transaction-status');

const existingPaymentIds = ['pay-created'];

const cases = [
  {
    name: 'unmatched deposit needs a payment',
    txn: { deposit: '1000', narration: 'DONOR TRANSFER' },
    expected: ['needs-payment'],
  },
  {
    name: 'valid payment ID is payment created',
    txn: { deposit: '1000', paymentId: 'pay-created' },
    expected: ['payment-created'],
  },
  {
    name: 'orphaned deposit still needs a payment',
    txn: { deposit: '1000', paymentId: 'missing-payment', narration: 'NEFT-AXIS RAZORPAY PAYMENTS PVT LTD PA' },
    expected: ['needs-payment'],
  },
  {
    name: 'unlinked withdrawal needs an expense',
    txn: { withdrawal: '250', narration: 'BANK CHARGE' },
    expected: ['needs-expense'],
  },
  {
    name: 'withdrawal with an expense is expense created',
    txn: { withdrawal: '250', expenseKeys: ['expense-1'] },
    expected: ['expense-created'],
  },
  {
    name: 'Razorpay settlement is other',
    txn: { deposit: '1000', narration: 'NEFT-AXIS 123 RAZORPAY PAYMENTS PVT LTD PA' },
    expected: ['other'],
  },
  {
    name: 'prefixed and truncated Razorpay settlement is other',
    txn: { deposit: '1000', narration: 'Dep-NEFT-AXISCN1391305436-RAZORPAY PAYMENTS PVT LT' },
    expected: ['other'],
  },
  {
    name: 'interest and tax entry is other',
    txn: { deposit: '10', narration: 'INT: INTEREST TAX: 1' },
    expected: ['other'],
  },
  {
    name: 'record with no actionable amount is other',
    txn: { narration: 'OPENING BALANCE' },
    expected: ['other'],
  },
  {
    name: 'a transaction can correctly match both payment and expense work',
    txn: { deposit: '1000', withdrawal: '250', narration: 'COMBINED ENTRY' },
    expected: ['needs-payment', 'needs-expense'],
  },
  {
    name: 'a transaction can correctly match both created records',
    txn: { deposit: '1000', withdrawal: '250', paymentId: 'pay-created', expenseKeys: ['expense-1'] },
    expected: ['payment-created', 'expense-created'],
  },
];

test('every transaction belongs to at least one status filter', () => {
  for (const { name, txn } of cases) {
    const statuses = getTransactionStatuses(txn, existingPaymentIds);
    assert.ok(statuses.length > 0, `${name} was missed by every status filter`);
  }
});

test('transaction status filters classify records correctly', () => {
  for (const { name, txn, expected } of cases) {
    assert.deepEqual(getTransactionStatuses(txn, existingPaymentIds), expected, name);
  }
});
