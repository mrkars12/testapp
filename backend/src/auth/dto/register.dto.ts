// src/auth/dto/register.dto.ts
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'البريد الإلكتروني غير صالح' })
  email: string;

  @IsString()
  @MinLength(4)
  username: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @IsNotEmpty()
  accounttype: string;

  @IsString()
  @IsNotEmpty()
  country: string;

  @IsOptional()
  @IsString()
  business_name?: string;

  @IsOptional()
  @IsString()
  fingerprint?: string;

  @IsOptional()
  @IsString()
  hardware_fingerprint?: string;
}