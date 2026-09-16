// Arithmetic mean; NaN on an empty array, so callers decide what an empty window means.
export const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
