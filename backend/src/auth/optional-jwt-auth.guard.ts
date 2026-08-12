import {
  CanActivate,
  ExecutionContext,
  Injectable
} from '@nestjs/common'

import { JwtService } from '@nestjs/jwt'

import { PrismaService }
from '../prisma/prisma.service'

import { Request } from 'express'

@Injectable()
export class OptionalJwtAuthGuard
  implements CanActivate
{
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService
  ) {}

  async canActivate(
    context: ExecutionContext
  ): Promise<boolean> {

    const request =
      context
        .switchToHttp()
        .getRequest()

    const token =
      this.extractToken(request)

    // ✅ Guest
    if (!token) {

      request.user = null

      return true
    }

    try {

      const payload =
        await this.jwtService.verifyAsync(
          token,
          {
            secret:
              process.env.JWT_SECRET
          }
        )

      // ✅ جلب المستخدم الحقيقي
      const user = await this.prisma.users.findUnique({
  where: {
    id: BigInt(payload.sub),
  },
})

      request.user = user || null

    } catch {

      request.user = null
    }

    return true
  }

  private extractToken(
    request: Request
  ): string | undefined {

    return request.cookies?.[
      'access_token'
    ]
  }
}