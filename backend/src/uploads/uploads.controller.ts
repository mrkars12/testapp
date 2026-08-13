// src/uploads/uploads.controller.ts
import { Controller, Post, Delete, Body, Req, UseGuards } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';

@UseGuards(SessionAuthGuard)
@Controller('uploads')
export class UploadsController {
  constructor(private uploadsService: UploadsService) {}

  @Post('presign')
  presign(@Req() req: any, @Body() body: { fileName: string; mimeType: string; size: number; folder: 'products' | 'variants' }) {
    return this.uploadsService.presignForUser(req.user.id, body);
  }

  @Post('confirm')
  confirm(@Req() req: any, @Body() body: { key: string; attachedType?: string; attachedId?: string }) {
    return this.uploadsService.confirmForUser(req.user.id, body.key, body.attachedType, body.attachedId);
  }

  @Delete('image')
  remove(@Req() req: any, @Body('key') key: string) {
    return this.uploadsService.removeForUser(req.user.id, key);
  }
}