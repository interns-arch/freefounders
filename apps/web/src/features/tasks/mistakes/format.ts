/** "₹12,500" (Indian grouping) for a loss amount. */
export const rupees = (v: number | string | null | undefined) => `₹${Number(v ?? 0).toLocaleString('en-IN')}`;
