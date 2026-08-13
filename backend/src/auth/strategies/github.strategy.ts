// src/auth/strategies/github.strategy.ts
import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { Strategy, StrategyOptionsWithRequest } from 'passport-github2'

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor() {
    const opts: StrategyOptionsWithRequest = {
      clientID: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      callbackURL: `${process.env.APP_URL}/auth/oauth/github/callback`,
      scope: ['user:email'],
      passReqToCallback: true,
    }
    super(opts)
  }

  async validate(req: any, accessToken: string, refreshToken: string, profile: any, done: any) {
    const state = this.parseState(req.query?.state)
    const email = profile.emails?.find((e: any) => e.primary)?.value || profile.emails?.[0]?.value

    const oauthPayload = {
      provider: 'github',
      providerId: String(profile.id),
      email,
      displayName: profile.displayName || profile.username,
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