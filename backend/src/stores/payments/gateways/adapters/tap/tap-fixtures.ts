/**
 * ==================================================================
 * Official Tap documentation fixtures
 * ==================================================================
 *
 * Transcribed from Tap's published examples so the specs assert against
 * Tap's own payloads rather than payloads we imagined.
 *
 * Sources, all accessed 2026-08-19:
 *   https://developers.tap.company/reference/create-a-charge
 *     (200 "Result" example — the INITIATED charge with transaction.url,
 *      and the 400 error body)
 *   https://developers.tap.company/reference/charges
 *     (the CAPTURED charge response sample and the status list)
 *   https://developers.tap.company/docs/webhook
 *     (the posted charge and authorize bodies, and their headers)
 *   https://developers.tap.company/docs/redirect
 *     (GET /v2/charges/{charge_id} and its CANCELLED example)
 *   https://developers.tap.company/reference/refunds
 *     (the refund request and response samples)
 *   https://developers.tap.company/reference/list-all-charges
 *     (the POST /v2/charges/list response envelope)
 *   https://developers.tap.company/docs/error-handling-testing
 *     (the documented error codes)
 *
 * Test-only module: not imported by any production file.
 */

/**
 * The 200 response of Create a Charge, as documented.
 *
 * `status: "INITIATED"` with a `transaction.url` is the whole of the
 * redirect flow's first step.
 */
export const CREATE_CHARGE_RESPONSE = {
  id: 'chg_TS012520220955Rr950709475',
  object: 'charge',
  live_mode: false,
  api_version: 'V2',
  method: 'CREATE',
  status: 'INITIATED',
  amount: 1.0,
  currency: 'KWD',
  threeDSecure: true,
  card_threeDSecure: false,
  save_card: false,
  merchant_id: '',
  product: 'GOSELL',
  description: 'Test Description',
  metadata: { udf1: 'Metadata 1' },
  transaction: {
    timezone: 'UTC+03:00',
    created: '1662544525491',
    url: 'https://checkout.payments.tap.company?mode=page&token=6318405da53ea40ebd4da0c0',
    expiry: { period: 30, type: 'MINUTE' },
    asynchronous: false,
    amount: 1.0,
    currency: 'KWD',
  },
  reference: { transaction: 'txn_01', order: 'ord_01' },
  response: { code: '100', message: 'Initiated' },
  receipt: { email: true, sms: true },
  merchant: { id: '599424' },
  source: { object: 'source', id: 'src_all' },
  redirect: { status: 'PENDING', url: 'http://your_website.com/redirect_url' },
  post: { status: 'PENDING', url: 'http://your_website.com/post_url' },
  activities: [
    {
      id: 'activity_TS062620220955Nk440709312',
      object: 'activity',
      created: 1662544525491,
      status: 'INITIATED',
      currency: 'KWD',
      amount: 1.0,
      remarks: 'charge - created',
    },
  ],
  auto_reversed: false,
}

/**
 * The charge body Tap posts to `post.url` on completion.
 *
 * Quoted from the webhook page's "Webhook Example for a Charges
 * Response". It is what the hashstring on that same page is computed
 * over, which is why the specs sign exactly this object.
 */
export const CAPTURED_CHARGE_CALLBACK = {
  id: 'chg_TS05A4120230736x9K22710693',
  object: 'charge',
  live_mode: false,
  customer_initiated: true,
  api_version: 'V2',
  method: 'POST',
  status: 'CAPTURED',
  amount: 1.0,
  currency: 'SAR',
  threeDSecure: true,
  card_threeDSecure: false,
  save_card: true,
  merchant_id: '',
  product: '',
  description: '',
  metadata: { udf1: 'test_data_1', udf2: 'test_data_2', udf3: 'test_data_3' },
  transaction: {
    timezone: 'UTC+03:00',
    created: '1698392202943',
    expiry: { period: 30, type: 'MINUTE' },
    asynchronous: false,
    amount: 1.0,
    currency: 'SAR',
  },
  reference: {
    track: 'tck_TS04A4320230736To522710661',
    payment: '4327230736106619650',
    gateway: 'mada_pg70983e7a-a686-40ba-83e2-c5e9f4074fe5',
    acquirer: '230004002581',
    transaction: 'txn_0001',
    order: 'ord_0001',
  },
  response: { code: '000', message: 'Captured' },
  security: { threeDSecure: { status: 'Y' } },
  gateway: { response: { code: '000', message: 'Approved' } },
  card: {
    id: 'card_IIGi4523416sFHe27jJ9E589',
    object: 'card',
    first_six: '446404',
    first_eight: '44640400',
    scheme: 'MADA',
    brand: 'VISA',
    last_four: '0007',
  },
  receipt: { id: '204327230736104914', email: true, sms: true },
  merchant: { country: 'SA', currency: 'SAR', id: '25145693' },
  source: {
    object: 'token',
    type: 'CARD_NOT_PRESENT',
    payment_type: 'DEBIT',
    payment_method: 'MADA',
    channel: 'INTERNET',
    id: 'tok_nLKq4223436fVYL27Nj9P855',
  },
  redirect: { status: 'PENDING', url: 'http://your_website.com/redirecturl' },
  post: {
    attempt: 1,
    status: 'PENDING',
    url: 'https://webhook.site/25c5e885-216b-4d5f-bcbf-8e5d0d20b76f',
  },
  auto_reversed: false,
}

