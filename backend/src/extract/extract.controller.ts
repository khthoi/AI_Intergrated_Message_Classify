import { Body, Controller, Post } from '@nestjs/common';
import { ChatGptService } from '../ai/chatgpt.service';
import { ExtractDto, ExtractBatchDto } from './extract.dto';

@Controller('api/extract')
export class ExtractController {
  constructor(private readonly chatGptService: ChatGptService) {}

  @Post()
  async extract(@Body() dto: ExtractDto) {
    // Chỉ lấy tin nhắn từ khách, bỏ qua tin mình tự gửi
    const customerMessages = dto.messages
      .filter((m) => m.senderType === 'customer')
      .map((m) => `${m.senderName}: ${m.content}`)
      .join('\n');

    if (!customerMessages.trim()) {
      return {
        conversationId: dto.conversationId,
        participantName: dto.participantName,
        extractedAt: new Date().toISOString(),
        isPurchaseIntent: false,
        intent: 'other',
        customerName: null,
        phone: null,
        address: null,
        product: null,
        quantity: null,
        note: null,
        status: 'pending',
        confidence: 0,
        evidenceQuote: null,
      };
    }

    const result = await this.chatGptService.extractOrderInfo(customerMessages);

    return {
      conversationId: dto.conversationId,
      participantName: dto.participantName,
      extractedAt: new Date().toISOString(),
      ...result,
    };
  }

  @Post('batch')
  async extractBatch(@Body() dto: ExtractBatchDto) {
    const now = new Date().toISOString();

    const items = dto.conversations.map((conv) => {
      const text = conv.messages
        .filter((m) => m.senderType === 'customer')
        .map((m) => `${m.senderName}: ${m.content}`)
        .join('\n');
      return { conversationId: conv.conversationId, participantName: conv.participantName, text };
    });

    // Conversations không có tin nhắn khách → trả kết quả rỗng ngay, không đưa vào batch
    const toProcess = items.filter((it) => it.text.trim());
    const emptyResults = items
      .filter((it) => !it.text.trim())
      .map((it) => ({
        conversationId: it.conversationId,
        participantName: it.participantName,
        extractedAt: now,
        isPurchaseIntent: false,
        intent: 'other',
        customerName: null, phone: null, address: null, product: null,
        quantity: null, note: null, status: 'pending', confidence: 0, evidenceQuote: null,
      }));

    if (!toProcess.length) return emptyResults;

    const aiResults = await this.chatGptService.extractBatch(
      toProcess.map((it) => ({ participantName: it.participantName, text: it.text })),
    );

    const processedResults = toProcess.map((it, i) => ({
      conversationId: it.conversationId,
      participantName: it.participantName,
      extractedAt: now,
      ...aiResults[i],
    }));

    // Trả về theo đúng thứ tự gốc
    return dto.conversations.map((conv) =>
      processedResults.find((r) => r.conversationId === conv.conversationId) ??
      emptyResults.find((r) => r.conversationId === conv.conversationId),
    );
  }
}
