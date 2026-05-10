import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsString, IsOptional, IsDateString, ValidateNested } from 'class-validator';

export class MessageDto {
  @IsString() senderName: string;
  @IsEnum(['customer', 'me']) senderType: 'customer' | 'me';
  @IsString() content: string;
  @IsOptional() @IsDateString() sentAt?: string;
}

export class ExtractDto {
  @IsString() conversationId: string;
  @IsString() participantName: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => MessageDto)
  messages: MessageDto[];
}

export class ExtractBatchItemDto {
  @IsString() conversationId: string;
  @IsString() participantName: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => MessageDto)
  messages: MessageDto[];
}

export class ExtractBatchDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ExtractBatchItemDto)
  conversations: ExtractBatchItemDto[];
}
