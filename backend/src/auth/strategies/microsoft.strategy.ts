// src/auth/strategies/microsoft.strategy.ts
import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { Strategy } from 'passport-microsoft'

@Injectable()
export class MicrosoftStrategy extends PassportStrategy(Strategy, 'microsoft') {
  constructor() {
    super({
      clientID: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      callbackURL: `${process.env.APP_URL}/auth/oauth/microsoft/callback`,
      scope: ['user.read'],
      tenant: 'common',
      passReqToCallback: true,
    })
  }

  async validate(req: any, accessToken: string, refreshToken: string, profile: any, done: any) {
    const state = this.parseState(req.query?.state)
    
    // 🍏 تمرير الـ payload النظيف مباشرة للكنترولر بدون الاتصال بقاعدة البيانات هنا
    const oauthPayload = {
      provider: 'microsoft',
      providerId: profile.id,
      email: profile.emails?.[0]?.value,
      displayName: profile.displayName,
      avatar: undefined,
      accessToken,
      refreshToken,
      fingerprint: state.fingerprint,
      action: state.action,
      userAgent: req.headers?.['user-agent'],
      ipAddress: req.ip,
    }

    done(null, oauthPayload)
  }

  private parseState(state?: string) {
    try { return JSON.parse(Buffer.from(state || '', 'base64').toString()) }
    catch { return {} }
  }
}