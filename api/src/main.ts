import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadConfig } from './config';

async function main() {
  const cfg = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(cfg), { bodyParser: false });
  configureApp(app, cfg);
  await app.listen(cfg.port, '0.0.0.0');
  Logger.log(`api listening on :${cfg.port} (ai=${cfg.aiUrl}, demo=${cfg.demoMode})`, 'Bootstrap');
}

void main();
