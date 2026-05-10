import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export interface ExtractionResult {
  isPurchaseIntent: boolean;
  intent: 'buy' | 'ask_price' | 'consult' | 'complaint' | 'spam' | 'returning_customer' | 'other';
  customerName: string | null;
  phone: string | null;
  address: string | null;
  product: string | null;
  quantity: number | null;
  note: string | null;
  status: 'confirmed' | 'pending' | 'hesitating' | 'high_potential' | 'spam';
  confidence: number;
  evidenceQuote: string | null;
}

@Injectable()
export class ChatGptService implements OnModuleInit {
  private readonly logger = new Logger(ChatGptService.name);
  private client: OpenAI;
  private modelName: string;

  // Serialize — chỉ 1 request tại một thời điểm
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private config: ConfigService) {}

  onModuleInit() {
    const apiKey = this.config.get<string>('chatgpt.apiKey')!;
    this.modelName = this.config.get<string>('chatgpt.model') ?? 'gpt-4o-mini';
    this.client = new OpenAI({ apiKey });
    this.logger.log(`ChatGPT initialized with model: ${this.modelName}`);
  }

  async extractOrderInfo(conversationText: string): Promise<ExtractionResult> {
    const result = await (this.queue = this.queue.then(() =>
      this.callWithRetry(conversationText, 3),
    ));
    return result as ExtractionResult;
  }

  async extractBatch(
    items: { participantName: string; text: string }[],
  ): Promise<ExtractionResult[]> {
    const results = await (this.queue = this.queue.then(() =>
      this.callBatchWithRetry(items, 3),
    ));
    return results as ExtractionResult[];
  }

  private async callBatchWithRetry(
    items: { participantName: string; text: string }[],
    maxAttempts: number,
  ): Promise<ExtractionResult[]> {
    const fallback = () => items.map(() => this.fallbackResult());

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.modelName,
          messages: [
            { role: 'system', content: this.buildSystemPrompt() },
            { role: 'user', content: this.buildBatchPrompt(items) },
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' },
        });

        const rawText = response.choices[0]?.message?.content?.trim() ?? '';
        this.logger.log(`[ChatGPT Batch ${items.length}] Raw: ${rawText.slice(0, 300)}`);

        const parsed = JSON.parse(rawText);
        const arr: unknown[] = Array.isArray(parsed.results) ? parsed.results : [];

        if (arr.length !== items.length) {
          this.logger.warn(
            `[ChatGPT Batch] Kỳ vọng ${items.length} kết quả, nhận được ${arr.length} — dùng fallback cho phần thiếu`,
          );
        }

        const mapped = items.map((_, i) => {
          const raw = arr[i];
          if (raw && typeof raw === 'object') return this.mapResult(raw as Record<string, unknown>);
          return this.fallbackResult();
        });

        this.logger.log(`[ChatGPT Batch] Kết quả: ${JSON.stringify(mapped)}`);
        return mapped;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === maxAttempts) {
          this.logger.warn(`ChatGPT Batch thất bại sau ${maxAttempts} lần: ${msg.slice(0, 200)}`);
          return fallback();
        }
        this.logger.warn(`ChatGPT Batch attempt ${attempt} failed: ${msg.slice(0, 120)}, retrying...`);
        await this.sleep(1000 * attempt);
      }
    }
    return fallback();
  }

  private async callWithRetry(conversationText: string, maxAttempts: number): Promise<ExtractionResult> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.modelName,
          messages: [
            { role: 'system', content: this.buildSystemPrompt() },
            { role: 'user', content: conversationText },
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' },
        });

        const rawText = response.choices[0]?.message?.content?.trim() ?? '';
        this.logger.log(`[ChatGPT] Raw response: ${rawText}`);

        const parsed = JSON.parse(rawText);
        this.logger.log(`[ChatGPT] Parsed result: ${JSON.stringify(parsed)}`);

        return this.mapResult(parsed);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);

        if (attempt === maxAttempts) {
          this.logger.warn(`ChatGPT thất bại sau ${maxAttempts} lần: ${msg.slice(0, 200)}`);
          return this.fallbackResult();
        }

        this.logger.warn(`ChatGPT attempt ${attempt} failed: ${msg.slice(0, 120)}, retrying...`);
        await this.sleep(1000 * attempt);
      }
    }
    return this.fallbackResult();
  }

  private buildBatchPrompt(items: { participantName: string; text: string }[]): string {
    const convBlocks = items
      .map((item, i) =>
        `[${i + 1}] Người tham gia: ${item.participantName}\n${item.text}`,
      )
      .join('\n\n---\n\n');

    return `Phân tích ${items.length} đoạn hội thoại dưới đây theo đúng thứ tự.\n\nTrả về JSON object: { "results": [ ...${items.length} phần tử... ] }, mỗi phần tử theo đúng schema.\n\n${convBlocks}`;
  }

  private buildSystemPrompt(): string {
    return `Bạn là hệ thống phân tích tin nhắn bán hàng. Phân tích đoạn hội thoại người dùng gửi và trả về JSON thuần túy.

Ngữ cảnh kinh doanh: Cửa hàng bán các sản phẩm sau:
- Cao thông gan (thực phẩm chức năng hỗ trợ gan)
- Sách sức khoẻ (có thể gọi là "sức khoẻ mỗi ngày", "cuốn sách", "quyển sách" hoặc không nói rõ tên)
- Các loại thuốc đông y, thảo dược khác

Lưu ý quan trọng khi phân tích:
- Tin nhắn hỏi về sản phẩm trên, hỏi giá, hỏi công dụng, đặt hàng → khả năng cao là mua hàng
- Tin nhắn hỏi đường, hỏi vị trí, nói chuyện thời sự, chào hỏi xã giao, spam → KHÔNG phải mua hàng
- Nếu nội dung không liên quan đến các sản phẩm trên → is_purchase_intent: false, intent: "other" hoặc "spam"

Trả về đúng format JSON này:
{
  "is_purchase_intent": boolean,
  "intent": "buy" | "ask_price" | "consult" | "complaint" | "spam" | "returning_customer" | "other",
  "customer_name": string hoặc null,
  "phone": string hoặc null,
  "address": string hoặc null,
  "product": string hoặc null,
  "quantity": number hoặc null,
  "note": string hoặc null,
  "status": "confirmed" | "pending" | "hesitating" | "high_potential" | "spam",
  "confidence": số từ 0.0 đến 1.0,
  "evidence_quote": string (câu ngắn nhất thể hiện ý định mua, hoặc null)
}`;
  }

  private mapResult(raw: Record<string, unknown>): ExtractionResult {
    return {
      isPurchaseIntent: Boolean(raw.is_purchase_intent),
      intent: (raw.intent as ExtractionResult['intent']) ?? 'other',
      customerName: (raw.customer_name as string) ?? null,
      phone: (raw.phone as string) ?? null,
      address: (raw.address as string) ?? null,
      product: (raw.product as string) ?? null,
      quantity: raw.quantity != null ? Number(raw.quantity) : null,
      note: (raw.note as string) ?? null,
      status: (raw.status as ExtractionResult['status']) ?? 'pending',
      confidence: raw.confidence != null ? Number(raw.confidence) : 0,
      evidenceQuote: (raw.evidence_quote as string) ?? null,
    };
  }

  private fallbackResult(): ExtractionResult {
    return {
      isPurchaseIntent: false, intent: 'other', customerName: null,
      phone: null, address: null, product: null, quantity: null,
      note: null, status: 'pending', confidence: 0, evidenceQuote: null,
    };
  }

  private sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
}
