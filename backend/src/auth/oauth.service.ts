// src/auth/oauth.service.ts
import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { JwtService } from '@nestjs/jwt'
import * as crypto from 'crypto'
import type { Response } from 'express'

export interface OAuthUserDto {
  provider: string
  providerId: string
  email: string
  displayName: string
  avatar?: string
  accessToken: string
  refreshToken?: string
  fingerprint?: string
  action?: 'login' | 'register' | 'individual' | 'business'
  userAgent?: string
  ipAddress?: string
}

export type OAuthResult =
  | { status: 'success';       sessionId: string; user: any }
  | { status: 'device_verify'; tempToken: string;  email: string }
  | { status: 'not_found' }
  | { status: 'already_exists' }

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name)

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  // ─────────────────────────────────────────────────────────
  // النقطة الرئيسية — تُستدعى من الـ Controller
  // ─────────────────────────────────────────────────────────
  async handleOAuthUser(dto: OAuthUserDto, res: Response): Promise<OAuthResult> {
    const isRegister = dto.action === 'register'
      || dto.action === 'individual'
      || dto.action === 'business'

    // ── البحث عن مستخدم موجود ──
    let user = await this.findExistingUser(dto.provider, dto.providerId, dto.email)

    // ════════════════════════════════════════════
    // مسار التسجيل
    // ════════════════════════════════════════════
    if (isRegister) {
      if (user) {
        // حساب موجود مسبقاً
        return { status: 'already_exists' }
      }

      // إنشاء مستخدم جديد
      user = await this.createOAuthUser(dto)

      // ربط الـ provider
      await this.linkProvider(user.id, dto)

      // تسجيل الجهاز كموثوق تلقائياً (أول جهاز)
      if (dto.fingerprint) {
        await this.trustDevice(user.id, dto.fingerprint, dto.userAgent, dto.ipAddress)
      }

      // إنشاء session
      const sessionId = await this.createSession(user, res)
      return { status: 'success', sessionId, user }
    }

    // ════════════════════════════════════════════
    // مسار تسجيل الدخول
    // ════════════════════════════════════════════
    if (!user) {
      return { status: 'not_found' }
    }

    // ربط الـ provider لو مش مربوط (حساب موجود بالإيميل بس مش مربوط بـ provider)
    await this.linkProvider(user.id, dto)

    // فحص الجهاز
    const isTrusted = dto.fingerprint
      ? await this.isDeviceTrusted(user.id, dto.fingerprint)
      : true

    if (!isTrusted) {
      // جهاز جديد → إرسال كود التحقق
      await this.sendVerificationCode(user.id, dto.fingerprint!, user.email, dto.ipAddress, dto.userAgent)
      const tempToken = this.createTempToken(user.id, dto.fingerprint!, user.email)
      return { status: 'device_verify', tempToken, email: user.email }
    }

    // جهاز موثوق → session مباشرة
    const sessionId = await this.createSession(user, res)
    return { status: 'success', sessionId, user }
  }

  // ─────────────────────────────────────────────────────────
  // التحقق من كود الجهاز
  // ─────────────────────────────────────────────────────────
  // src/auth/oauth.service.ts -> استبدل دالة verifyDeviceCode القديمة بهذه النسخة المحدثة:

  async verifyDeviceCode(
    tempToken: string,
    code: string,
    res: Response,
  ): Promise<{ authenticated: boolean; message?: string }> {
    
    // 🍏 1. فك تشفير الـ AES-256-CBC القادم من الفرونت إند فوراً لاستخراج الـ JWT الحقيقي
    let decryptedToken = tempToken;
    try {
      if (tempToken && tempToken.includes(':')) {
        const [ivHex, encryptedHex] = tempToken.split(':');
        const key = process.env.JWT_SECRET!.slice(0, 32);
        const iv = Buffer.from(ivHex, 'hex');
        
        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key), iv);
        decryptedToken = Buffer.concat([
          decipher.update(Buffer.from(encryptedHex, 'hex')),
          decipher.final()
        ]).toString('utf-8');
      }
    } catch (err) {
      return { authenticated: false, message: 'طلب غير صالح أو التوكن تالف' };
    }

    // 2. فك الـ temp token (الـ JWT الأصلي بعد استعادته بنجاح)
    let payload: any
    try {
      payload = this.jwtService.verify(decryptedToken)
    } catch {
      return { authenticated: false, message: 'انتهت صلاحية الجلسة' }
    }

    if (payload.type !== 'oauth_device_verify') {
      return { authenticated: false, message: 'طلب غير صالح' }
    }

    const userId = BigInt(payload.sub)

    // البحث عن الكود في devices
    const device = await this.prisma.devices.findFirst({
      where: {
        user_id: userId,
        fingerprint: payload.fingerprint,
        verification_token: code,
        verification_expires_at: { gt: new Date() },
      },
    })

    if (!device) {
      return { authenticated: false, message: 'الكود غير صحيح أو منتهي الصلاحية' }
    }

    // تأكيد وتفعيل الجهاز
    await this.prisma.devices.update({
      where: { id: device.id },
      data: {
        verified_at: new Date(),
        verification_token: null,
        verification_expires_at: null,
        updated_at: new Date(),
      },
    })

    // إضافة للـ trusted_devices ليصبح موثوقاً
    await this.trustDevice(userId, payload.fingerprint)

    const user = await this.prisma.users.findUnique({ where: { id: userId } })
    if (!user) return { authenticated: false, message: 'المستخدم غير موجود' }

    // 🍏 التعديل السحري: نرجع نجاح التفعيل فقط بدون توليد جلسة أو كوكيز
    return { authenticated: true, message: 'تم تفعيل وتوثيق الجهاز بنجاح' }
  }


  // ─────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────
  private async findExistingUser(provider: string, providerId: string, email?: string) {
    // أولاً: عبر الـ provider
    const oauthProvider = await this.prisma.oauth_providers.findUnique({
      where: { provider_provider_id: { provider, provider_id: providerId } },
      include: { users: true },
    })
    if (oauthProvider) return oauthProvider.users

    // ثانياً: عبر الإيميل
    if (email) {
      return this.prisma.users.findUnique({ where: { email } })
    }
    return null
  }

  private async createOAuthUser(dto: OAuthUserDto) {
    const username = await this.generateUniqueUsername(dto.displayName)
    const accounttype = dto.action === 'business' ? 'business' : 'individual'

    return this.prisma.users.create({
      data: {
        email: dto.email,
        username,
        fullname: dto.displayName,
        avatar: dto.avatar ?? null,
        password: '',
        email_verified_at: new Date(),
        accounttype,
        timezone: 'UTC',
        created_at: new Date(),
        updated_at: new Date(),
        wallets: {
          create: {
            balance: 0,
            currency: 'USDDC',
            created_at: new Date(),
            updated_at: new Date(),
          },
        },
      },
    })
  }

  private async linkProvider(userId: bigint, dto: OAuthUserDto) {
    const existing = await this.prisma.oauth_providers.findUnique({
      where: {
        provider_provider_id: { provider: dto.provider, provider_id: dto.providerId },
      },
    })

    if (existing) {
      await this.prisma.oauth_providers.update({
        where: { id: existing.id },
        data: {
          access_token: dto.accessToken,
          refresh_token: dto.refreshToken ?? null,
          updated_at: new Date(),
        },
      })
    } else {
      await this.prisma.oauth_providers.create({
        data: {
          user_id: userId,
          provider: dto.provider,
          provider_id: dto.providerId,
          access_token: dto.accessToken,
          refresh_token: dto.refreshToken ?? null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      })
    }
  }

  private async isDeviceTrusted(userId: bigint, fingerprint: string): Promise<boolean> {
    const device = await this.prisma.devices.findFirst({
      where: {
        user_id: userId,
        fingerprint,
        verified_at: { not: null },
      },
    })
    return !!device
  }

  private async trustDevice(
    userId: bigint,
    fingerprint: string,
    userAgent?: string,
    ipAddress?: string,
  ) {
    const existing = await this.prisma.devices.findFirst({
      where: { user_id: userId, fingerprint },
    })

    if (existing) {
      await this.prisma.devices.update({
        where: { id: existing.id },
        data: {
          verified_at: new Date(),
          verification_token: null,
          verification_expires_at: null,
          last_active_at: new Date(),
          updated_at: new Date(),
        },
      })
    } else {
      await this.prisma.devices.create({
        data: {
          user_id: userId,
          fingerprint,
          verified_at: new Date(),
          browser: userAgent ?? null,
          ip_address: ipAddress ?? null,
          platform: userAgent?.includes('Mobi') ? 'Mobile' : 'Desktop',
          last_active_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        },
      })
    }

    // trusted_devices أيضاً
    await this.prisma.trusted_devices.upsert({
      where: {
        user_id_device_fingerprint: { user_id: userId, device_fingerprint: fingerprint },
      },
      update: { last_login_at: new Date(), updated_at: new Date() },
      create: {
        user_id: userId,
        device_fingerprint: fingerprint,
        last_login_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      },
    })
  }

  private async sendVerificationCode(
    userId: bigint,
    fingerprint: string,
    email: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)

    const existing = await this.prisma.devices.findFirst({
      where: { user_id: userId, fingerprint },
    })

    if (existing) {
      await this.prisma.devices.update({
        where: { id: existing.id },
        data: {
          verification_token: code,
          verification_expires_at: expiresAt,
          verified_at: null,
          updated_at: new Date(),
        },
      })
    } else {
      await this.prisma.devices.create({
        data: {
          user_id: userId,
          fingerprint,
          verification_token: code,
          verification_expires_at: expiresAt,
          ip_address: ipAddress ?? null,
          browser: userAgent ?? null,
          platform: userAgent?.includes('Mobi') ? 'Mobile' : 'Desktop',
          verified_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      })
    }

    // TODO: أرسل الكود بالإيميل هنا
    this.logger.log(`[DEV] Verification code for ${email}: ${code}`)
  }

  private createTempToken(userId: bigint, fingerprint: string, email: string): string {
    return this.jwtService.sign(
      {
        sub: userId.toString(),
        fingerprint,
        email,
        type: 'oauth_device_verify',
      },
      { expiresIn: '15m' },
    )
  }

  private async createSession(user: any, res: Response): Promise<string> {
    const sessionId = crypto.randomBytes(32).toString('hex')

    await this.prisma.users.update({
      where: { id: user.id },
      data: { session_id: sessionId, last_activity_at: new Date(), updated_at: new Date() },
    })

    // JWT cookie
    const payload = {
      sub: user.id.toString(),
      email: user.email,
      username: user.username,
      session_id: sessionId,
    }

    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET,
      expiresIn: '7d',
    })

    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    })

    return sessionId
  }

  private async generateUniqueUsername(displayName: string): Promise<string> {
    const base = displayName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'user'
    let username = base
    let counter = 1
    while (await this.prisma.users.findUnique({ where: { username } })) {
      username = `${base}${counter++}`
    }
    return username
  }
}