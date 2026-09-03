/**
 * ==================================================================
 * Official Paymob documentation fixtures
 * ==================================================================
 *
 * Transcribed from Paymob's published examples so the specs assert
 * against Paymob's own payloads rather than against payloads we
 * imagined. Nothing here is invented; where a field was redacted in the
 * docs (`xxxx`), it is omitted rather than filled in.
 *
 * Sources, all accessed 2026-08-19:
 *   https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac
 *     → Transaction callbacks (processed callback example, response
 *       callback query string), HMAC (worked example)
 *   https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention
 *     (201 response example, documented error bodies)
 *   https://developers.paymob.com/paymob-docs/developers/manage-payment-apis/*
 *     (documented error bodies)
 *
 * Test-only module: not imported by any production file.
 */

/**
 * The transaction-processed (POST) callback example, trimmed to the
 * fields this adapter reads plus every field the HMAC covers.
 */
export const PROCESSED_CALLBACK = {
  type: 'TRANSACTION',
  obj: {
    id: 192036465,
    pending: false,
    amount_cents: 100000,
    success: true,
    is_auth: false,
    is_capture: false,
    is_standalone_payment: true,
    is_voided: false,
    is_refunded: false,
    is_3d_secure: true,
    integration_id: 4097558,
    profile_id: 164295,
    has_parent_transaction: false,
    created_at: '2024-06-13T11:33:44.592345',
    updated_at: '2024-06-13T11:34:07.272638',
    currency: 'EGP',
    source_data: {
      pan: '2346',
      type: 'card',
      tenure: null,
      sub_type: 'MasterCard',
    },
    error_occured: false,
    refunded_amount_cents: null,
    captured_amount: null,
    is_captured: false,
    is_void: false,
    is_refund: false,
    owner: 302852,
    parent_transaction: null,
    data: { message: 'Approved', txn_response_code: 'APPROVED' },
    order: { id: 217503754, merchant_order_id: null, amount_cents: 100000 },
  },
}

/**
 * The concatenated HMAC string Paymob's documentation produces from the
 * callback above, quoted exactly.
 *
 * This is the single most valuable line in the file: it pins our field
 * order, our boolean spelling and our number formatting to Paymob's own
 * worked example, so a mistake in any of the three fails a test instead
 * of silently rejecting every real callback.
 */
export const DOCUMENTED_HMAC_STRING =
  '1000002024-06-13T11:33:44.592345EGPfalsefalse1920364654097558truefalsefalsefalsetruefalse217503754302852false2346MasterCardcardtrue'

/**
 * The 201 response of the Create Intention API, trimmed to the fields
 * the adapter reads.
 */
export const CREATE_INTENTION_RESPONSE = {
  payment_keys: [
    {
      integration: 158,
      key: 'ZXlKaGJHY2lPaUpJVXpVeE1pSXNJblI1Y0NJNklrcFhWQ0o5',
      gateway_type: 'MIGS',
      iframe_id: null,
      order_id: 265715202,
    },
  ],
  intention_order_id: 265715202,
  id: 'pi_test_bd49bb7fb4da48cfac4ec71ab4d8c433',
  client_secret: 'egy_csk_test_94042f793419c5a0f14a4cadfda9d626',
  intention_detail: { amount: 10, currency: 'EGP' },
  payment_methods: [
    {
      integration_id: 4345907,
      name: 'CardF',
      method_type: 'online',
      currency: 'EGP',
      live: false,
    },
  ],
  special_reference: 'phe4sjw111q-11221-221',
  confirmed: false,
  status: 'intended',
  created: '2024-11-18T13:42:08.456634',
  object: 'paymentintention',
}

/** The transaction-response (GET) callback query string, from the docs. */
export const RESPONSE_CALLBACK_QUERY =
  'id=316004&pending=false&amount_cents=50000&success=true&is_auth=false&is_capture=false&is_standalone_payment=true&is_voided=false&is_refunded=false&is_3d_secure=true&integration_id=2936&profile_id=106&has_parent_transaction=false&order=378804&created_at=2024-06-25T15%3A16%3A25.910710%2B04%3A00&currency=EGP&merchant_commission=0&discount_details=%5B%5D&is_void=false&is_refund=false&error_occured=false&refunded_amount_cents=0&captured_amount=0&updated_at=2024-06-25T15%3A16%3A46.544538%2B04%3A00&is_settled=false&bill_balanced=false&is_bill=false&owner=211&data.message=Approved&source_data.type=card&source_data.pan=2346&source_data.sub_type=MasterCard&acq_response_code=00&txn_response_code=APPROVED'

/** Documented error bodies, quoted from the docs' "Common Errors" panels. */
export const DOCUMENTED_ERRORS = {
  /** Create Intention, 404. */
  unknownIntegration: {
    detail:
      'Integration ID/Name does not exist in our system . You can find the list of Integration ID’/Names from Merchant Dashboard under Developers → Payment Integrations Tab',
  },
  /** Create Intention, 400. */
  missingItemName: { items: { name: ['This field is required.'] } },
  /** Create Intention, 400. */
  missingPhone: { billing_data: { phone_number: ['This field is required.'] } },
  /** Refund and Void, 400. */
  refundTooLarge: {
    message:
      'Requested Refund Amount is greater than the maximum refund amount permissible. Maximum Refund Amount is EGP 100.0',
  },
  /** Capture, 400. */
  captureTooLarge: { detail: 'Capture amount cannot exceed auth amount' },
  /** Capture, 404. */
  invalidTransaction: { detail: 'Invalid transaction id' },
}
