import {
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common'

import { StoreService } from './store.service'

@Controller('stores/public')
export class PublicStoreController {
  constructor(
    private readonly storeService: StoreService,
  ) {}

  @Get(':slug')
  async getPublicStore(
    @Param('slug') slug: string,
  ) {
    return this.storeService.getPublicStore(slug)
  }

  @Get(':slug/sections')
  async getPublicSections(
    @Param('slug') slug: string,
    @Query('pageType') pageType: string = 'home',
  ) {
    return this.storeService.getPublicStoreSections(slug, pageType)
  }
}
