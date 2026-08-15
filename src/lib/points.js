export function pointsFromColones(amountColones) {
  const amount = Math.floor(Number(amountColones));
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.floor(amount / 100);
}

