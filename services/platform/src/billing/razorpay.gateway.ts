import { NotImplementedException } from '@nestjs/common';
import type { CheckoutRequest, GatewayEvent, PaymentGateway, RenewalCharge } from './gateway';

/**
 * Razorpay (PLAN.md §20.6). NOT WIRED: a stub so the interface is clear. To finish after the founder's Razorpay KYC:
 * - TODO createCheckout: create a Razorpay Order (amount in paise, receipt = sessionId, notes.companyId) or a
 *   Subscription (plan per price, quantity = seats, UPI Autopay / e-mandate) and return Razorpay Checkout's URL or the
 *   order id for the web's Checkout.js.
 * - TODO verifyWebhook: HMAC-SHA256 of the raw body with RAZORPAY_WEBHOOK_SECRET, compared in constant time with the
 *   `x-razorpay-signature` header; map `payment.captured`, `payment.failed`, `subscription.charged/pending/halted/
 *   cancelled`, `invoice.paid` to GatewayEvent (event id = `x-razorpay-event-id`).
 * - TODO chargeRenewal: renewals arrive as `subscription.charged` / `payment.failed` webhooks instead of a call.
 * - TODO a nightly job comparing our subscriptions with Razorpay's (missed webhooks).
 * Keys: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET (never in the repo).
 */
export class RazorpayGateway implements PaymentGateway {
  readonly name = 'razorpay';

  async createCheckout(_req: CheckoutRequest): Promise<{ checkoutUrl: string }> {
    throw new NotImplementedException('Razorpay is not connected yet');
  }

  verifyWebhook(_headers: Record<string, string | string[] | undefined>, _rawBody: Buffer): GatewayEvent {
    throw new NotImplementedException('Razorpay is not connected yet');
  }

  async chargeRenewal(_charge: RenewalCharge): Promise<{ ok: boolean; paymentId: string; reason?: string }> {
    throw new NotImplementedException('Razorpay is not connected yet');
  }
}
