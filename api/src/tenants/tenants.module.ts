import { Module } from '@nestjs/common';
import { InvitesController } from './invites.controller';
import { MembersController } from './members.controller';
import { TenantsController } from './tenants.controller';
import { TenantsRepository } from './tenants.repository';

@Module({
  controllers: [TenantsController, MembersController, InvitesController],
  providers: [TenantsRepository],
  exports: [TenantsRepository],
})
export class TenantsModule {}
