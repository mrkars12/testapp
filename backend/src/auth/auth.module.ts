// src/auth/auth.module.ts
import { Module } from '@nestjs/common'
import { AuthService } from './auth.service'
import { AuthController } from './auth.controller'
import { JwtModule } from '@nestjs/jwt'
import { PrismaModule } from '../prisma/prisma.module'
import { AuthGuard } from './auth.guard'
import { JwtStrategy } from './jwt.strategy'
import { RealtimeModule } from '../realtime/realtime.module'
import { SessionAuthGuard } from './session-auth.guard'
import { GoogleStrategy } from './strategies/google.strategy'
import { GithubStrategy } from './strategies/github.strategy'
import { FacebookStrategy } from './strategies/facebook.strategy'
import { MicrosoftStrategy } from './strategies/microsoft.strategy'
import { OAuthService } from './oauth.service'
import { OAuthController } from './oauth.controller'

@Module({
  imports: [
    PrismaModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'fallback_secret',
      signOptions: { expiresIn: '7d' },
    }),
    RealtimeModule,
  ],
  controllers: [
    AuthController,
    OAuthController,   // ✅ أضفناه
  ],
  providers: [
    AuthService,
    AuthGuard,
    SessionAuthGuard,
    JwtStrategy,
    // ✅ OAuth providers
    OAuthService,
    GoogleStrategy,
    GithubStrategy,
    FacebookStrategy,
    MicrosoftStrategy,
  ],
  exports: [
    AuthService,
    SessionAuthGuard,
  ],
})
export class AuthModule {}