import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  Query,
  NotFoundException,
} from '@nestjs/common'

import { StoreService } from './store.service'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import { ActiveStoreGuard } from './active-store.guard'
import { ActiveStore } from './active-store.decorator'
import type { store as StoreRecord } from '@prisma/client'
import { CreateStorePageDto } from './dto/create-store-page.dto'
import { CreateSectionDto } from './dtos/create-section.dto'
import { UpdateSectionDto } from './dtos/update-section.dto'
import { ReorderSectionsDto } from './dtos/reorder-sections.dto'
import { UpdateColorsDto } from './dtos/update-colors.dto'
import { UpdateTypographyDto } from './dtos/update-typography.dto'
import { UpdateHeaderDto } from './dtos/update-header.dto'


@Controller('stores')
@UseGuards(SessionAuthGuard)
export class StoreController {
  constructor(private readonly storeService: StoreService) {}

  // =====================
  // STORES
  // =====================

  @Get()
  async getStores(@Request() req) {
    return this.storeService.getMyStores(req.user.id)
  }

  @Post()
  async create(@Request() req, @Body() body: any) {
    return this.storeService.createStore(req.user.id, body)
  }



  // =====================
  // PAGES
  // =====================

  @Get('pages')
  @UseGuards(ActiveStoreGuard)
  async getPages(@ActiveStore() store: StoreRecord) {
    return this.storeService.getStorePages(store.id)
  }

  @Post('pages')
  @UseGuards(ActiveStoreGuard)
  async createPage(@ActiveStore() store: StoreRecord, @Body() body: CreateStorePageDto) {
    return this.storeService.createStorePage(store.id, body)
  }

  @Post('pages/reorder')
  @UseGuards(ActiveStoreGuard)
  async reorderPages(@ActiveStore() store: StoreRecord, @Body() body: any) {
    return this.storeService.reorderPages(store.id, body.pages)
  }

  // =====================
  // MENUS
  // =====================

  @Get('menus')
  @UseGuards(ActiveStoreGuard)
  async getMenus(@ActiveStore() store: StoreRecord) {
    return this.storeService.getMenus(store.id)
  }

  @Post('menus')
  @UseGuards(ActiveStoreGuard)
  async createMenu(@ActiveStore() store: StoreRecord, @Body() body: any) {
    return this.storeService.createMenu(store.id, body.name)
  }

  @Put('menus/:id')
  @UseGuards(ActiveStoreGuard)
  async updateMenu(@Param('id') id: string, @ActiveStore() store: StoreRecord, @Body() body: any) {
    return this.storeService.updateMenu(store.id, id, body)
  }

  @Delete('menus/:id')
  @UseGuards(ActiveStoreGuard)
  async deleteMenu(@Param('id') id: string, @ActiveStore() store: StoreRecord) {
    return this.storeService.deleteMenu(store.id, id)
  }

  @Post('menus/:id/items')
  @UseGuards(ActiveStoreGuard)
  async addMenuItem(@Param('id') id: string, @ActiveStore() store: StoreRecord, @Body() body: any) {
    return this.storeService.addMenuItem(store.id, id, body)
  }

  @Put('menus/items/:id')
  @UseGuards(ActiveStoreGuard)
  async updateMenuItem(@Param('id') id: string, @ActiveStore() store: StoreRecord, @Body() body: any) {
    return this.storeService.updateMenuItem(store.id, id, body)
  }

  @Delete('menus/items/:id')
  @UseGuards(ActiveStoreGuard)
  async deleteMenuItem(@Param('id') id: string, @ActiveStore() store: StoreRecord) {
    return this.storeService.deleteMenuItem(store.id, id)
  }

  @Post('menus/reorder')
  @UseGuards(ActiveStoreGuard)
  async reorderMenu(@ActiveStore() store: StoreRecord, @Body() body: any) {
    return this.storeService.reorderMenuItems(store.id, body.items)
  }

  @Get('menus/:id')
  @UseGuards(ActiveStoreGuard)
  async getMenu(@Param('id') id: string, @ActiveStore() store: StoreRecord) {
    return this.storeService.getMenu(store.id, id)
  }

