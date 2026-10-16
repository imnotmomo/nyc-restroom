export interface RatingTotals { ratingCount: number; ratingSum: number }

export function isValidStars(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value * 2) && value >= 1 && value <= 5;
}

export function isValidRatingTotals(value: RatingTotals): boolean {
  return Number.isInteger(value.ratingCount) && value.ratingCount >= 0 && value.ratingCount <= 1_000_000
    && typeof value.ratingSum === "number" && Number.isInteger(value.ratingSum * 2) && value.ratingSum >= value.ratingCount
    && value.ratingSum <= value.ratingCount * 5;
}

export function applyRatingChange(totals: RatingTotals, previous: number | null, next: number | null): RatingTotals {
  if (!isValidRatingTotals(totals) || (previous !== null && !isValidStars(previous)) || (next !== null && !isValidStars(next))) {
    throw new Error("The rating data couldn’t be read safely. Please reload before trying again.");
  }
  const result = {
    ratingCount: totals.ratingCount + (next === null ? 0 : 1) - (previous === null ? 0 : 1),
    ratingSum: totals.ratingSum + (next ?? 0) - (previous ?? 0),
  };
  if (!isValidRatingTotals(result)) throw new Error("The rating totals need to be checked before another rating can be saved.");
  return result;
}