/**
 * The authorize body Tap posts, from the same page.
 *
 * Present so the specs can prove this adapter recognises an authorize
 * without acting on it: it never calls `POST /v2/authorize`, so no
 * attempt here could correspond to one.
 */
export const AUTHORIZED_CALLBACK = {
  id: 'auth_TS04A1720230745Rt2a2710607',
  object: 'authorize',
  customer_initiated: true,
  authorize_debit: false,
  live_mode: false,
  api_version: 'V2',
  status: 'AUTHORIZED',
  amount: 100.0,
  currency: 'SAR',
  threeDSecure: true,
  save_card: true,
  transaction: {
    authorization_id: '125468',
    timezone: 'UTC+03:00',
    created: '1698392719404',
    expiry: { period: 30, type: 'MINUTE' },
    asynchronous: false,
    amount: 100.0,
    currency: 'SAR',
  },
  reference: {
    track: 'tck_TS02A2020230745q4MN2710966',
    payment: '2027230745109668360',
    gateway: '123456789',
    acquirer: '330004125468',
    transaction: 'txn_0001',
    order: 'ord_0001',
  },
  response: { code: '001', message: 'Authorized' },
  auto: { status: 'SCHEDULED', type: 'VOID', time: 1 },
  merchant: { id: '25145693' },
}

/**
 * The CANCELLED charge from the Redirect guide's retrieve example.
 *
 * Its `reference.gateway` is "00" and it has no `reference.acquirer`,
 * which makes it the fixture that proves the hash is built from what Tap
 * actually sent rather than from fields we assume are present.
 */
export const CANCELLED_CHARGE = {
  id: 'chg_TS020420211019Ja242609987',
  object: 'charge',
  live_mode: false,
  api_version: 'V2',
  method: 'GET',
  status: 'CANCELLED',
  amount: 1.0,
  currency: 'BHD',
  threeDSecure: true,
  card_threeDSecure: false,
  save_card: false,
  merchant_id: '',
  product: '',
  statement_descriptor: 'Sample',
  description: 'Test Description',
  metadata: { udf1: 'test 1', udf2: 'test 2' },
  transaction: {
    timezone: 'UTC+03:00',
    created: '1632651545003',
    expiry: { period: 30, type: 'MINUTE' },
    asynchronous: false,
    amount: 1.0,
    currency: 'BHD',
  },
  reference: {
    id: 'ref_BoajZCHlFDnLsUbyBygLkB',
    track: 'tck_TS030520211019Yx942609049',
    payment: '5726211019090490134',
    gateway: '00',
    transaction: 'txn_0001',
    order: 'ord_0001',
  },
  response: { code: '302', message: 'Cancelled' },
  receipt: { id: '205026211019099018', email: false, sms: true },
  source: {
    object: 'source',
    type: 'CARD_NOT_PRESENT',
    payment_type: 'DEBIT',
    payment_method: 'BENEFIT',
    channel: 'INTERNET',
    id: 'src_bh.benefit',
  },
  redirect: { status: 'SUCCESS', url: 'https://noonera.com/demo/redirect.php' },
  post: { status: 'SUCCESS', url: 'https://noonera.com/demo/post.php' },
}

/** The refund response sample from the Refund reference. */
export const REFUND_RESPONSE = {
  id: 're_xxxx',
  object: 'refund',
  api_version: 'V2',
  live_mode: false,
  amount: 3,
  charge_id: 'chg_TS05A4120230736x9K22710693',
  created: '1723481040882',
  date: '1723481042085',
  currency: 'AED',
  status: 'REFUNDED',
  reference: {
    id: 'xxxx',
    gateway: 'xxxx',
    payment: 'xxxx',
    acquirer: 'xxxx',
  },
  response: { code: '000', message: 'Refunded' },
  post: { status: 'PENDING', url: 'http://your_website.com/post_url' },
  acquirer: { response: { code: '000', message: 'Refunded' } },
  gateway: { response: { code: '00', message: 'Approved' } },
  method: 'CREATE',
  transaction: {
    timezone: 'UTC+03:00',
    asynchronous: false,
    amount: 3,
    currency: 'AED',
    date: { created: 1723481040882, completed: 1723481042085 },
  },
  wallet: { debit: false },
  merchant: { id: 'xxxx' },
  reverse_destination: false,
  reason: 'The product is out of stock',
}

/** The list envelope of POST /v2/charges/list. */
export const CHARGE_LIST_RESPONSE = {
  object_type: 'list',
  live_mode: false,
  count: 1,
  has_more: false,
  api_version: 'V1.2',
  charges: [CAPTURED_CHARGE_CALLBACK],
}

/** Documented error bodies, quoted from Tap's own examples. */
export const DOCUMENTED_ERRORS = {
  /** The Create a Charge 400 example. */
  unableToProcess: {
    errors: [
      {
        code: '1125',
        description:
          'We were unable to process your payment. Please verify your payment method or card details and try again.',
      },
    ],
  },
  /** "Invalid_Data — Missing required header: authorization". */
  missingAuthorization: {
    errors: [
      { code: '7022', description: 'Missing required header: authorization' },
    ],
  },
  /** "Not_Found — No matching order found for order.id". */
  notFound: {
    errors: [{ code: '7017', description: 'No matching order found for order.id' }],
  },
}

/** The header name Tap sends its HMAC in, per the webhook page. */
export const TAP_HASH_HEADER = 'hashstring'
