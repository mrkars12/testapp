import { Controller,Query, Post, Body, Get, UseGuards, Req,Res, Headers, BadRequestException, UnauthorizedException,ForbiddenException, UseInterceptors } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthGuard } from './auth.guard';
import type { Response } from 'express'; // 🚩 ضروري جداً إضافة كلمة type هنا
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard'
import { SessionAuthGuard } from './session-auth.guard'
import { ClearCacheInterceptor } from './clear-cache.interceptor';


@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

// src/auth/auth.controller.ts

@Post('login')
async login(
  @Body() loginDto: any,
  @Headers('user-agent') ua: string,
  @Req() req: any,
  @Res({ passthrough: true }) res: Response
) {
  const ip =
    req.ip ||
    req.headers['x-forwarded-for'] ||
    '127.0.0.1';

  // 🚩 قمنا بتمرير الـ res كمعامل سابع للـ Service
  const result = await this.authService.login(
    loginDto.email,
    loginDto.password,
    loginDto.cf_turnstile_token || null,
    loginDto.hardware_fingerprint || loginDto.fingerprint,
    ua,
    ip,
    res 
  );

  // تحويل النوع مؤقتاً إلى any داخل الدالة لتفادي قيود الـ Union Types الصارمة في TypeScript
  const resData = result as any;

  /**
   * ❌ failed / globally blocked / locked
   */
  if (resData.success === false) {
    return resData;
  }

  /**
   * ✅ 2FA required
   */
  if (resData.requires_2fa) {
    return resData;
  }

  /**
   * ✅ device verification required
   */
  if (resData.requires_device_verification) {
    return resData;
  }

  /**
   * ✅ authenticated (الجهاز غير موثوق وتم تفعيله لأول مرة عبر الـ Service بالأسفل)
   * إذا كان الـ Service قد أرجع الـ user_raw (في الحالات القديمة) نقوم بالتوثيق هنا، 
   * أما إذا كان جهازاً موثوقاً فالـ Service قام بالمهمة وأرجع الاستجابة الجاهزة بالفعل.
   */
  if (resData.user_raw) {
    return this.authService.generateAuthResponse(
      resData.user_raw,
      loginDto.fingerprint,
      ua,
      res
    );
  }

  // إرجاع النتيجة الجاهزة في حال تم إنشاؤها بالكامل داخل الـ Service للمستخدم الموثوق
  return resData;
}

@Post('forgot-password')

async forgotPassword(

  @Body('email')
  email: string
) {

  return this.authService
    .forgotPassword(email)
}

@Get('recover-password/verify')

async verifyRecoverCode(

  @Query('code')
  code: string
) {

  return this.authService
    .verifyRecoverCode(code)
}

@Post('recover-password/reset')

async resetPassword(
  @Body() body: any
) {

  return this.authService
    .resetPassword(body)
}

@Post('verify-otp')

async verifyOtp(
  @Body() body: any,
  @Headers('user-agent') ua: string,
  @Res({ passthrough: true }) res: Response
) {

  return this.authService.verifyOtp(
    body.email,
    body.code || body.otp,
    body.fingerprint,
    ua,
    res
  )
}

@Post('resend-otp')

async resendOtp(
  @Body() body: any
) {

  return this.authService
    .resendOtp(
      body.email
    )
}
  @Post('device/verify-code')
  async verifyDevice(
    @Body() body: any, 
    @Headers('user-agent') ua: string, 
    @Res({ passthrough: true }) res: Response, 
    @Req() req: any
  ) {
    const fingerprint = body.hardware_fingerprint || body.fingerprint;
    const ip = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';

    if (!body.code || !fingerprint) {
      throw new BadRequestException('الكود والبصمة مطلوبان');
    }

    // تمرير 5 معاملات بالترتيب الصحيح (code, fingerprint, ua, res, ip)
    return this.authService.verifyDeviceCode(body.code, fingerprint, ua, res, ip);
  }

  @Post('device/resend-code')

async resendDeviceCode(
  @Body() body: any
) {

  return this.authService
    .resendDeviceOtp(

      body.email,

      body.fingerprint
    )
}

@Post('2fa/login')

async verify2FALogin(

  @Body() body: any,

  @Headers('user-agent')
  ua: string,

  @Res({ passthrough: true })
  res: Response,

  @Req() req: any
) {

  const ip =

    req.ip ||

    req.headers['x-forwarded-for'] ||

    '127.0.0.1'

  return this.authService
    .verify2FALogin(

      body.email,

      body.code,

      body.fingerprint,

      ua,

      res,

      ip
    )
}

@UseGuards(SessionAuthGuard)

@Get('2fa/generate')
async generate2FA(@Req() req: any) {
  const userId = BigInt(req.user.sub)

  if (req.user?.two_factor_enabled) {
    throw new ForbiddenException('2FA already enabled')
  }

  return this.authService.generate2FA(userId)
}

@UseGuards(SessionAuthGuard)

@Post('2fa/confirm')
async confirm2FA(
  @Req() req,
  @Res({ passthrough: true }) res: Response,
  @Body('code') code: string
) {

  const fingerprint =

    req.headers[
      'x-device-fingerprint'
    ] as string

  const ua =
    req.headers[
      'user-agent'
    ] || ''

  const ip =
    req.ip

  return this.authService.confirm2FA(

    req.user.sub,

    code,

    fingerprint,

    ua,

    res,

    ip
  )
}

