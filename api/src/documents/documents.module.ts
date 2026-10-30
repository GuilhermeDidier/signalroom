import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsRepository } from './documents.repository';
import { IngestQueue } from './ingest.queue';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsRepository, IngestQueue],
})
export class DocumentsModule {}
