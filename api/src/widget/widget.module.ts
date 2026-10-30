import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { NotifierService } from './notifier.service';
import { WidgetController } from './widget.controller';
import { WidgetService } from './widget.service';

@Module({
  imports: [TenantsModule],
  controllers: [WidgetController],
  providers: [WidgetService, NotifierService],
})
export class WidgetModule {}
