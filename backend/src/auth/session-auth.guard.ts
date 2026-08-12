import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()

    // 1. استخراج التوكن من الكوكي
    const token = request.cookies?.['access_token']
    if (!token) {
      throw new UnauthorizedException('No token')
    }

    // 2. التحقق من التوكن
    let payload: any
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      })
    } catch {
      throw new UnauthorizedException('Invalid token')
    }

    // 3. التحقق من وجود المستخدم + session_id
    let user: any
    try {
      user = await this.prisma.users.findUnique({
        where: { id: BigInt(payload.sub) },
        select: { id: true, session_id: true, email: true, username: true, last_activity_at: true },
      })
    } catch {
      throw new UnauthorizedException('Invalid user id')
    }

    if (!user) {
      throw new UnauthorizedException('User not found')
    }

    if (user.session_id !== payload.session_id) {
      throw new UnauthorizedException('Session expired')
    }

    // 4. التحقق من الـ device لو موجود في التوكن
    if (payload.device_id) {
      try {
        const device = await this.prisma.devices.findFirst({
          where: {
            id: BigInt(payload.device_id),
            logged_out_at: null,
            verified_at: { not: null } // ← ضيف ده
          },
        })
        if (!device) {
          throw new UnauthorizedException('Device logged out')
        }
      } catch (err: any) {
        // لو الـ error من UnauthorizedException نفسها — أعد رميها
        if (err instanceof UnauthorizedException) {
          throw err
        }
        // لو Prisma error في تحويل الـ BigInt — token فاسد
        throw new UnauthorizedException('Invalid device id')
      }
    }

    // 5. تمرير بيانات المستخدم للـ request
// src/auth/guards/session-auth.guard.ts -> خطوة رقم 5

    // 5. التحقق من الـ Idle Timeout الصارم في السيرفر في حالة إغلاق المتصفح فجأة
    const MAX_IDLE = 160 * 60 * 1000; // دقيقة واحدة بالملي ثانية
    const now = new Date();

    if (user.last_activity_at) {
      const lastActivityTime = new Date(user.last_activity_at).getTime();
      const timePassed = now.getTime() - lastActivityTime;

      // 🚨 لو المستخدم غاب أكتر من دقيقة وقفل التابة ورجع، يطرد فوراً
      if (timePassed > MAX_IDLE) {
        // تصفير الـ session_id في قاعدة البيانات لأمان قاطع
        await this.prisma.users.update({
          where: { id: user.id },
          data: { session_id: null }
        });
        throw new UnauthorizedException('Session expired due to inactivity');
      }
    }

    // إذا كان ضمن الوقت المسموح، نحدث وقت آخر نشاط له فوراً
    await this.prisma.users.update({
      where: { id: user.id },
      data: { last_activity_at: now }
    });

    request['user'] = {
      ...payload,
      ...user,
      id: user.id.toString(),  // ← حول لـ string
    }

    return true;
  }
}