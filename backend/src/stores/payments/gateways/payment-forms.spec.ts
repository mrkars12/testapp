import {
  enabledFormMethods,
  groupOfferingsIntoExperiences,
  type GroupableOffering,
} from './payment-forms';
import {
  capabilityContradictions,
  formNextActionKind,
  providerFormFor,
  type GatewayCapabilities,
  type NextActionKindName,
  type ProviderFormSpec,
} from './provider.types';
import { MoyasarAdapter } from './adapters/moyasar/moyasar.adapter';
import { StripeAdapter } from './adapters/stripe/stripe.adapter';
import { CodAdapter } from './adapters/cod.adapter';
import type { PaymentMethodKey } from '@prisma/client';

/**
 * ==================================================================
 * Offerings are merchant rows; experiences are what the payer sees
 * ==================================================================
 *
 * The regression these tests exist for: a merchant with Moyasar's
 * `card` and `mada` offerings enabled was shown two checkout options
 * that mounted a byte-identical embedded form, and an `apple_pay`
 * option that announced "الدفع داخل هذه الصفحة" and then handed the tab
 * to Moyasar's hosted invoice.
 */

function capabilities(
  overrides: Partial<GatewayCapabilities> = {},
): GatewayCapabilities {
  return {
    gateway: 'test',
    methods: ['card'],
    currencies: 'all',
    exponentOverrides: {},
    automaticCapture: true,
    manualCapture: false,
    partialCapture: false,
    multiCapture: false,
    refundSupported: false,
    partialRefund: false,
    voidSupported: false,
    authorizationExpiry: false,
    vaulting: false,
    merchantInitiated: false,
    threeDSecure: false,
    webhooks: false,
    statusPolling: false,
    settlementReports: false,
    webhookResolution: 'none',
    nextActionKinds: ['redirect'] as NextActionKindName[],
    offlineCommitmentKind: null,
    ...overrides,
  };
}

function offering(
  id: number,
  method: PaymentMethodKey,
  position: number,
): GroupableOffering {
  return { id: BigInt(id), method, position };
}

/** The real merchant configuration this work was reported against. */
const DARTPAY_OFFERINGS = [
  offering(50, 'card', 0),
  offering(51, 'mada', 1),
  offering(52, 'apple_pay', 2),
];

const MOYASAR_KEYS = ['secret_key', 'webhook_secret', 'publishable_key'];

describe('Moyasar declares its real provider forms', () => {
  const moyasar = new MoyasarAdapter().capabilities;

  it('describes two surfaces, not three', () => {
    expect(moyasar.providerForms).toHaveLength(2);
  });

  /** An account that filled in Moyasar's Apple Pay options. */
  const APPLE_PAY_CONFIGURED = [
    'publishable_key',
    'apple_pay_label',
    'apple_pay_country',
  ];

  it('puts card and mada on ONE form', () => {
    // mada is a card NETWORK inside Moyasar's card component (its own BIN
    // table, and `supported_networks` defaults to
    // ["amex","mada","visa","mastercard"]) — not a second form.
    const card = providerFormFor(moyasar, 'card');
    expect(card?.methods).toEqual(['card', 'mada', 'apple_pay', 'stc_pay']);
    expect(providerFormFor(moyasar, 'mada')).toBe(card);
  });

  it('puts Apple Pay on the SAME embedded form once it is configured', () => {
    // Moyasar's form hosts `applepay` in the same surface as the card
    // component — one form, three methods — so a merchant who configured
    // Apple Pay gets one embedded experience, not two.
    const applePay = providerFormFor(moyasar, 'apple_pay', APPLE_PAY_CONFIGURED);
    expect(applePay?.id).toBe('moyasar_form_card');
    expect(applePay?.nextActionKind).toBe('client_sdk');
    expect(applePay).toBe(providerFormFor(moyasar, 'card', APPLE_PAY_CONFIGURED));
  });

  it('leaves Apple Pay on the hosted invoice until it is configured', () => {
    // Without apple_pay_label / apple_pay_country the provider's form
    // throws on mount ("Apple Pay label is required") and takes the card
    // component down with it. So an unconfigured account falls through to
    // the invoice — honestly labelled redirect, never embedded.
    const applePay = providerFormFor(moyasar, 'apple_pay', ['publishable_key']);
    expect(applePay?.id).toBe('moyasar_invoice_apple_pay');
    expect(applePay?.nextActionKind).toBe('redirect');
    expect(applePay?.methods).toEqual(['apple_pay']);
  });

  it('keeps an unconfigured Apple Pay out of the embedded method list', () => {
    // The list that reaches the provider's `methods` option. `applepay`
    // in it without the options is the throw described above.
    expect(
      enabledFormMethods(moyasar, 'card', ['card', 'mada', 'apple_pay'], [
        'publishable_key',
      ]),
    ).toEqual(['card', 'mada']);

    expect(
      enabledFormMethods(
        moyasar,
        'card',
        ['card', 'mada', 'apple_pay'],
        APPLE_PAY_CONFIGURED,
      ),
    ).toEqual(['card', 'mada', 'apple_pay']);
  });

  it('is a consistent descriptor', () => {
    expect(capabilityContradictions(moyasar)).toEqual([]);
  });
});

