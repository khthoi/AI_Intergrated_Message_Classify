import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as ExcelJS from 'exceljs';
import { format } from 'date-fns';
import * as path from 'path';
import * as fs from 'fs';

export interface ExtractionRecord {
  conversationId: string;
  participantName: string;
  extractedAt: string;
  isPurchaseIntent: boolean;
  intent: string;
  customerName: string | null;
  phone: string | null;
  address: string | null;
  product: string | null;
  quantity: number | null;
  note: string | null;
  status: string;
  confidence: number;
  evidenceQuote: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  confirmed: 'Đã chốt',
  pending: 'Chờ phản hồi',
  hesitating: 'Đang phân vân',
  high_potential: 'Tiềm năng cao',
  spam: 'Spam',
};

const INTENT_LABEL: Record<string, string> = {
  buy: 'Đặt mua',
  ask_price: 'Hỏi giá',
  consult: 'Tư vấn',
  complaint: 'Khiếu nại',
  spam: 'Spam',
  returning_customer: 'Khách cũ',
  other: 'Khác',
};

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  constructor(private config: ConfigService) {}

  async generateReport(records: ExtractionRecord[]): Promise<string> {
    const outputDir = this.config.get<string>('reportOutputDir') ?? './reports';
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const now = new Date();
    const fileName = `report_${format(now, 'yyyy-MM-dd_HH-mm')}.xlsx`;
    const filePath = path.join(outputDir, fileName);

    await this.buildExcel(records, filePath);

    const leads = records.filter((r) => r.isPurchaseIntent).length;
    this.logger.log(`Report generated: ${filePath} (${leads}/${records.length} leads)`);
    return filePath;
  }

  private async buildExcel(records: ExtractionRecord[], filePath: string) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'AutoMSToolAI';
    const ws = wb.addWorksheet('Đơn hàng');

    ws.columns = [
      { header: 'STT',                   key: 'no',         width: 5  },
      { header: 'Thời gian',             key: 'time',       width: 18 },
      { header: 'Tên hội thoại',         key: 'convName',   width: 24 },
      { header: 'Tên khách (AI)',        key: 'name',       width: 22 },
      { header: 'SĐT',                   key: 'phone',      width: 15 },
      { header: 'Sản phẩm',             key: 'product',    width: 25 },
      { header: 'Số lượng',             key: 'qty',        width: 10 },
      { header: 'Địa chỉ',              key: 'address',    width: 28 },
      { header: 'Ý định',               key: 'intent',     width: 14 },
      { header: 'Trạng thái',           key: 'status',     width: 16 },
      { header: 'Độ tin cậy',           key: 'confidence', width: 12 },
      { header: 'Ghi chú',              key: 'note',       width: 28 },
      { header: 'Bằng chứng (trích dẫn)', key: 'evidence', width: 45 },
    ];

    ws.getRow(1).eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    ws.getRow(1).height = 28;

    records.forEach((r, i) => {
      const row = ws.addRow({
        no:         i + 1,
        time:       format(new Date(r.extractedAt), 'dd/MM/yyyy HH:mm'),
        convName:   r.participantName ?? '',
        name:       r.customerName ?? '',
        phone:      r.phone ?? '',
        product:    r.product ?? '',
        qty:        r.quantity ?? '',
        address:    r.address ?? '',
        intent:     INTENT_LABEL[r.intent] ?? r.intent,
        status:     STATUS_LABEL[r.status] ?? r.status,
        confidence: r.confidence != null ? `${Math.round(Number(r.confidence) * 100)}%` : '',
        note:       r.note ?? '',
        evidence:   r.evidenceQuote ?? '',
      });

      row.eachCell((cell) => {
        cell.alignment = { vertical: 'top', wrapText: true };
        cell.border = {
          top:    { style: 'thin', color: { argb: 'FFD0D0D0' } },
          bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
          left:   { style: 'thin', color: { argb: 'FFD0D0D0' } },
          right:  { style: 'thin', color: { argb: 'FFD0D0D0' } },
        };
      });

      if (r.isPurchaseIntent) {
        row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
      }
    });

    ws.addRow([]);
    const summary = ws.addRow([
      '', `Xuất lúc: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`,
      '', '', '', '', '', '', '',
      `Leads: ${records.filter((r) => r.isPurchaseIntent).length}/${records.length}`,
    ]);
    summary.font = { italic: true, color: { argb: 'FF666666' } };

    await wb.xlsx.writeFile(filePath);
  }
}
