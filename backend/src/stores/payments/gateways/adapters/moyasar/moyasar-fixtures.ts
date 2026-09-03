/**
 * ==================================================================
 * Official Moyasar documentation fixtures
 * ==================================================================
 *
 * Transcribed from Moyasar's published examples so the specs assert
 * against Moyasar's own payloads rather than payloads we imagined.
 *
 * Sources, all accessed 2026-08-19:
 *   https://docs.moyasar.com/api/invoices/01-create-invoice
 *     (201 response example, including the embedded payment object)
 *   https://docs.moyasar.com/api/other/webhooks/webhook-reference
 *     (the webhook object's attribute table and worked example)
 *   https://docs.moyasar.com/api/errors
 *     (documented error bodies)
 *   https://docs.moyasar.com/api/payments/payment-status-reference
 *
 * Test-only module: not imported by any production file.
 */

/** The 201 response of Create Invoice, trimmed to the fields we read. */
export const CREATE_INVOICE_RESPONSE = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  status: 'initiated',
  amount: 100,
  currency: 'SAR',
  description: 'Radiator leak fix',
  logo_url: 'https://example.com/default.png',
  amount_format: '1.00 SAR',
  url: 'http://checkout.moyasar.com/invoices/efebc231-7795-4cfd-b69c-980fe4c02c49?lang=en',
  callback_url:
    'https://example.com/process/invoice-paid-notification/8e15b386-e0a9-420f-8167-e363818f6b35',
  created_at: '2026-05-20T10:00:00Z',
  updated_at: '2026-05-20T10:00:00Z',
  payments: [] as unknown[],
  metadata: {},
}

/**
 * The payment object as it appears on an invoice and in webhooks.
 *
 * Field names and semantics from the Create Invoice response schema;
 * `status` values from the Payment Status Reference.
 */
export const PAID_PAYMENT = {
  id: '8e15b386-e0a9-420f-8167-e363818f6b35',
  status: 'paid',
  amount: 100,
  fee: 0,
  currency: 'SAR',
  refunded: 0,
  refunded_at: null,
  captured: 0,
  captured_at: null,
  voided_at: null,
  description: 'Kindle Whitepaper',
  amount_format: '1.00 SAR',
  invoice_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  callback_url: 'https://example.com/checkout/payer-return',
  created_at: '2026-05-20T10:00:00Z',
  updated_at: '2026-05-20T10:01:00Z',
  metadata: { cart_id: '72e470a5-cbc4-47b3-a52a-e89fda6adb19' },
  source: {
    type: 'creditcard',
    company: 'mada',
    name: 'John Doe',
    number: '4111-11XX-XXXX-1111',
    message: 'Approved',
    transaction_url: null,
  },
}

/**
 * A webhook envelope, built to the documented attribute table:
 * id, type, created_at, secret_token, account_name, live, data.
 */
export function webhookEvent(over: {
  type?: string
  secretToken?: string
  live?: boolean
  data?: unknown
  id?: string
} = {}) {
  return {
    id: over.id ?? 'aaf1e0b6-1d0e-4a6a-9d64-2e6c0a17c1de',
    type: over.type ?? 'payment_paid',
    created_at: '2026-05-20T10:01:00Z',
    secret_token: over.secretToken ?? 'moyasar-webhook-secret',
    account_name: 'My Store',
    live: over.live ?? false,
    data: over.data ?? PAID_PAYMENT,
  }
}

/** Documented error bodies, quoted from the Errors page. */
export const DOCUMENTED_ERRORS = {
  /** 401. */
  invalidKey: {
    type: 'authentication_error',
    message: 'Invalid authorization credentials',
    errors: null,
  },
  /** 400. */
  validationFailed: {
    type: 'invalid_request_error',
    message: 'Validation Failed',
    errors: { amount: ['must be an integer'] },
  },
  /** From the Create Invoice 400 example. */
  invalidRequest: {
    type: 'invalid_request',
    message: null,
    errors: { foo: 'this is returned for validation errors only' },
  },
}

/** The complete documented event list, from GET /webhooks/available_events. */
export const AVAILABLE_EVENTS = [
  'payment_paid',
  'payment_failed',
  'payment_voided',
  'payment_authorized',
  'payment_captured',
  'payment_refunded',
  'payment_abandoned',
  'payment_verified',
  'card_auth_authenticated',
  'card_auth_failed',
]