describe('groupOfferingsIntoExperiences', () => {
  const moyasar = new MoyasarAdapter().capabilities;

  it('turns three Moyasar offerings into two payment experiences', () => {
    const experiences = groupOfferingsIntoExperiences(
      DARTPAY_OFFERINGS,
      moyasar,
      MOYASAR_KEYS,
    );

    expect(experiences).toHaveLength(2);
    expect(experiences[0].members.map((m) => m.method)).toEqual([
      'card',
      'mada',
    ]);
    expect(experiences[1].members.map((m) => m.method)).toEqual(['apple_pay']);
  });

  it('never publishes two experiences that mount the same form', () => {
    const experiences = groupOfferingsIntoExperiences(
      DARTPAY_OFFERINGS,
      moyasar,
      MOYASAR_KEYS,
    );

    const ids = experiences.map((e) => e.formId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('submits a real offering row for the grouped experience', () => {
    // Grouping changes what the customer is shown, never what the
    // payment core is handed.
    const [cards] = groupOfferingsIntoExperiences(
      DARTPAY_OFFERINGS,
      moyasar,
      MOYASAR_KEYS,
    );

    expect(cards.representative.id).toBe(50n);
    expect(cards.members.map((m) => m.id)).toEqual([50n, 51n]);
  });

  it('reports embedded for the card form and redirect for Apple Pay', () => {
    const [cards, applePay] = groupOfferingsIntoExperiences(
      DARTPAY_OFFERINGS,
      moyasar,
      MOYASAR_KEYS,
    );

    expect(cards.presentationMode).toBe('embedded');
    expect(cards.nextActionKind).toBe('client_sdk');

    // The bug in one assertion: this used to say 'embedded' because the
    // mode was resolved for the ACCOUNT, and the account's card form is
    // embedded.
    expect(applePay.presentationMode).toBe('same_tab_redirect');
    expect(applePay.nextActionKind).toBe('redirect');
  });

  it('falls the card form back to the hosted invoice with no publishable key', () => {
    const [cards] = groupOfferingsIntoExperiences(DARTPAY_OFFERINGS, moyasar, [
      'secret_key',
    ]);

    expect(cards.nextActionKind).toBe('redirect');
    expect(cards.presentationMode).toBe('same_tab_redirect');
  });

  it('keeps the merchant ordering', () => {
    const experiences = groupOfferingsIntoExperiences(
      [offering(52, 'apple_pay', 0), offering(50, 'card', 1)],
      moyasar,
      MOYASAR_KEYS,
    );

    expect(experiences.map((e) => e.representative.method)).toEqual([
      'apple_pay',
      'card',
    ]);
  });

  it('publishes a single-method experience when only card is enabled', () => {
    const experiences = groupOfferingsIntoExperiences(
      [offering(50, 'card', 0)],
      moyasar,
      MOYASAR_KEYS,
    );

    expect(experiences).toHaveLength(1);
    expect(experiences[0].members.map((m) => m.method)).toEqual(['card']);
  });

  it('leaves an adapter that declares no forms exactly as it was', () => {
    // Stripe is untouched by any of this: one experience per offering,
    // and the mode resolved for the adapter as before.
    const stripe = new StripeAdapter().capabilities;
    const experiences = groupOfferingsIntoExperiences(
      [offering(1, 'card', 0), offering(2, 'apple_pay', 1)],
      stripe,
      ['secret_key', 'publishable_key'],
    );

    expect(experiences).toHaveLength(2);
    expect(experiences.every((e) => e.form === undefined)).toBe(true);
    expect(experiences.every((e) => e.members.length === 1)).toBe(true);
  });

  it('leaves offline gateways alone', () => {
    const cod = new CodAdapter().capabilities;
    const experiences = groupOfferingsIntoExperiences(
      [offering(1, 'cod', 0)],
      cod,
      [],
    );

    expect(experiences).toHaveLength(1);
    expect(experiences[0].presentationMode).toBe('offline');
  });

  it('drops a form that cannot start and has no fallback', () => {
    const caps = capabilities({
      methods: ['card'],
      nextActionKinds: ['client_sdk'],
      providerForms: [
        {
          id: 'needs_key',
          methods: ['card'],
          nextActionKind: 'client_sdk',
          requiresCredentialKeys: ['publishable_key'],
        },
      ],
    });

    // Offering it would fail at the exact moment the customer pressed
    // Pay, which is the worst possible place to discover it.
    expect(
      groupOfferingsIntoExperiences([offering(1, 'card', 0)], caps, [
        'secret_key',
      ]),
    ).toEqual([]);
  });

  it('keeps an offering whose method has lost its form', () => {
    const caps = capabilities({
      methods: ['card'],
      nextActionKinds: ['redirect'],
      providerForms: [
        { id: 'cards', methods: ['card'], nextActionKind: 'redirect' },
      ],
    });

    // A row can outlive a method being dropped from an adapter. Never
    // silently delete the merchant's payment method.
    const experiences = groupOfferingsIntoExperiences(
      [offering(1, 'card', 0), offering(2, 'mada', 1)],
      caps,
      [],
    );

    expect(experiences.map((e) => e.representative.method)).toEqual([
      'card',
      'mada',
    ]);
  });
});

describe('enabledFormMethods', () => {
  const moyasar = new MoyasarAdapter().capabilities;

  it('names both networks when the merchant enabled both', () => {
    expect(enabledFormMethods(moyasar, 'card', ['card', 'mada'])).toEqual([
      'card',
      'mada',
    ]);
  });

  it('drops mada when the merchant did not enable it', () => {
    // This is what makes the mada offering mean something: the form is
    // told not to advertise a network the merchant never switched on.
    expect(enabledFormMethods(moyasar, 'card', ['card'])).toEqual(['card']);
  });

  it('always includes the method being paid with', () => {
    expect(enabledFormMethods(moyasar, 'mada', [])).toEqual(['mada']);
  });

  it('is undefined for an adapter that declares no forms', () => {
    expect(
      enabledFormMethods(new StripeAdapter().capabilities, 'card', ['card']),
    ).toBeUndefined();
  });
});

describe('capabilityContradictions rejects an inconsistent form set', () => {
  const form = (over: Partial<ProviderFormSpec>): ProviderFormSpec => ({
    id: 'f',
    methods: ['card'],
    nextActionKind: 'redirect',
    ...over,
  });

  it('rejects a form hosting a method the adapter does not support', () => {
    const problems = capabilityContradictions(
      capabilities({
        methods: ['card'],
        providerForms: [form({ methods: ['card', 'mada'] })],
      }),
    );

    expect(problems).toContain(
      'provider form "f" hosts unsupported method "mada"',
    );
  });

  it('rejects a form declaring an action kind the adapter cannot emit', () => {
    const problems = capabilityContradictions(
      capabilities({
        nextActionKinds: ['redirect'],
        providerForms: [form({ nextActionKind: 'client_sdk' })],
      }),
    );

    expect(problems).toContain(
      'provider form "f" declares action kind "client_sdk" the adapter cannot emit',
    );
  });

  it('rejects one method appearing in two forms', () => {
    const problems = capabilityContradictions(
      capabilities({
        methods: ['card'],
        providerForms: [form({ id: 'a' }), form({ id: 'b' })],
      }),
    );

    expect(problems).toContain(
      'method "card" appears in more than one form after an unconditional one',
    );
  });

  it('rejects a partial mapping', () => {
    const problems = capabilityContradictions(
      capabilities({
        methods: ['card', 'mada'],
        providerForms: [form({ methods: ['card'] })],
      }),
    );

    expect(problems).toContain(
      'declares provider forms but method "mada" belongs to none',
    );
  });
});

describe('formNextActionKind', () => {
  const spec: ProviderFormSpec = {
    id: 'f',
    methods: ['card'],
    nextActionKind: 'client_sdk',
    requiresCredentialKeys: ['publishable_key'],
    fallbackNextActionKind: 'redirect',
  };

  it('gives the form kind when the credentials are there', () => {
    expect(formNextActionKind(spec, ['publishable_key'])).toBe('client_sdk');
  });

  it('gives the fallback when they are not', () => {
    expect(formNextActionKind(spec, [])).toBe('redirect');
  });

  it('gives null when there is no fallback', () => {
    expect(
      formNextActionKind({ ...spec, fallbackNextActionKind: undefined }, []),
    ).toBeNull();
  });
});
