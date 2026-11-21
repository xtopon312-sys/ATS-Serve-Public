interface InputAdapter {
  toStored: (amount: number) => number;
  toDisplay: (amount: number) => number;
  formatInput: (amount: number) => string;
}

export function remainingPaymentInput(
  amounts: string[],
  selectedIndex: number,
  total: number,
  wallet: number,
  minorFactor: number,
  adapter: InputAdapter,
): string {
  const allocated = amounts.reduce((sum, amount, index) => index === selectedIndex
    ? sum
    : sum + Math.round(adapter.toStored(Number(amount) || 0) * minorFactor), Math.round(wallet * minorFactor));
  const due = Math.max(0, Math.round(total * minorFactor) - allocated);
  return due > 0 ? adapter.formatInput(adapter.toDisplay(due / minorFactor)) : '';
}
