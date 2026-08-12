import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'

/**
 * أول DTO حقيقي في المشروع بعد تفعيل ValidationPipe في المرحلة 0.
 *
 * ملاحظة على السلوك: whitelist شغّالة و forbidNonWhitelisted مقفولة،
 * يعني أي حقل زيادة بيتشال بصمت مش بيرفض الطلب.
 */

export class OfferingInputDto {
  /** قيمة من enum PaymentMethodKey — بتتحقق كمان مقابل كتالوج البوابة */
  @IsString()
  @Length(1, 40)
  method!: string

  /** معرّف التكامل عند البوابة (integration_id في Paymob مثلاً) */
  @IsOptional()
  @IsString()
  @Length(0, 255)
  gateway_method_config?: string

  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  position?: number

  @IsOptional()
  @IsString()
  @Length(0, 120)
  display_name_ar?: string

  @IsOptional()
  @IsString()
  @Length(0, 120)
  display_name_en?: string

  @IsOptional()
  @IsObject()
  constraints?: Record<string, unknown>

  @IsOptional()
  @IsIn(['funds_secured', 'promise_accepted', 'awaiting_offline_settlement'])
  commitment_kind?: string

  @IsOptional()
  @IsIn(['automatic', 'manual'])
  capture_mode?: string
}

export class UpsertPaymentAccountDto {
  @IsIn(['test', 'live'])
  mode!: 'test' | 'live'

  /** اسم من اختيار التاجر يفرّق بين حسابات نفس البوابة */
  @IsOptional()
  @IsString()
  @Length(1, 120)
  display_name?: string

  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  /**
   * بيانات الاعتماد بصيغة { field_key: value }.
   *
   * ⚠️ الحقل اللي بيتبعت **نص فاضي أو مش موجود** معناه "ماتغيّرش"،
   * مش "امسح". المسح بيتم عن طريق endpoint الحذف لوحده — كده التاجر
   * مايقدرش يمسح سر بالغلط وهو بيعدّل حاجة تانية في نفس الفورم.
   */
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>

  @IsOptional()
  @IsString()
  @Length(3, 3)
  settlement_currency?: string

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => OfferingInputDto)
  offerings?: OfferingInputDto[]
}
