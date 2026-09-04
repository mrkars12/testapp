// src/auth/dto/register.dto.ts
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { SUPPORTED_STORE_CURRENCIES } from '../../stores/store-defaults';

// Registration produces ONE thing: a user account + its first store. There
// is no personal/business branch in the public signup experience anymore —
// `accounttype`/`business_name`/`entity_type` remain as columns on `users`
// only because OAuth's `action=business` query param and pre-existing
// business accounts still read/write them; new public signups never set
// them and always get `accounttype: 'individual'` (enforced server-side in
// AuthService.processRegistration, not trusted from the client).
//
// `username` is intentionally NOT a field here anymore (registration-form
// refinement, "remove username"): it's a required, unique column on
// `users`, but nothing about authentication or any other feature depends
// on the USER choosing it — login is by email (see LoginDto), and nothing
// else reads it as an identifier. AuthService.processRegistration derives
// one automatically (see username.util.ts), the same way OAuth signup
// already did before this change.
export class RegisterDto {
  @IsEmail({}, { message: 'البريد الإلكتروني غير صالح' })
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @IsNotEmpty({ message: 'الاسم الأول مطلوب' })
  first_name: string;

  @IsString()
  @IsNotEmpty({ message: 'اسم العائلة مطلوب' })
  last_name: string;

  // E.164: '+' followed by 8-15 digits, first digit 1-9. The frontend
  // normalizes to this shape with libphonenumber-js before submitting;
  // this is the backend's own defense-in-depth check, not a second
  // validation system — it accepts exactly what the frontend is expected
  // to send and nothing looser.
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'رقم الهاتف غير صالح' })
  phone: string;

  @IsString()
  @IsNotEmpty()
  country: string;

  // First-store fields (Part 2/3: store identity + currency are collected
  // as part of the same onboarding flow, but they belong to the STORE, not
  // the account).
  @IsString()
  @IsNotEmpty({ message: 'اسم المتجر مطلوب' })
  store_name: string;

  @IsOptional()
  @IsString()
  store_slug?: string;

  @IsIn(SUPPORTED_STORE_CURRENCIES, { message: 'عملة غير مدعومة' })
  store_currency: string;

  @IsOptional()
  @IsString()
  fingerprint?: string;

  @IsOptional()
  @IsString()
  hardware_fingerprint?: string;
}