@UseGuards(SessionAuthGuard)

@Post('2fa/disable')

async disable2FA(

  @Req() req: any,

  @Body() body: any
) {

  return this.authService.disable2FA(

    BigInt(req.user.sub),

    body.code
  )
}

@UseGuards(SessionAuthGuard)

@Get('2fa/status')

async get2FAStatus(
  @Req() req: any
) {

  return this.authService
    .get2FAStatus(
      BigInt(req.user.sub)
    )
}

// ========================================================
  // 🔄 مسار تجديد الـ Access Token صامتاً (بدون Guard خارجي لمنع الـ 401 الزائف)
  // ========================================================
  @Post('refresh') // 💡 قمنا بحذف @UseGuards(OptionalJwtAuthGuard) من هنا
  async refresh(
    @Req() req: any,
    @Headers('user-agent') ua: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const currentToken = req.cookies?.['access_token'];
    const ip = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';

    if (!currentToken) {
      throw new UnauthorizedException('Session expired or token missing');
    }

    try {
      // نمرر التوكن للـ Service ليقوم بفتحه يدوياً حتى لو كان منتهي الصلاحية زمنيًا
      const result = await this.authService.refreshTokens(currentToken, ua, ip, res);
      return result;
    } catch (error) {
      // تنظيف شامل فور الفشل الفعلي للتوكن (إذا كان مزيفاً أو تم التلاعب به)
      res.clearCookie('access_token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
      });
      throw new UnauthorizedException('Invalid or expired session');
    }
  }

@UseGuards(OptionalJwtAuthGuard)

@Post('logout')

async logout(

  @Req() req: any,

  @Headers(
    'x-device-fingerprint'
  )
  fingerprint: string,

  @Res({ passthrough: true })
  res: Response
) {

  /**
   * ✅ current user
   */
  const userId =
  req.user?.sub

if (
  userId &&
  fingerprint
) {

  try {

  await this.authService.logout(

    BigInt(userId),

    fingerprint,

    res
  )

} catch {}
}

  /**
   * ✅ clear auth cookie
   */
  res.clearCookie(
  'access_token',

  {
    httpOnly: true,

    secure:
      process.env.NODE_ENV ===
      'production',

    sameSite: 'lax',

    path: '/',
  }
)

  return {
    success: true
  }
}
  // 3. فحص الجلسات المعلقة (لو الصفحة حصل لها Refresh)
  @Get('check-pending-verification')
  async checkPending(@Headers('X-Device-Fingerprint') fingerprint: string) {
    return this.authService.checkPendingDevice(fingerprint);
  }

  // 4. فحص البريد (تم نقل المنطق للـ Service لإصلاح خطأ this.prisma)
  @Post('check-email')
  async checkEmail(@Body('email') email: string) {
    return this.authService.isEmailAvailable(email);
  }

  // 5. فحص اسم المستخدم (تم نقل المنطق للـ Service لإصلاح خطأ this.prisma)
  @Post('check-username')
  async checkUsername(@Body('username') username: string) {
    return this.authService.isUsernameAvailable(username);
  }

  // 6. بداية التسجيل
  @Post('register/start')
  async startRegister(@Body('accounttype') accountType: string) {
    return this.authService.createRegisterFlow(accountType);
  }

  // 7. إكمال التسجيل
  @Post('register/complete')
async completeRegister(
  @Body() registerDto: RegisterDto,
  @Headers('X-Register-Flow') flowToken: string,
  @Headers('X-Register-Signature') flowSignature: string,
  @Res({ passthrough: true }) res: Response,
) {
  return this.authService.processRegistration(registerDto, flowToken, flowSignature, res);
}

@Post('force-clear-cookie')
  async forceClearCookie(@Res({ passthrough: true }) res: Response) {
    // إرسال أمر رسمي للمتصفح لتصفير وحذف الكوكي الـ HttpOnly من الجذور
    res.clearCookie('access_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });

    return {
      success: true,
      message: 'Session cookie destroyed successfully',
    };
  }


@UseGuards(SessionAuthGuard)
@Post('heartbeat')
async heartbeat(@Req() req: any) {
  // يكفي أن الـ AuthGuard يتحقق من الجلسة
  // لو الجلسة منتهية، AuthGuard يرمي 401 تلقائياً
  return { ok: true, ts: Date.now() }
}

  // 8. جلب بيانات المستخدم الحالي
  
// 1. أضف هذا الاستيراد في أعلى ملف الـ auth.controller.ts مع بقية الـ imports:

// 2. انزل عند دالة me وازرعه فوقها بالملي بالشكل ده:
  @UseGuards(OptionalJwtAuthGuard)
  @UseInterceptors(ClearCacheInterceptor) // 🌟 هنا لمنع كاش الجلسة الحالية فوراً
  @Get('me')
  me(@Req() req: any) {
    if (!req.user) {
      return {
        authenticated: false,
        user: null,
        session_id: null
      }
    }

    return {
      authenticated: true,
      user: req.user,
      session_id: req.user.session_id
    }
  }
}