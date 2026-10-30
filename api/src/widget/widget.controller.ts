import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Public } from '../common/decorators';
import type { AppRequest } from '../common/types';
import { ZodPipe } from '../common/zod.pipe';
import { WidgetService } from './widget.service';

const ConfigQuery = z.object({ key: z.string().min(1).max(200) });

const ChatBody = z.object({
  key: z.string().min(1).max(200),
  conversation_id: z.string().uuid().optional().nullable().transform((v) => v ?? undefined),
  visitor_id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, 'visitor_id must be 1-100 chars of [A-Za-z0-9_-]'),
  // Hard cap here; the configurable 2000-char limit is enforced (413) in WidgetService.
  message: z.string().min(1).max(20_000).refine((m) => m.trim().length > 0, 'message is empty'),
});

/** Public, key-based endpoints used by the embeddable widget (iframe at web /embed). */
@Public()
@Controller('widget')
export class WidgetController {
  constructor(private readonly widget: WidgetService) {}

  @Get('config')
  config(@Query(new ZodPipe(ConfigQuery)) q: z.infer<typeof ConfigQuery>) {
    return this.widget.config(q.key);
  }

  @Post('chat')
  async chat(@Body(new ZodPipe(ChatBody)) body: z.infer<typeof ChatBody>, @Req() req: AppRequest, @Res() res: Response) {
    // Validation, key check and rate limits throw normal HTTP errors before the stream opens.
    const prepared = await this.widget.prepare(body, req.ip ?? 'unknown', res);
    await this.widget.stream(prepared, res);
  }
}
