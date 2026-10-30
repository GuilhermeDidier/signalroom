import { DynamicModule, Global, Module } from '@nestjs/common';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { APP_CONFIG, AppConfig } from './config';
import { ConversationsModule } from './conversations/conversations.module';
import { DbModule } from './db/db.module';
import { DocumentsModule } from './documents/documents.module';
import { HealthController } from './health/health.controller';
import { RedisModule } from './redis/redis.module';
import { TenantsModule } from './tenants/tenants.module';
import { TicketsModule } from './tickets/tickets.module';
import { WidgetModule } from './widget/widget.module';

@Global()
@Module({})
class ConfigModule {
  static with(cfg: AppConfig): DynamicModule {
    return { module: ConfigModule, providers: [{ provide: APP_CONFIG, useValue: cfg }], exports: [APP_CONFIG] };
  }
}

@Module({})
export class AppModule {
  /** Config is injected (not read from process.env deep inside) so tests can build apps with different settings. */
  static register(cfg: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.with(cfg),
        DbModule,
        RedisModule,
        AuditModule,
        AuthModule,
        TenantsModule,
        DocumentsModule,
        ConversationsModule,
        TicketsModule,
        AnalyticsModule,
        WidgetModule,
      ],
      controllers: [HealthController],
    };
  }
}
