import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppConfig } from './config';

/** Shared HTTP setup for main.ts and the e2e tests, so tests exercise the real configuration. */
export function configureApp(app: INestApplication, cfg: AppConfig): void {
  const express = app as NestExpressApplication;
  express.set('trust proxy', cfg.trustProxy);
  express.disable('x-powered-by');
  express.useBodyParser('json', { limit: '64kb' });
  app.enableCors({
    origin: cfg.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
    exposedHeaders: ['Retry-After'],
    maxAge: 600,
  });
  app.enableShutdownHooks();
}
