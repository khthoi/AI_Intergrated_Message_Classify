import { Module } from '@nestjs/common';
import { ExtractController } from './extract.controller';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  controllers: [ExtractController],
})
export class ExtractModule {}
