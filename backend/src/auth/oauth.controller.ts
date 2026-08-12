// src/auth/oauth.controller.ts
import { Controller, Get, Post, Body, Query, Req, Res, Next, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import type { Response, Request, NextFunction } from 'express'
import { OAuthService } from './oauth.service'
import * as crypto from 'crypto'

const passport = require('passport')

@Controller('auth/oauth')
export class OAuthController {
  constructor(private readonly oauthService: OAuthService) {}



  private encryptMsg(msg: string): string {
  const key = process.env.JWT_SECRET!.slice(0, 32)
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), iv)
  const encrypted = Buffer.concat([cipher.update(msg), cipher.final()])
  return iv.toString('hex') + ':' + encrypted.toString('hex')
}
  // ─────────────────────────────────────────────
  // Initiate — Google / GitHub / Facebook / Microsoft
  // ─────────────────────────────────────────────
  @Get('google')
  googleAuth(@Query('fingerprint') fp: string, @Query('action') action: string,
    @Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    const state = this.buildState(fp, action, req)
    passport.authenticate('google', { scope: ['email', 'profile'], state, session: false })(req, res, next)
  }

  @Get('github')
  githubAuth(@Query('fingerprint') fp: string, @Query('action') action: string,
    @Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    const state = this.buildState(fp, action, req)
    passport.authenticate('github', { scope: ['user:email'], state, session: false })(req, res, next)
  }

  @Get('facebook')
  facebookAuth(@Query('fingerprint') fp: string, @Query('action') action: string,
    @Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    const state = this.buildState(fp, action, req)
    passport.authenticate('facebook', { scope: ['email'], state, session: false })(req, res, next)
  }

  @Get('microsoft')
  microsoftAuth(@Query('fingerprint') fp: string, @Query('action') action: string,
    @Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    const state = this.buildState(fp, action, req)
    passport.authenticate('microsoft', { scope: ['user.read'], state, session: false })(req, res, next)
  }

  // ─────────────────────────────────────────────
  // Callbacks
  // ─────────────────────────────────────────────
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Req() req: any, @Res() res: Response) {
    return this.handleCallback(req, res)
  }

  @Get('github/callback')
  @UseGuards(AuthGuard('github'))
  async githubCallback(@Req() req: any, @Res() res: Response) {
    return this.handleCallback(req, res)
  }

  @Get('facebook/callback')
  @UseGuards(AuthGuard('facebook'))
  async facebookCallback(@Req() req: any, @Res() res: Response) {
    return this.handleCallback(req, res)
  }

  @Get('microsoft/callback')
  @UseGuards(AuthGuard('microsoft'))
  async microsoftCallback(@Req() req: any, @Res() res: Response) {
    return this.handleCallback(req, res)
  }

  // ─────────────────────────────────────────────
  // Verify Device Code
  // ─────────────────────────────────────────────
  @Post('verify-device')
  async verifyDevice(
    @Body() body: { code: string; temp_token: string },
    @Res() res: Response,
  ) {
    const result = await this.oauthService.verifyDeviceCode(
      body.temp_token,
      body.code,
      res,
    )
    return res.json(result)
  }

  // ─────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────
  // src/auth/oauth.controller.ts

  private buildState(fingerprint: string, action: string, req: Request): string {
    let resolvedAction = action || 'login';
    let intendedPath = '/dashboard'; // الافتراضي

    if (req.headers.referer) {
      const refererUrl = new URL(req.headers.referer);
      
      // 🍏 لقط الرابط المقصود لو موجود في الـ Query params بتاعة الفرونت إند
      const intendedParam = refererUrl.searchParams.get('intended') || refererUrl.searchParams.get('redirect');
      if (intendedParam) {
        intendedPath = decodeURIComponent(intendedParam);
      }

      // لقط نوع الحساب لو في صفحة التسجيل
      if (!action) {
        if (req.headers.referer.includes('type=business')) resolvedAction = 'business';
        else if (req.headers.referer.includes('register')) resolvedAction = 'individual';
      }
    }

    // شيل الـ intendedPath معاك في الـ state الآمنة
    return Buffer.from(JSON.stringify({ 
      fingerprint, 
      action: resolvedAction,
      intendedPath 
    })).toString('base64');
  }

  // src/auth/oauth.controller.ts -> استبدل دالة handleCallback القديمة بهذا الجزء فقط

  private async handleCallback(req: any, res: Response) {
    const dto = req.user; 
    const frontendUrl = process.env.FRONTEND_URL;

    if (!dto) {
      return res.redirect(`${frontendUrl}/login?error=oauth_failed`);
    }

    try {
      const result = await this.oauthService.handleOAuthUser(dto, res);
      
      const stateObj = req.query?.state ? JSON.parse(Buffer.from(req.query.state, 'base64').toString()) : {};
      const targetPath = stateObj.intendedPath || '/dashboard';

      switch (result.status) {
        case 'success':
          return res.redirect(
            `${frontendUrl}/auth/oauth-success?session_id=${result.sessionId}&intended=${encodeURIComponent(targetPath)}`
          );

        // 🍏 التعديل المطلوب والأمن: تشفير التوكن عبر دالة encryptMsg وتحويله صامتاً لصفحة النجاح
        case 'device_verify':
          const encryptedToken = this.encryptMsg(result.tempToken);
          return res.redirect(
            `${frontendUrl}/auth/oauth-success?device_check=true&payload=${encodeURIComponent(encryptedToken)}&email=${encodeURIComponent(result.email)}`
          );

        case 'not_found':
          const token1 = Buffer.from('account_not_found').toString('base64');
          return res.redirect(`${frontendUrl}/auth/oauth-message?t=${token1}`);

        case 'already_exists':
          const token2 = Buffer.from('already_exists').toString('base64');
          return res.redirect(`${frontendUrl}/auth/oauth-message?t=${token2}`);
      }
    } catch (err) {
      this.logger.error('OAuth callback error', err);
      return res.redirect(`${frontendUrl}/login?error=oauth_failed`);
    }
  }

  private readonly logger = { error: (msg: string, err: any) => console.error(msg, err) }
}