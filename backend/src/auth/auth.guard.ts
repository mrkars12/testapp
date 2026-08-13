import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from '@nestjs/common'

import { JwtService } from '@nestjs/jwt'

import { Request, Response }
from 'express'

@Injectable()
export class AuthGuard
  implements CanActivate
{
  constructor(
    private jwtService: JwtService
  ) {}

  async canActivate(
    context: ExecutionContext
  ): Promise<boolean> {

    const request =
      context
        .switchToHttp()
        .getRequest<Request>()

    const response =
      context
        .switchToHttp()
        .getResponse<Response>()

    const token =
      this.extractTokenFromHeader(
        request
      )

    if (!token) {

      throw new UnauthorizedException(
        'Session Expired'
      )
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

      request['user'] =
        payload

      /**
       * ✅ rolling session
       * renew cookie every request
       */

    } catch {

      throw new UnauthorizedException('Invalid Token')  // ← لازم يكون كده
    }

    return true
  }

  private extractTokenFromHeader(
    request: Request
  ): string | undefined {

    return request.cookies?.[
      'access_token'
    ]
  }
}