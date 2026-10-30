import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Queue, UnrecoverableError, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config';
import { closeRedis } from '../redis/redis.module';
import { DocumentsRepository } from './documents.repository';

export const INGEST_QUEUE = 'ingest';
export const INGEST_ATTEMPTS = 3;

export interface IngestJobData {
  document_id: string;
  tenant_id: string;
}

/**
 * BullMQ producer + in-process worker for document ingestion.
 *
 * The worker forwards each job to ai `POST /ingest`, which does the parsing,
 * chunking and embedding and writes the document's status. Retry policy:
 *   - 2xx              → done
 *   - 4xx (bad input)  → UnrecoverableError, no retry (ai already marked it failed)
 *   - 5xx / network    → throw, BullMQ retries with exponential backoff (3 attempts)
 * Running the worker in the API process keeps the demo to one deployable; set
 * INGEST_WORKER=false and run another instance to split it out later.
 */
@Injectable()
export class IngestQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestQueue.name);
  private connection?: IORedis;
  private queue?: Queue<IngestJobData>;
  private worker?: Worker<IngestJobData>;
  private workerConnection?: IORedis;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly docs: DocumentsRepository,
  ) {}

  /** Created on first use, so instances that never enqueue hold no extra Redis connection. */
  private getQueue(): Queue<IngestJobData> {
    if (!this.queue) {
      this.connection = new IORedis(this.cfg.redisUrl, { maxRetriesPerRequest: null });
      this.queue = new Queue<IngestJobData>(INGEST_QUEUE, {
        connection: this.connection,
        prefix: this.cfg.redisPrefix,
        defaultJobOptions: {
          attempts: INGEST_ATTEMPTS,
          backoff: { type: 'exponential', delay: this.cfg.ingest.backoffMs },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
        },
      });
    }
    return this.queue;
  }

  onModuleInit() {
    if (!this.cfg.ingest.workerEnabled) return;
    this.workerConnection = new IORedis(this.cfg.redisUrl, { maxRetriesPerRequest: null });
    this.worker = new Worker<IngestJobData>(INGEST_QUEUE, (job) => this.process(job), {
      connection: this.workerConnection,
      prefix: this.cfg.redisPrefix,
      concurrency: this.cfg.ingest.concurrency,
    });
    this.worker.on('failed', (job, err) => {
      if (!job) return;
      const exhausted = err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
      this.logger.warn(`ingest ${job.data.document_id} attempt ${job.attemptsMade} failed: ${err.message}`);
      if (exhausted) {
        void this.docs
          .markFailedIfNotTerminal(job.data.document_id, `Ingestion failed after ${job.attemptsMade} attempt(s): ${err.message}`)
          .catch((e: Error) => this.logger.error(`could not mark document failed: ${e.message}`));
      }
    });
    this.worker.on('error', (err) => this.logger.error(`worker error: ${err.message}`));
  }

  async enqueue(data: IngestJobData): Promise<void> {
    // With maxRetriesPerRequest=null a dead Redis would block forever; bound it.
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('enqueue timed out')), 5_000);
    });
    try {
      await Promise.race([this.getQueue().add('ingest', data), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async process(job: Job<IngestJobData>): Promise<{ chunk_count?: number }> {
    const exists = await this.docs.setAttempts(job.data.document_id, job.attemptsMade + 1);
    if (!exists) return {}; // deleted while queued: nothing to do

    let res: Response;
    try {
      res = await fetch(`${this.cfg.aiUrl}/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Token': this.cfg.internalToken },
        body: JSON.stringify({ document_id: job.data.document_id }),
        signal: AbortSignal.timeout(this.cfg.aiIngestTimeoutMs),
      });
    } catch (err) {
      throw new Error(`ai unreachable: ${(err as Error).message}`); // transient → retry
    }

    const text = await res.text();
    if (res.ok) {
      try {
        return JSON.parse(text) as { chunk_count?: number };
      } catch {
        return {};
      }
    }
    const detail = `ai /ingest ${res.status}: ${text.slice(0, 300)}`;
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      throw new UnrecoverableError(detail);
    }
    throw new Error(detail);
  }

  async onModuleDestroy() {
    await this.worker?.close();
    if (this.workerConnection) await closeRedis(this.workerConnection);
    await this.queue?.close();
    if (this.connection) await closeRedis(this.connection);
  }
}
