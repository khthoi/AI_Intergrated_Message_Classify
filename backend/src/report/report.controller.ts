import { Body, Controller, Post, Get, Param, Res, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { ReportService, ExtractionRecord } from './report.service';

@Controller('api/report')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Post('generate')
  async generate(@Body() records: ExtractionRecord[]) {
    const filePath = await this.reportService.generateReport(records);
    const fileName = path.basename(filePath);
    return {
      filePath,
      fileName,
      downloadUrl: `http://localhost:3000/api/report/download/${fileName}`,
    };
  }

  @Get('download/:fileName')
  download(@Param('fileName') fileName: string, @Res() res: Response) {
    const outputDir = process.env.REPORT_OUTPUT_DIR ?? './reports';
    const filePath = path.join(outputDir, path.basename(fileName));
    if (!fs.existsSync(filePath)) throw new NotFoundException('File not found');
    res.download(filePath);
  }
}
