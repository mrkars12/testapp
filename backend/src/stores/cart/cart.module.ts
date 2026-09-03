import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CartService } from './cart.service';
import { StorefrontCartController } from './storefront-cart.controller';

/**
 * The server-authoritative storefront cart.
 *
 * Deliberately tiny and dependency-free beyond Prisma: a cart holds no
 * money, calls no gateway, and touches nothing in the payment core. It
 * exports only `CartService`, which CheckoutModule imports for the
 * two-phase claim — the dependency goes one way, so there is no cycle.
 */
@Module({
  imports: [PrismaModule],
  controllers: [StorefrontCartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
