import type { PaymentMethodKey } from '@prisma/client';
import {
  formHostsMethod,
  formNextActionKind,
  type GatewayCapabilities,
  type NextActionKindName,
  type ProviderFormSpec,
} from './provider.types';
import {
  presentationModeFor,
  presentationModeForKind,
  type PaymentPresentationMode,
} from './payment-presentation';

/**
 * ==================================================================
 * Offerings → payment experiences
 * ==================================================================
 *
 * `PaymentMethodOffering` is a **merchant** record: one row per method
 * the merchant switched on. A **payment experience** is what the
 * customer is offered: one entry per provider surface they can actually
 * end up in front of.
 *
 * These are not the same granularity, and forcing them to be is what
 * produced the bug this module exists to fix. Moyasar's Payment Form is
 * a single card component whose `supported_networks` default is
 * `["amex","mada","visa","mastercard"]` — mada is a network the card
 * form already accepts, with its own BIN table inside the provider's
 * bundle, not a second form. A merchant with `card` and `mada` enabled
 * was shown two radio buttons ("بطاقة ائتمانية", "مدى") that mounted a
 * byte-identical form with `methods: ['creditcard']`. Two names, one
 * experience.
 *
 * The grouping is declared by the adapter (`capabilities.providerForms`)
 * because only the adapter knows the provider's integration contract.
 * An adapter that declares nothing keeps the old behaviour exactly: one
 * experience per offering. Nothing here knows a gateway's name.
 *
 * Settings are untouched by any of this. The merchant still enables and
 * orders methods one by one; this is the read model the storefront uses,
 * and it is deliberately allowed to be coarser.
 */

/** The offering fields grouping needs. Nothing tenant-sensitive. */
export interface GroupableOffering {
  readonly id: bigint;
  readonly method: PaymentMethodKey;
  readonly position: number;
}

export interface PaymentExperience<T extends GroupableOffering> {
  /**
   * The offering the checkout POSTs when this experience is chosen.
   *
   * A real offering row — the lowest-positioned member — so the commit
   * path, the policy check, the capture mode and the commitment kind all
   * stay exactly as they were. Grouping changes what the customer is
   * shown, never what the payment core is handed.
   */
  readonly representative: T;
  /** Every offering this one experience covers, in merchant order. */
  readonly members: readonly T[];
  /** The declared form, or `undefined` when the adapter declares none. */
  readonly form?: ProviderFormSpec;
  /** Stable id for the experience: the form's, or the method's. */
  readonly formId: string;
  /** The action kind the payer will actually get. */
  readonly nextActionKind: NextActionKindName | null;
  readonly presentationMode: PaymentPresentationMode;
}

/**
 * Groups one account's enabled offerings into what the payer sees.
 *
 * Offerings must already be filtered to a single account, because a
 * form belongs to an account's adapter and two accounts on the same
 * gateway are two separate merchant configurations.
 *
 * Order is preserved: an experience takes the position of its
 * earliest-positioned member, so the merchant's ordering still decides
 * the checkout's ordering.
 */
export function groupOfferingsIntoExperiences<T extends GroupableOffering>(
  offerings: readonly T[],
  capabilities: GatewayCapabilities,
  configuredCredentialKeys: readonly string[],
): PaymentExperience<T>[] {
  const ordered = [...offerings].sort((a, b) => a.position - b.position);
  const forms = capabilities.providerForms ?? [];

  if (forms.length === 0) {
    // No declared surfaces: every offering is its own experience, which
    // is what this endpoint published before forms existed.
    return ordered.map((offering) => ({
      representative: offering,
      members: [offering],
      formId: offering.method,
      nextActionKind: null,
      presentationMode: presentationModeFor(
        capabilities,
        configuredCredentialKeys,
      ),
    }));
  }

  const groups = new Map<string, T[]>();
  const ungrouped: T[] = [];

  for (const offering of ordered) {
    // Membership is resolved against THIS account's configured keys: a
    // method can be a member of the embedded surface for a merchant who
    // configured it and of the fallback surface for one who did not.
    const form = forms.find((f) =>
      formHostsMethod(f, offering.method, configuredCredentialKeys),
    );
    if (!form) {
      // Cannot happen for a descriptor that passes
      // `capabilityContradictions` (which requires every method to
      // belong to a form), but an offering row can outlive a method
      // being dropped from an adapter. Treat it as its own experience
      // rather than dropping the merchant's payment method silently.
      ungrouped.push(offering);
      continue;
    }

    const bucket = groups.get(form.id);
    if (bucket) bucket.push(offering);
    else groups.set(form.id, [offering]);
  }

  const experiences: PaymentExperience<T>[] = [];

  for (const [formId, members] of groups) {
    // Safe: the id came from the form that matched a moment ago.
    const form = forms.find((f) => f.id === formId)!;
    const kind = formNextActionKind(form, configuredCredentialKeys);

    // A form whose credentials are missing and which declares no
    // fallback cannot start. Offering it would fail at the exact moment
    // the customer pressed Pay.
    if (kind === null) continue;

    experiences.push({
      representative: members[0],
      members,
      form,
      formId,
      nextActionKind: kind,
      presentationMode: presentationModeForKind(kind),
    });
  }

  for (const offering of ungrouped) {
    experiences.push({
      representative: offering,
      members: [offering],
      formId: offering.method,
      nextActionKind: null,
      presentationMode: presentationModeFor(
        capabilities,
        configuredCredentialKeys,
      ),
    });
  }

  return experiences.sort(
    (a, b) => a.representative.position - b.representative.position,
  );
}

/**
 * The methods the form hosting `method` covers, restricted to the ones
 * this merchant actually enabled.
 *
 * This is what `PaymentCallContext.formMethods` carries: the adapter
 * needs the merchant's real set (so a merchant without mada gets a card
 * form that does not advertise mada), not the form's theoretical one.
 * Returns `undefined` for an adapter that declares no forms, which is
 * how an adapter tells that the caller is not grouping anything.
 */
export function enabledFormMethods(
  capabilities: GatewayCapabilities,
  method: PaymentMethodKey,
  enabledMethods: readonly PaymentMethodKey[],
  configuredCredentialKeys: readonly string[] = [],
): readonly PaymentMethodKey[] | undefined {
  const form = capabilities.providerForms?.find((f) =>
    formHostsMethod(f, method, configuredCredentialKeys),
  );
  if (!form) return undefined;

  // Restricted twice: to what the merchant enabled, and to what this
  // account has actually configured for each method. A merchant who
  // enabled Apple Pay but configured none of its options must not have
  // `apple_pay` land in the embedded form's method list — the provider's
  // form throws on the missing options and takes the card form with it.
  const enabled = form.methods.filter(
    (m) =>
      enabledMethods.includes(m) &&
      formHostsMethod(form, m, configuredCredentialKeys),
  );
  // The representative always counts, even if the caller's enabled list
  // is stale: it is the method the payment is actually being made with.
  return enabled.includes(method) ? enabled : [method, ...enabled];
}
