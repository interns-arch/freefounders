import type { GstParty, InvoiceLineInput } from '../db/schema';

/** States and union territories (GST place of supply). */
export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
] as const;

/** The official spelling of a state, whatever its case; null when unknown. */
export function stateName(input: string | null | undefined): string | null {
  const v = (input ?? '').trim().toLowerCase();
  return INDIAN_STATES.find((s) => s.toLowerCase() === v) ?? null;
}

/** 15 characters: state code, PAN, entity number, Z, check character. */
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** SAC for "online software / SaaS" (licensing services for the right to use computer software). */
export const SAC_SAAS = '997331';
export const GST_RATE = 18;

/** Who sells (env, with clearly fake defaults for testing). */
export function seller(): GstParty {
  return {
    name: process.env.SELLER_NAME?.trim() || 'FreeFounders Technologies Pvt Ltd (test)',
    gstin: process.env.SELLER_GSTIN?.trim() || '27AAAAA0000A1Z5',
    state: stateName(process.env.SELLER_STATE) ?? 'Maharashtra',
    address: process.env.SELLER_ADDRESS?.trim() || 'Test address, Pune, Maharashtra 411001 (not a real business)',
  };
}

export interface Tax {
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  placeOfSupply: string;
}

/** 18 % GST: CGST 9 % + SGST 9 % when the buyer is in the seller's state, else IGST 18 %. Amounts in paise. */
export function gst(lines: InvoiceLineInput[], buyerState: string | null | undefined): Tax {
  const subtotal = Math.max(0, lines.reduce((sum, l) => sum + l.amount, 0));
  const placeOfSupply = stateName(buyerState) ?? seller().state;
  if (placeOfSupply === seller().state) {
    const half = Math.round((subtotal * GST_RATE) / 200);
    return { subtotal, cgst: half, sgst: half, igst: 0, total: subtotal + 2 * half, placeOfSupply };
  }
  const igst = Math.round((subtotal * GST_RATE) / 100);
  return { subtotal, cgst: 0, sgst: 0, igst, total: subtotal + igst, placeOfSupply };
}

/** Indian financial year of a moment (April–March, India time), e.g. "2026-27". */
export function financialYear(at: Date): string {
  const ist = new Date(at.getTime() + 330 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export const invoiceNumber = (fy: string, seq: number) => `FF/${fy}/${String(seq).padStart(6, '0')}`;
