import { ConfigService } from '@nestjs/config';

/**
 * The `app` config CheckoutService reads, for specs that construct the
 * service by hand rather than through a Nest module.
 *
 * Only `corsOrigins` matters: it is the allowlist a client-supplied
 * `return_url` is checked against (see checkout/return-url.ts). Tests
 * that do not exercise a return URL are unaffected by the value; tests
 * that do get the same localhost origin the dev frontend runs on.
 */
export function appConfigStub(
  corsOrigins: readonly string[] = ['http://localhost:3000'],
): ConfigService {
  return new ConfigService({ app: { corsOrigins: [...corsOrigins] } });
}
