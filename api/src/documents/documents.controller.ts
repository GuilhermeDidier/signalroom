import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { extname } from 'node:path';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles, Tenant } from '../common/decorators';
import { openSse, writeSse } from '../common/sse';
import type { AppRequest, AuthUser, TenantContext } from '../common/types';
import { UuidPipe } from '../common/uuid.pipe';
import { APP_CONFIG, AppConfig } from '../config';
import { DbService } from '../db/db.service';
import { DocumentsRepository, DocumentView, SourceType } from './documents.repository';
import { IngestQueue } from './ingest.queue';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const UrlBody = z.object({
  url: z
    .string()
    .trim()
    .url()
    .max(2048)
    .refine((v) => /^https?:\/\//i.test(v), 'only http(s) URLs are allowed'),
  title: z.string().trim().min(1).max(200).optional(),
});

const UploadFields = z.object({ title: z.string().trim().min(1).max(200).optional() });

/** Decides the source type from extension AND content, so a renamed binary can't pose as text. */
export function classifyUpload(filename: string, buf: Buffer): { sourceType: SourceType; mime: string } {
  const ext = extname(filename).toLowerCase();
  if (ext === '.pdf') {
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new BadRequestException('File is not a valid PDF');
    return { sourceType: 'pdf', mime: 'application/pdf' };
  }
  if (ext === '.docx') {
    if (!(buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04)) {
      throw new BadRequestException('File is not a valid DOCX');
    }
    return { sourceType: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  }
  if (ext === '.txt' || ext === '.md' || ext === '.markdown') {
    if (buf.includes(0)) throw new BadRequestException('Text file contains binary data');
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      throw new BadRequestException('Text file must be UTF-8');
    }
    return { sourceType: 'text', mime: ext === '.txt' ? 'text/plain' : 'text/markdown' };
  }
  throw new BadRequestException('Unsupported file type: use pdf, docx, txt or md');
}

@Controller('tenants/:tid/documents')
export class DocumentsController {
  private readonly logger = new Logger(DocumentsController.name);

  constructor(
    private readonly docs: DocumentsRepository,
    private readonly queue: IngestQueue,
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Get()
  @Roles('owner', 'admin', 'agent')
  list(@Tenant() t: TenantContext) {
    return this.docs.list(t.tenantId);
  }

  /**
   * Live document list for the dashboard (SSE over fetch with a Bearer token).
   * Emits `event: documents` with the full list on connect and whenever it
   * changes. Server-side polling (1 s) keeps this stateless and multi-instance safe.
   */
  @Get('events')
  @Roles('owner', 'admin', 'agent')
  async events(@Tenant() t: TenantContext, @Req() req: AppRequest, @Res() res: Response) {
    openSse(res);
    let last = '';
    let closed = false;
    let busy = false;
    const tick = async () => {
      if (closed || busy) return;
      busy = true;
      try {
        const list = await this.docs.list(t.tenantId);
        const json = JSON.stringify(list);
        if (json !== last) {
          last = json;
          writeSse(res, 'documents', json);
        }
      } catch (err) {
        this.logger.error(`document events for tenant ${t.tenantId}: ${(err as Error).message}`);
        writeSse(res, 'error', { message: 'Could not load documents' });
      } finally {
        busy = false;
      }
    };
    const poll = setInterval(() => void tick(), this.cfg.documentEventsPollMs);
    const heartbeat = setInterval(() => !closed && res.write(': ping\n\n'), 15_000);
    req.on('close', () => {
      closed = true;
      clearInterval(poll);
      clearInterval(heartbeat);
    });
    await tick();
  }

  /** multipart `file` (pdf/docx/txt/md, ≤10 MB) or JSON `{url}`. */
  @Post()
  @Roles('owner', 'admin')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 },
      defParamCharset: 'utf8',
    }),
  )
  async create(
    @Tenant() t: TenantContext,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
  ): Promise<DocumentView> {
    let input: Parameters<DocumentsRepository['insert']>[1];
    if (file) {
      const fields = UploadFields.safeParse(body ?? {});
      if (!fields.success) throw new BadRequestException('Invalid title');
      if (file.size === 0) throw new BadRequestException('File is empty');
      const { sourceType, mime } = classifyUpload(file.originalname, file.buffer);
      const title = fields.data.title ?? (file.originalname.replace(/\.[^.]+$/, '').trim() || 'Untitled');
      input = { tenantId: t.tenantId, title, sourceType, mime, content: file.buffer, uploadedBy: user.id };
    } else {
      const parsed = UrlBody.safeParse(body);
      if (!parsed.success) throw new BadRequestException('Send a multipart `file` (pdf, docx, txt, md) or JSON {"url"}');
      const u = new URL(parsed.data.url);
      input = {
        tenantId: t.tenantId,
        title: parsed.data.title ?? `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`,
        sourceType: 'url',
        sourceUrl: parsed.data.url,
        uploadedBy: user.id,
      };
    }

    const doc = await this.db.tx(async (client) => {
      const row = await this.docs.insert(client, input);
      await this.audit.record(
        {
          tenantId: t.tenantId,
          actorType: 'user',
          actorId: user.id,
          action: 'document.uploaded',
          targetType: 'document',
          targetId: row.id,
          metadata: { title: row.title, source_type: row.source_type, size_bytes: row.size_bytes, source_url: row.source_url },
        },
        client,
      );
      return row;
    });
    await this.enqueueOrFail(doc.id, t.tenantId);
    return doc;
  }

  @Post(':id/reindex')
  @Roles('owner', 'admin')
  @HttpCode(202)
  async reindex(@Tenant() t: TenantContext, @CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    const doc = await this.db.tx(async (client) => {
      const row = await this.docs.markQueued(t.tenantId, id, client);
      if (!row) {
        if (await this.docs.find(t.tenantId, id, client)) throw new ConflictException('Document is still being indexed');
        throw new NotFoundException('Document not found');
      }
      await this.audit.record(
        { tenantId: t.tenantId, actorType: 'user', actorId: user.id, action: 'document.reindexed', targetType: 'document', targetId: id, metadata: { title: row.title } },
        client,
      );
      return row;
    });
    await this.enqueueOrFail(doc.id, t.tenantId);
    return doc;
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(204)
  async remove(@Tenant() t: TenantContext, @CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    await this.db.tx(async (client) => {
      // Chunks go with it (ON DELETE CASCADE), so retrieval stops citing it immediately.
      const row = await this.docs.delete(t.tenantId, id, client);
      if (!row) throw new NotFoundException('Document not found');
      await this.audit.record(
        { tenantId: t.tenantId, actorType: 'user', actorId: user.id, action: 'document.deleted', targetType: 'document', targetId: id, metadata: { title: row.title } },
        client,
      );
    });
  }

  private async enqueueOrFail(documentId: string, tenantId: string) {
    try {
      await this.queue.enqueue({ document_id: documentId, tenant_id: tenantId });
    } catch (err) {
      this.logger.error(`could not enqueue ingest for document ${documentId}: ${(err as Error).message}`);
      await this.docs.markFailedIfNotTerminal(documentId, 'Could not enqueue ingestion job (queue unavailable)');
      throw new ServiceUnavailableException('Ingestion queue unavailable; the document was saved as failed, retry with reindex');
    }
  }
}
