import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OctoController } from './octo.controller';
import { OctoService } from './octo.service';

@Module({
    imports: [ConfigModule],
    controllers: [OctoController],
    providers: [OctoService],
    exports: [OctoService],
})
export class OctoModule {}
