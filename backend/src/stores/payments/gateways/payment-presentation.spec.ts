import {
  PAYMENT_PRESENTATION_MODES,
  isPaymentPresentationMode,
  leavesTheSite,
  presentationModeFor,
} from './payment-presentation';
import type { GatewayCapabilities, NextActionKindName } from './provider.types';
import { CodAdapter } from './adapters/cod.adapter';
import { BankTransferAdapter } from './adapters/bank-transfer.adapter';
import { MoyasarAdapter } from './adapters/moyasar/moyasar.adapter';
import { StripeAdapter } from './adapters/stripe/stripe.adapter';
import { TapAdapter } from './adapters/tap/tap.adapter';
import { PaymobAdapter } from './adapters/paymob/paymob.adapter';

/** Minimal online capability descriptor; only the fields under test vary. */
function online(
  nextActionKinds: readonly NextActionKindName[],
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
    nextActionKinds,
    offlineCommitmentKind: null,
  };
}

describe('presentationModeFor', () => {
  it('classifies an adapter that redirects as same-tab redirect', () => {
    expect(presentationModeFor(online(['redirect']))).toBe('same_tab_redirect');
  });

  it('classifies a client SDK adapter as embedded', () => {
    expect(presentationModeFor(online(['client_sdk']))).toBe('embedded');
  });

  it('classifies a provider-hosted iframe as embedded', () => {
    expect(presentationModeFor(online(['iframe']))).toBe('embedded');
  });

  it('prefers embedded when an adapter can do both', () => {
    // Staying in the page is the better experience, and an adapter that
    // declares client_sdk has committed to supporting it.
    expect(presentationModeFor(online(['redirect', 'client_sdk']))).toBe(
      'embedded',
    );
  });

  it('does not treat a displayed reference code as leaving the site', () => {
    expect(presentationModeFor(online(['reference_code']))).toBe('offline');
  });

  it('treats an online adapter with no customer action as offline', () => {
    expect(presentationModeFor(online([]))).toBe('offline');
  });

  it('classifies an offline adapter as offline whatever it declares', () => {
    const capabilities = {
      ...online(['redirect']),
      offlineCommitmentKind: 'promise_accepted',
    } as GatewayCapabilities;
    expect(presentationModeFor(capabilities)).toBe('offline');
  });
});

describe('leavesTheSite', () => {
  it('is true only for same-tab redirect', () => {
    expect(leavesTheSite(online(['redirect']))).toBe(true);
    expect(leavesTheSite(online(['client_sdk']))).toBe(false);
    expect(leavesTheSite(online([]))).toBe(false);
  });
});

describe('isPaymentPresentationMode', () => {
  it('accepts every declared mode and nothing else', () => {
    for (const mode of PAYMENT_PRESENTATION_MODES) {
      expect(isPaymentPresentationMode(mode)).toBe(true);
    }
    expect(isPaymentPresentationMode('popup')).toBe(false);
    expect(isPaymentPresentationMode('new_tab')).toBe(false);
    expect(isPaymentPresentationMode(null)).toBe(false);
  });
});

/**
 * The real adapters, so a capability change that would silently move a
 * gateway between checkout surfaces fails here rather than in a browser.
 * These assertions encode what each provider *officially* supports today
 * — none of the four online adapters implements an embedded form, so
 * none of them may be classified as embedded.
 */
describe('the adapters registered today', () => {
  const cases: ReadonlyArray<[string, GatewayCapabilities, string]> = [
    ['cod', new CodAdapter().capabilities, 'offline'],
    ['bank_transfer', new BankTransferAdapter().capabilities, 'offline'],
    // Moyasar's adapter can do both; which one a merchant gets depends
    // on their account, which is asserted separately below.
    ['moyasar', new MoyasarAdapter().capabilities, 'embedded'],
    ['stripe', new StripeAdapter().capabilities, 'same_tab_redirect'],
    ['tap', new TapAdapter().capabilities, 'same_tab_redirect'],
    ['paymob', new PaymobAdapter().capabilities, 'same_tab_redirect'],
  ];

  it.each(cases)('%s presents as %s', (_gateway, capabilities, expected) => {
    expect(presentationModeFor(capabilities)).toBe(expected);
  });

  describe('Moyasar resolves per account, not per adapter', () => {
    const moyasar = new MoyasarAdapter().capabilities;

    it('is embedded for an account that has a publishable key', () => {
      expect(
        presentationModeFor(moyasar, ['secret_key', 'publishable_key']),
      ).toBe('embedded');
    });

    it('is same-tab redirect for an account without one', () => {
      // Moyasar Form cannot initialise without a publishable key.
      // Offering an embedded form to this merchant would be offering a
      // payment method that could never start.
      expect(presentationModeFor(moyasar, ['secret_key'])).toBe(
        'same_tab_redirect',
      );
      expect(presentationModeFor(moyasar, [])).toBe('same_tab_redirect');
    });

    it('still redirects when only unrelated credentials are configured', () => {
      expect(
        presentationModeFor(moyasar, ['secret_key', 'webhook_secret']),
      ).toBe('same_tab_redirect');
    });
  });

  it('has no adapter claiming embedded support it does not implement', () => {
    for (const [, capabilities] of cases) {
      if (presentationModeFor(capabilities) === 'embedded') {
        expect(
          capabilities.nextActionKinds.some(
            (kind) => kind === 'client_sdk' || kind === 'iframe',
          ),
        ).toBe(true);
      }
    }
  });
});
