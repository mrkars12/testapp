import {
  Injectable,
  UnauthorizedException
} from '@nestjs/common'

import { PassportStrategy }
from '@nestjs/passport'

import { ExtractJwt, Strategy }
from 'passport-jwt'

import { PrismaService }
from '../prisma/prisma.service'

@Injectable()
export class JwtStrategy extends PassportStrategy(
  Strategy
) {

  constructor(

    private prisma: PrismaService
  ) {

    super({

  jwtFromRequest:

    ExtractJwt.fromExtractors([

      (req) => {

        return req?.cookies?.[
          'access_token'
        ]
      }
    ]),

  ignoreExpiration:
    false,

  secretOrKey:

    process.env.JWT_SECRET ||

    'fallback_secret',
})
  }

  async validate(payload: any) {

  /**
   * ✅ find user
   */
  const user =
    await this.prisma.users.findUnique({

      where: {

        id:
          BigInt(payload.sub)
      }
    })

  /**
   * ❌ invalid user
   */
  if (!user) {

    throw new UnauthorizedException()
  }

  /**
   * ❌ invalid session
   */
  if (

    user.session_id !==
      payload.session_id
  ) {

    throw new UnauthorizedException()
  }

  /**
   * ❌ device logged out
   */
  if (payload.device_id) {

    const device =
      await this.prisma.devices.findFirst({

        where: {

          id:
            payload.device_id,

          logged_out_at:
            null
        }
      })

    if (!device) {

      throw new UnauthorizedException()
    }
  }

  return {

    sub:
      user.id.toString(),

    email:
      user.email,

    username:
      user.username,

    two_factor_enabled:
      user.two_factor_enabled,

      session_id:          payload.session_id,  // ✅ أضف
    device_id:           payload.device_id,   // ✅ أضف
  }

}
}