import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class CreateStoreDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم المتجر مطلوب' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: 'رابط المتجر مطلوب' })
  // هذا التعبير المنتظم يتأكد أن الرابط يحتوي فقط على أحرف صغيرة وأرقام وشرطة (بدون مسافات أو رموز غريبة)
  @Matches(/^[a-z0-9-]+$/, { message: 'الرابط يجب أن يحتوي على أحرف صغيرة، أرقام، أو شرطة فقط بدون مسافات' })
  slug: string;
}