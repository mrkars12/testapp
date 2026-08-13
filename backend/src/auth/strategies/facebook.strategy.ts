// src/auth/strategies/facebook.strategy.ts
import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { Strategy, StrategyOptionsWithRequest } from 'passport-facebook'

@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
  constructor() {
    const opts: StrategyOptionsWithRequest = {
      clientID: process.env.FACEBOOK_APP_ID!,
      clientSecret: process.env.FACEBOOK_APP_SECRET!,
      callbackURL: `${process.env.APP_URL}/auth/oauth/facebook/callback`,
      profileFields: ['id', 'emails', 'name', 'picture'],
      passReqToCallback: true,
    }
    super(opts)
  }

  async validate(req: any, accessToken: string, refreshToken: string, profile: any, done: any) {
    const state = this.parseState(req.query?.state)
    
    const oauthPayload = {
      provider: 'facebook',
      providerId: profile.id,
      email: profile.emails?.[0]?.value,
      displayName: `${profile.name?.givenName ?? ''} ${profile.name?.familyName ?? ''}`.trim(),
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