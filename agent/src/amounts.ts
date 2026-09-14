export const MIST_PER_SUI = 1_000_000_000;

/** Reject rounding, fractional MIST, and numbers that cannot be represented safely. */
export function toMist(value: number | string): bigint {
  const decimal = typeof value === "number" ? value.toFixed(9) : value;
  if (!/^\d+(\.\d{1,9})?$/.test(decimal) ||
      (typeof value === "number" && (!Number.isFinite(value) || Number(decimal) !== value))) {
    throw new Error("금액은 소수점 9자리 이내의 양수여야 합니다.");
  }
  const [whole, fraction = ""] = decimal.split(".");
  const mist = BigInt(whole!) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
  if (mist <= 0n || mist > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("금액이 지원 범위를 벗어났습니다.");
  }
  return mist;
}

export const toSui = (mist: bigint | number | string): number => Number(mist) / MIST_PER_SUI;
