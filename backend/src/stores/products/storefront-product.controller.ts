import { Controller, Get, Param, Query } from '@nestjs/common'
import { ProductService } from './product.service'

@Controller('storefront')
export class StorefrontProductController {
  constructor(private readonly productService: ProductService) {}

  @Get(':slug/products')
  async getStorefrontProducts(
    @Param('slug') slug: string,
    @Query('search') search?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.productService.getStorefrontProducts(slug, {
      search,
      page: parseInt(page),
      limit: parseInt(limit),
    })
  }

  @Get(':slug/products/:handle')
  async getStorefrontProduct(
    @Param('slug') slug: string,
    @Param('handle') handle: string,
  ) {
    return this.productService.getStorefrontProductByHandle(slug, handle)
  }
}