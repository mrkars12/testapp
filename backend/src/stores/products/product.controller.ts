import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, UseGuards,
} from '@nestjs/common'
import { SessionAuthGuard } from '../../auth/session-auth.guard'
import { ProductService } from './product.service'
import { ProductStatus } from '@prisma/client'
import { ActiveStoreGuard } from '../active-store.guard'
import { ActiveStore } from '../active-store.decorator'
import type { store as StoreRecord } from '@prisma/client'
@Controller('stores/products')
@UseGuards(SessionAuthGuard)
export class ProductController {
  constructor(private readonly productService: ProductService) {}
  // ── Product Types (static routes — must come before :id) ──────────────────
  @Get('product-types')
  @UseGuards(ActiveStoreGuard)
  async getProductTypes(@ActiveStore() store: StoreRecord) {
    return this.productService.getProductTypes(store.id)
  }
  @Post('product-types')
  @UseGuards(ActiveStoreGuard)
  async createProductType(
    @ActiveStore() store: StoreRecord,
    @Body() body: { name: string },
  ) {
    return this.productService.createProductType(store.id, body.name)
  }
  @Put('product-types/:id')
  @UseGuards(ActiveStoreGuard)
  async updateProductType(
    @Param('id') id: string,
    @ActiveStore() store: StoreRecord,
    @Body() body: { name: string },
  ) {
    return this.productService.updateProductType(store.id, id, body.name)
  }
  @Delete('product-types/:id')
  @UseGuards(ActiveStoreGuard)
  async deleteProductType(
    @Param('id') id: string,
    @ActiveStore() store: StoreRecord,
  ) {
    return this.productService.deleteProductType(store.id, id)
  }
  // ── Tags (static routes — must come before :id) ───────────────────────────
  @Get('tags')
  @UseGuards(ActiveStoreGuard)
  async getTags(@ActiveStore() store: StoreRecord) {
    return this.productService.getTags(store.id)
  }
  @Post('tags')
  @UseGuards(ActiveStoreGuard)
  async createTag(
    @ActiveStore() store: StoreRecord,
    @Body() body: { name: string },
  ) {
    return this.productService.createTag(store.id, body.name)
  }
  @Put('tags/:id')
  @UseGuards(ActiveStoreGuard)
  async updateTag(
    @Param('id') id: string,
    @ActiveStore() store: StoreRecord,
    @Body() body: { name: string },
  ) {
    return this.productService.updateTag(store.id, id, body.name)
  }
  @Delete('tags/:id')
  @UseGuards(ActiveStoreGuard)
  async deleteTag(
    @Param('id') id: string,
    @ActiveStore() store: StoreRecord,
  ) {
    return this.productService.deleteTag(store.id, id)
  }
  // ── Products (dynamic :id routes — must come after static routes) ─────────
  @Get()
  @UseGuards(ActiveStoreGuard)
  async getProducts(
    @ActiveStore() store: StoreRecord,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.productService.getProducts(store.id, {
      status,
      search,
      page: parseInt(page),
      limit: parseInt(limit),
    })
  }
  @Get(':id')
  @UseGuards(ActiveStoreGuard)
  async getProduct(@Param('id') id: string, @ActiveStore() store: StoreRecord) {
    return this.productService.getProduct(store, id)
  }
  @Post()
  @UseGuards(ActiveStoreGuard)
  async createProduct(@ActiveStore() store: StoreRecord, @Body() body: any) {
    return this.productService.createProduct(store, body)
  }
  @Put(':id')
  @UseGuards(ActiveStoreGuard)
  async updateProduct(
    @Param('id') id: string,
    @ActiveStore() store: StoreRecord,
    @Body() body: any,
  ) {
    return this.productService.updateProduct(store, id, body)
  }
  @Delete(':id')
  @UseGuards(ActiveStoreGuard)
  async deleteProduct(@Param('id') id: string, @ActiveStore() store: StoreRecord) {
    return this.productService.deleteProduct(store.id, id)
  }
  @Put(':id/status')
  @UseGuards(ActiveStoreGuard)
  async updateStatus(
    @Param('id') id: string,
    @ActiveStore() store: StoreRecord,
    @Body() body: { status: ProductStatus },
  ) {
    return this.productService.updateProductStatus(store.id, id, body.status)
  }
  // FIX (جديد): endpoint مطلوب لزرار "نسخ" (Duplicate) في منيو الثلاث نقط
  // بالفرونت. بيستدعي duplicateProduct اللي بترجع نسخة كاملة من المنتج.
  @Post(':id/duplicate')
  @UseGuards(ActiveStoreGuard)
  async duplicateProduct(@Param('id') id: string, @ActiveStore() store: StoreRecord) {
    return this.productService.duplicateProduct(store.id, id)
  }
  @Post(':id/images')
  @UseGuards(ActiveStoreGuard)
  async addImages(
    @Param('id') id: string,
    @ActiveStore() store: StoreRecord,
    @Body() body: { images: { url: string; alt?: string }[] },
  ) {
    return this.productService.addProductImages(store.id, id, body.images)
  }
  @Delete(':id/images/:imageId')
  @UseGuards(ActiveStoreGuard)
  async deleteImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @ActiveStore() store: StoreRecord,
  ) {
    return this.productService.deleteProductImage(store.id, id, imageId)
  }


}
