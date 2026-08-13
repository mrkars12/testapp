// src/auth/clear-cache.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Response } from 'express';

@Injectable()
export class ClearCacheInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const res = context.switchToHttp().getResponse<Response>();

    // 🍏 منع كاش المتصفح الخلفي صامتاً وبأعلى درجات الأمان لمنع ثغرة زر الرجوع
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');

    return next.handle();
  }
}