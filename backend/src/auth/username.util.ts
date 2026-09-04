import { PrismaService } from '../prisma/prisma.service';

/**
 * `users.username` is a required, unique column with no dedicated
 * "no username" state — every account needs one. It is no longer a
 * user-facing registration field (Part 1 of the registration-form
 * refinement): the public signup form only collects email/name/phone, so
 * this derives a username automatically from a display-name-like seed,
 * exactly the way OAuth account creation already did before this file
 * existed (that logic lived duplicated in `OAuthService`; this is the
 * single shared version both paths now call).
 */
export async function generateUniqueUsername(
  prisma: PrismaService,
  seed: string,
): Promise<string> {
  const base =
    seed
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 12) || 'user';
  let username = base;
  let counter = 1;
  while (await prisma.users.findUnique({ where: { username } })) {
    username = `${base}${counter++}`;
  }
  return username;
}
