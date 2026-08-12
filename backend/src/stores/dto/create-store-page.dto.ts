// src/stores/dto/create-store-page.dto.ts
import { IsString, IsEnum, IsOptional, IsBoolean, Matches } from 'class-validator';

export enum PageType {
  STANDARD = 'STANDARD',
  PRODUCT_WITH_HERO = 'PRODUCT_WITH_HERO',
  PRODUCT_WITHOUT_HERO = 'PRODUCT_WITHOUT_HERO',
}

export class CreateStorePageDto {
  @IsString()
  title: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'الرابط يجب أن يحتوي على أحرف إنجليزية صغيرة وأرقام وشرطات فقط',
  })
  slug: string;

  @IsEnum(PageType)
  type: PageType;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}