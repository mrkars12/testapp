// src/uploads/uploads.controller.ts
import { Controller, Post, Delete, Body, UseGuards } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ActiveStoreGuard } from '../stores/active-store.guard';
import { ActiveStoreId } from '../stores/active-store.decorator';

/**
 * ⚠️ الرفع لازم يتبع المتجر الفعّال، مش أول متجر لليوزر.
 *
 * قبل كده الكنترولر كان بيبعت req.user.id للسيرفس، واللي كانت بتحل
 * المتجر بـ findFirst({ ownerId }) — يعني أي يوزر عنده أكتر من متجر
 * كان كل رفعه بتتكتب على متجر عشوائي (أول صف يرجع من Postgres)، حتى
 * لو هو شغّال على متجر تاني خالص. الصورة نفسها كانت بتترفع تحت
 * `${storeId}/products/...` بالمتجر الغلط، وصف upload بيتسجّل
 * لمتجر غير اللي المنتج فيه.
 *
 * دلوقتي نفس نمط باقي الموديولات بالظبط: ActiveStoreGuard بيحل المتجر
 * ويتحقق من الملكية، والكنترولر بياخد الـ id منه.
 */
@UseGuards(SessionAuthGuard)
@Controller('uploads')
export class UploadsController {
  constructor(private uploadsService: UploadsService) {}

  @Post('presign')
  @UseGuards(ActiveStoreGuard)
  presign(
    @ActiveStoreId() storeId: bigint,
    @Body() body: { fileName: string; mimeType: string; size: number; folder: 'products' | 'variants' },
  ) {
    return this.uploadsService.presign(storeId, body);
  }

  @Post('confirm')
  @UseGuards(ActiveStoreGuard)
  confirm(
    @ActiveStoreId() storeId: bigint,
    @Body() body: { key: string; attachedType?: string; attachedId?: string },
  ) {
    return this.uploadsService.confirm(storeId, body.key, body.attachedType, body.attachedId);
  }

  @Delete('image')
  @UseGuards(ActiveStoreGuard)
  remove(@ActiveStoreId() storeId: bigint, @Body('key') key: string) {
    return this.uploadsService.remove(storeId, key);
  }
}
