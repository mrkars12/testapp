import { MoyasarAdapter } from './moyasar.adapter';
import type {
  PaymentCallContext,
  InitializeResult,
} from '../../provider.types';
import type {
  MoyasarHttp,
  MoyasarRequest,
  MoyasarResponse,
} from './moyasar-client';

/* ══════════════════════════════════════════════════════════════════════
   An adapter must not hand a surface an action it cannot perform.

   The bug this pins: Moyasar returns its in-page form whenever the
   account has a publishable key. The merchant Test Payment tool has no
   renderer for one, so it received a `client_sdk` action, created an
   attempt with no gateway reference, and sent the merchant to its result
   route — reporting "requires_action" for a payment that had never
   reached Moyasar. Nothing was wrong with the embedded flow; it was
   offered to a surface that could not run it.
   ══════════════════════════════════════════════════════════════════════ */

/** `MoyasarHttp` is a function, not an object — mirrors the sibling spec. */
function stub(responses: Record<string, MoyasarResponse> = {}) {
  const calls: MoyasarRequest[] = [];
  const http: MoyasarHttp = (request) => {
    calls.push(request);
    for (const [fragment, answer] of Object.entries(responses)) {
      if (request.url.includes(fragment)) return Promise.resolve(answer);
    }
    return Promise.resolve({ status: 200, body: {} });
  };
  return { http, calls };
}

function context(over: Partial<PaymentCallContext> = {}): PaymentCallContext {
  return {
    storeId: 1n,
    mode: 'test',
    accountId: 2n,
    offeringId: 3n,
    method: 'card',
    gatewayMethodConfig: '',
    intentId: 42n,
    attemptId: null,
    attemptSequence: 1,
    amountMinor: 2500n,
    currency: 'USD',
    credentials: { secret_key: 'sk_test_x', publishable_key: 'pk_test_x' },
    returnUrl: 'https://shop.test/return',
    ...over,
  };
}

const INVOICE = {
  status: 200,
  body: { id: 'inv_1', url: 'https://moyasar.test/invoice/inv_1' },
} as MoyasarResponse;

describe('Moyasar chooses an action the calling surface can host', () => {
  it('gives the in-page form to a surface that can host it', async () => {
    // The storefront checkout: it mounts the provider's own component.
    const { http, calls } = stub({ invoices: INVOICE });
    const result = await new MoyasarAdapter(http).initializePayment(
      context({ hostableNextActionKinds: ['redirect', 'client_sdk'] }),
    );
    expect(result.kind).toBe('requires_action');
    expect(
      (result as Extract<InitializeResult, { kind: 'requires_action' }>)
        .nextAction.kind,
    ).toBe('client_sdk');
    // The embedded path creates the payment in the browser, so the
    // adapter makes no provider call at all.
    expect(calls).toHaveLength(0);
  });

  it('gives the hosted invoice to a surface that cannot', async () => {
    // The merchant Test Payment tool: it can only hand its tab to a URL.
    const { http, calls } = stub({ invoices: INVOICE });
    const result = await new MoyasarAdapter(http).initializePayment(
      context({
        hostableNextActionKinds: ['redirect', 'bank_instructions', 'none'],
      }),
    );

    expect(result.kind).toBe('requires_action');
    const action = (
      result as Extract<InitializeResult, { kind: 'requires_action' }>
    ).nextAction;
    expect(action.kind).toBe('redirect');
    // A real URL to the real provider — the thing whose absence was the bug.
    expect(action).toMatchObject({ url: 'https://moyasar.test/invoice/inv_1' });
    // And a reference, so the surface's own sync path can advance it.
    expect(result).toMatchObject({ refs: { gatewayReference: 'inv_1' } });
    expect(calls.length).toBeGreaterThan(0);
  });

  it('still answers for the adapter in the abstract when unconstrained', () => {
    // Omitted means "no constraint" — the conformance suite and every
    // caller that predates the field keep their existing behaviour.
    expect(context().hostableNextActionKinds).toBeUndefined();
  });

  it('never returns the form to a surface that excluded it, even with a key', async () => {
    const { http } = stub({ invoices: INVOICE });
    const result = await new MoyasarAdapter(http).initializePayment(
      context({
        hostableNextActionKinds: ['redirect'],
        credentials: {
          secret_key: 'sk_test_x',
          publishable_key: 'pk_test_present',
        },
      }),
    );

    expect(
      (result as Extract<InitializeResult, { kind: 'requires_action' }>)
        .nextAction.kind,
    ).toBe('redirect');
  });
});
