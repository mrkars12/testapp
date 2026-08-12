import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { CollectionsService } from './collections.service';
import { SessionAuthGuard } from '../../auth/session-auth.guard';
import { ActiveStoreGuard } from '../active-store.guard';
import { ActiveStore } from '../active-store.decorator';
import type { store as StoreRecord } from '@prisma/client';

@Controller('stores')
@UseGuards(SessionAuthGuard)
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  /** بتاعة get-or-create السريعة جوه ProductForm — نفس نمط
   *  /stores/products/tags و /stores/products/product-types عندك بالظبط. */
  @Post('products/collections')
  @UseGuards(ActiveStoreGuard)
  quickCreate(@ActiveStore() store: StoreRecord, @Body() body: { name: string }) {
    return this.collections.getOrCreateByName(store.id, body.name);
  }

  @Get('collections')
  @UseGuards(ActiveStoreGuard)
  list(@ActiveStore() store: StoreRecord) {
    return this.collections.list(store.id);
  }

  @Get('collections/:id')
  @UseGuards(ActiveStoreGuard)
  getOne(@Param('id', ParseIntPipe) id: number, @ActiveStore() store: StoreRecord) {
    return this.collections.getOne(store.id, id);
  }

  @Post('collections')
  @UseGuards(ActiveStoreGuard)
  create(@ActiveStore() store: StoreRecord, @Body() body: any) {
    return this.collections.create(store.id, body);
  }

  @Put('collections/:id')
  @UseGuards(ActiveStoreGuard)
  update(@Param('id', ParseIntPipe) id: number, @ActiveStore() store: StoreRecord, @Body() body: any) {
    return this.collections.update(store.id, id, body);
  }

  @Delete('collections/:id')
  @UseGuards(ActiveStoreGuard)
  remove(@Param('id', ParseIntPipe) id: number, @ActiveStore() store: StoreRecord) {
    return this.collections.remove(store.id, id);
  }

  @Post('collections/:id/products')
  @UseGuards(ActiveStoreGuard)
  addProducts(@Param('id', ParseIntPipe) id: number, @ActiveStore() store: StoreRecord, @Body() body: { product_ids: string[] }) {
    return this.collections.addProducts(store.id, id, body.product_ids);
  }

  @Delete('collections/:id/products/:productId')
  @UseGuards(ActiveStoreGuard)
  removeProduct(@Param('id', ParseIntPipe) id: number, @Param('productId') productId: string, @ActiveStore() store: StoreRecord) {
    return this.collections.removeProduct(store.id, id, productId);
  }
}
