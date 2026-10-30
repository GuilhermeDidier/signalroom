import { Injectable } from '@nestjs/common';
import { DbService, Queryable } from '../db/db.service';

export type SourceType = 'pdf' | 'docx' | 'url' | 'text';

export interface DocumentView {
  id: string;
  title: string;
  source_type: SourceType;
  source_url: string | null;
  mime: string | null;
  size_bytes: number | null;
  status: string;
  error: string | null;
  chunk_count: number;
  attempts: number;
  uploaded_by: string | null;
  created_at: Date;
  updated_at: Date;
}

// Never select `content`: it can be 10 MB per row.
const VIEW = `id, title, source_type, source_url, mime, octet_length(content) AS size_bytes,
  status, error, chunk_count, attempts, uploaded_by, created_at, updated_at`;

@Injectable()
export class DocumentsRepository {
  constructor(private readonly db: DbService) {}

  async list(tenantId: string): Promise<DocumentView[]> {
    const { rows } = await this.db.query<DocumentView>(
      `SELECT ${VIEW} FROM documents WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return rows;
  }

  async find(tenantId: string, id: string, q: Queryable = this.db): Promise<DocumentView | undefined> {
    const { rows } = await q.query<DocumentView>(`SELECT ${VIEW} FROM documents WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    return rows[0];
  }

  async insert(
    q: Queryable,
    doc: {
      tenantId: string;
      title: string;
      sourceType: SourceType;
      sourceUrl?: string;
      mime?: string;
      content?: Buffer;
      uploadedBy: string;
    },
  ): Promise<DocumentView> {
    const { rows } = await q.query<DocumentView>(
      `INSERT INTO documents (tenant_id, title, source_type, source_url, mime, content, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${VIEW}`,
      [doc.tenantId, doc.title, doc.sourceType, doc.sourceUrl ?? null, doc.mime ?? null, doc.content ?? null, doc.uploadedBy],
    );
    return rows[0];
  }

  /**
   * Re-queue for indexing (the only status write api makes besides the give-up case below).
   * Only from a terminal state, so a reindex can't race a job that is still running.
   */
  async markQueued(tenantId: string, id: string, q: Queryable): Promise<DocumentView | undefined> {
    const { rows } = await q.query<DocumentView>(
      `UPDATE documents SET status = 'queued', error = NULL, attempts = 0, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status IN ('indexed', 'failed') RETURNING ${VIEW}`,
      [tenantId, id],
    );
    return rows[0];
  }

  async delete(tenantId: string, id: string, q: Queryable): Promise<{ id: string; title: string } | undefined> {
    const { rows } = await q.query<{ id: string; title: string }>(
      'DELETE FROM documents WHERE tenant_id = $1 AND id = $2 RETURNING id, title',
      [tenantId, id],
    );
    return rows[0];
  }

  async setAttempts(id: string, attempts: number): Promise<boolean> {
    const res = await this.db.query('UPDATE documents SET attempts = $2 WHERE id = $1', [id, attempts]);
    return res.rowCount === 1;
  }

  /**
   * Called only after every retry is exhausted and the ai service never
   * recorded a terminal state itself (e.g. it was unreachable). Without this the
   * row would sit in `queued` forever. ai remains the writer in every other case.
   */
  async markFailedIfNotTerminal(id: string, error: string): Promise<void> {
    await this.db.query(
      `UPDATE documents SET status = 'failed', error = $2, updated_at = now()
        WHERE id = $1 AND status NOT IN ('indexed', 'failed')`,
      [id, error.slice(0, 500)],
    );
  }
}
