import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { AiModule } from './ai/ai.module';
import { ExtractModule } from './extract/extract.module';
import { ReportModule } from './report/report.module';

@Module({
  imports: [
    ConfigModule.forRoot({ load: [configuration], isGlobal: true }),
    AiModule,
    ExtractModule,
    ReportModule,
  ],
})
export class AppModule {}
