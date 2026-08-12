// stores.zip/store-public.controller.ts
import { Controller, Get, Param, Query } from '@nestjs/common'
import { StoreService } from './store.service'

@Controller('stores/public')
export class StorePublicController {
  constructor(private readonly storeService: StoreService) {}

  @Get(':slug')
  async getStore(@Param('slug') slug: string) {
    return this.storeService.getPublicStore(slug)
  }

  @Get(':slug/sections')
  async getStoreSections(
    @Param('slug') slug: string,
    @Query('pageType') pageType: string = 'home',
  ) {
    return this.storeService.getPublicStoreSections(slug, pageType)
  }

  @Get(':slug/theme')
  async getStoreTheme(@Param('slug') slug: string) {
    return this.storeService.getPublicStoreTheme(slug)
  }

  @Get(':slug/pages/:pageSlug')
  async getStorePage(
    @Param('slug') slug: string,
    @Param('pageSlug') pageSlug: string,
  ) {
    return this.storeService.getPublicStorePage(slug, pageSlug)
  }

  @Get(':slug/menus/:handle')
  async getStoreMenu(
    @Param('slug') slug: string,
    @Param('handle') handle: string,
  ) {
    return this.storeService.getPublicStoreMenu(slug, handle)
  }
}