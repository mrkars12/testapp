// src/auth/guards/dynamic-oauth.guard.ts
import { ExecutionContext, Injectable, mixin } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

export const DynamicOAuthGuard = () => {
  @Injectable()
  class DynamicGuard extends AuthGuard('') {
    getAuthenticateOptions(ctx: ExecutionContext) {
      const req = ctx.switchToHttp().getRequest();
      return { session: false };
    }

    // نحدد اسم الـ strategy من الـ URL param
    canActivate(ctx: ExecutionContext) {
      const req = ctx.switchToHttp().getRequest();
      const provider = req.params?.provider;
      (this as any)._name = provider; // passport يستخدمه داخلياً
      return super.canActivate(ctx);
    }
  }
  return mixin(DynamicGuard);
};