// src/auth/strategies/google.strategy.ts
import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { Strategy, StrategyOptionsWithRequest } from 'passport-google-oauth20'

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor() {
    const opts: StrategyOptionsWithRequest = {
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL: `${process.env.APP_URL}/auth/oauth/google/callback`,
      scope: ['email', 'profile'],
      passReqToCallback: true,
    }
    super(opts)
  }

  async validate(req: any, accessToken: string, refreshToken: string, profile: any, done: any) {
    const state = this.parseState(req.query?.state)
    
    // 🍏 المفيد: الـ Strategy مش هتعمل أي اتصالات بقاعدة البيانات ولا try/catch
    // هي فقط بتجمع الداتا وتمررها علطول للـ Controller
    const oauthPayload = {
      provider: 'google',
      providerId: profile.id,
      email: profile.emails?.[0]?.value,
      displayName: profile.displayName,
      avatar: profile.photos?.[0]?.value ?? undefined,
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