  @Post('menus/:id/duplicate')
  @UseGuards(ActiveStoreGuard)
  async duplicateMenu(@Param('id') id: string, @ActiveStore() store: StoreRecord) {
    return this.storeService.duplicateMenu(store.id, id)
  }

  // =====================
  // LINK PICKER
  // =====================

  @Get('link-picker')
  @UseGuards(ActiveStoreGuard)
  async getLinkPicker(@ActiveStore() store: StoreRecord) {
    return this.storeService.getLinkPicker(store.id)
  }

  // =====================
  // THEME
  // =====================



  @Get('theme')
  @UseGuards(ActiveStoreGuard)
  async getTheme(@ActiveStore() store: StoreRecord) {
    return this.storeService.getTheme(store.id)
  }

@Put('theme')
@UseGuards(ActiveStoreGuard)
async updateTheme(@ActiveStore() store: StoreRecord, @Body() body: any) {
  return this.storeService.updateTheme(store.id, body)
}

@Post('theme/publish')
@UseGuards(ActiveStoreGuard)
async publishTheme(
  @ActiveStore() store: StoreRecord,
) {
  return this.storeService.publishTheme(
    store.id,
  )
}
@Get('theme/preview')
@UseGuards(ActiveStoreGuard)
async getThemePreview(
  @ActiveStore() store: StoreRecord,
) {
  return this.storeService.getThemePreview(
    store,
  )
}
  @Put('theme/colors')
  @UseGuards(ActiveStoreGuard)
  async updateThemeColors(@ActiveStore() store: StoreRecord, @Body() body: UpdateColorsDto) {
    return this.storeService.updateThemeColors(store.id, body)
  }

  @Put('theme/typography')
  @UseGuards(ActiveStoreGuard)
  async updateThemeTypography(@ActiveStore() store: StoreRecord, @Body() body: UpdateTypographyDto) {
    return this.storeService.updateThemeTypography(store.id, body)
  }

  @Put('theme/header')
  @UseGuards(ActiveStoreGuard)
  async updateThemeHeader(@ActiveStore() store: StoreRecord, @Body() body: UpdateHeaderDto) {
    return this.storeService.updateThemeHeader(store.id, body)
  }

  @Put('theme/footer')
  @UseGuards(ActiveStoreGuard)
  async updateThemeFooter(@ActiveStore() store: StoreRecord, @Body() body: any) {
    return this.storeService.updateThemeFooter(store.id, body)
  }

  // =====================
  // THEME SECTIONS
  // =====================

  @Get('theme/sections')
  @UseGuards(ActiveStoreGuard)
  async getThemeSections(@ActiveStore() store: StoreRecord, @Query('pageType') pageType: string = 'home') {
    return this.storeService.getThemeSections(store.id, pageType)
  }

  @Post('theme/sections')
  @UseGuards(ActiveStoreGuard)
  async addThemeSection(@ActiveStore() store: StoreRecord, @Body() body: CreateSectionDto) {
    return this.storeService.addThemeSection(store.id, body)
  }

  @Put('theme/sections/reorder')
@UseGuards(ActiveStoreGuard)
async reorderThemeSections(@ActiveStore() store: StoreRecord, @Body() body: ReorderSectionsDto) {
  return this.storeService.reorderThemeSections(store.id, body.sections)
}

  @Put('theme/sections/:id')
  @UseGuards(ActiveStoreGuard)
  async updateThemeSection(@Param('id') id: string, @ActiveStore() store: StoreRecord, @Body() body: UpdateSectionDto) {
    return this.storeService.updateThemeSection(store.id, id, body)
  }

  @Delete('theme/sections/:id')
  @UseGuards(ActiveStoreGuard)
  async deleteThemeSection(@Param('id') id: string, @ActiveStore() store: StoreRecord) {
    return this.storeService.deleteThemeSection(store.id, id)
  }

//   @Get(':slug/products')
// async getPublicProducts(
//   @Param('slug') slug: string,
//   @Query('limit') limit: string = '8',
// ) {
//   return this.storeService.getPublicStoreProducts(slug, parseInt(limit))
// }

  @Post(':slug')
async update(@Request() req, @Param('slug') slug: string, @Body() body: any) {
  if (slug === 'products') {
    throw new NotFoundException('Store not found')
  }
  return this.storeService.updateStore(req.user.id, slug, body)
}
}
