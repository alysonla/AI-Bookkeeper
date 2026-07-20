export function formatCurrency(amount: number, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amount);
}

export function parseCurrencyAmount(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value !== 'string') {
    throw new Error(`Expected currency amount to be a string or number, received ${typeof value}`);
  }

  const normalized = value.replace(/[$,]/g, '').trim();
  const amount = Number(normalized);

  if (!Number.isFinite(amount)) {
    throw new Error(`Invalid currency amount: ${value}`);
  }

  return amount;
}
