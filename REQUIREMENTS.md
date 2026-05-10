# AutoMSToolAI — AI Tổng hợp Đơn hàng từ Facebook Messenger (Local Assistant)

## Tổng quan sản phẩm

Tool chạy local trên máy tính, dùng Chrome Extension đọc DOM Messenger Web, gọi Gemini AI phân tích ý định mua hàng từ nick Facebook cá nhân, tổng hợp thông tin khách hàng và xuất báo cáo Excel tự động 2 lần/ngày.

**Không cần:** Meta API, App Review, Business Verification, Webhook, Page Access Token.

---

## Kiến trúc hệ thống

```
Messenger Web (messenger.com)
    ↓
Chrome Extension
(đọc DOM chat, extract text)
    ↓
NestJS API (localhost)
    ↓
Gemini AI Extraction Service
    ↓
MySQL Database
    ↓
Cronjob (8h sáng + 8h tối)
    ↓
File Excel Report (.xlsx)
```

---

## Tài nguyên cần cung cấp / chuẩn bị

### Bạn cần cung cấp

| # | Thứ cần | Giá trị | Ghi chú |
|---|---------|---------|---------|
| 1 | **Gemini API Key** | `AIzaSyD03NDx9lmP-t1JZpfzFSCkpz-w0V97EoA` | Lưu vào `.env` khi implement, không commit lên git |
| 2 | **Gemini Model** | `gemini-2.5-flash` | — |
| 3 | **MySQL** | Đã có sẵn ✅ | Chỉ cần tạo database mới |

### Cần cài đặt trên máy

| # | Thứ cần | Phiên bản | Ghi chú |
|---|---------|-----------|---------|
| 1 | **Node.js** | 18+ | Runtime cho NestJS |
| 2 | **Google Chrome** | Bất kỳ | Chạy Messenger Web + Extension |
| 3 | **MySQL** | Đã có ✅ | — |

> **Không cần:** Redis, ngrok, cloud server, Facebook Developer Account.

---

## Cách hoạt động thực tế

### Người dùng làm gì

1. Mở Chrome, vào `https://www.messenger.com`
2. Đăng nhập Facebook **thủ công** (không auto login — an toàn hơn)
3. Extension tự động chạy ngầm, đọc danh sách hội thoại và nội dung chat
4. Gửi dữ liệu sang NestJS API local
5. Gemini AI phân tích và lưu vào MySQL
6. Đúng 8h sáng và 8h tối → file Excel tự động xuất ra

### Extension làm gì (tự động, ngầm)

- Đọc DOM của Messenger Web theo khoảng thời gian (polling mỗi vài phút)
- Extract: tên khách, nội dung chat, thời gian
- POST dữ liệu lên `http://localhost:3000/api/messages`
- Không tự gửi tin nhắn, không tự click, không spam

---

## Nguyên tắc an toàn (tránh bị checkpoint)

| Nên làm | Không nên làm |
|---------|---------------|
| Đọc DOM tĩnh | Auto click lung tung |
| Polling chậm (1–3 phút/lần) | Scrape hàng nghìn chat liên tục |
| Người dùng login thủ công | Auto login bằng code |
| Dùng `aria-label`, `role` selector | Dùng class CSS random (`.x1a2a7pz`) |
| Chỉ đọc, không ghi | Auto reply, auto send |

---

## Cấu trúc Database (MySQL)

### Bảng `conversations`

```sql
CREATE TABLE conversations (
  id              VARCHAR(128) PRIMARY KEY,  -- hash từ tên + timestamp
  participant_name VARCHAR(255),
  profile_url     VARCHAR(512),
  last_scraped_at DATETIME,
  created_at      DATETIME DEFAULT NOW()
);
```

### Bảng `messages`

```sql
CREATE TABLE messages (
  id              VARCHAR(128) PRIMARY KEY,  -- hash từ sender + content + timestamp
  conversation_id VARCHAR(128) NOT NULL,
  sender_name     VARCHAR(255),
  sender_type     ENUM('customer', 'me') DEFAULT 'customer',
  content         TEXT,
  sent_at         DATETIME,
  created_at      DATETIME DEFAULT NOW(),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);
```

### Bảng `order_extractions`

```sql
CREATE TABLE order_extractions (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  conversation_id     VARCHAR(128) NOT NULL,
  message_snapshot    TEXT,            -- đoạn chat làm bằng chứng
  is_purchase_intent  BOOLEAN DEFAULT FALSE,
  intent              ENUM('buy','ask_price','consult','complaint','spam','returning_customer','other'),
  customer_name       VARCHAR(255),
  phone               VARCHAR(20),
  address             TEXT,
  product             VARCHAR(255),
  quantity            INT,
  note                TEXT,
  status              ENUM('confirmed','pending','hesitating','high_potential','spam') DEFAULT 'pending',
  confidence          DECIMAL(4,3),
  ai_raw_response     JSON,
  extracted_at        DATETIME DEFAULT NOW(),
  report_date         DATE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);
```

### Bảng `report_runs`

```sql
CREATE TABLE report_runs (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_at              DATETIME DEFAULT NOW(),
  report_type         ENUM('morning','evening','manual'),
  file_path           VARCHAR(512),
  total_conversations INT DEFAULT 0,
  total_purchase_leads INT DEFAULT 0,
  status              ENUM('success','failed') DEFAULT 'success'
);
```

---

## Cấu trúc thư mục dự án

```
auto-ms-tool/
├── extension/                        # Chrome Extension
│   ├── manifest.json                 # MV3 manifest
│   ├── background.js                 # service worker
│   ├── content.js                    # script chạy trong messenger.com
│   ├── popup/
│   │   ├── popup.html
│   │   └── popup.js                  # UI bật/tắt, xem trạng thái
│   └── utils/
│       ├── dom-parser.js             # extract text từ DOM
│       └── api-client.js             # gửi data lên localhost:3000
│
└── backend/                          # NestJS API
    └── src/
        ├── app.module.ts
        ├── main.ts
        ├── config/
        │   └── configuration.ts
        ├── messages/
        │   ├── messages.module.ts
        │   ├── messages.controller.ts  # POST /api/messages (nhận từ Extension)
        │   └── messages.service.ts
        ├── ai/
        │   ├── ai.module.ts
        │   └── gemini.service.ts       # gọi Gemini AI
        ├── extraction/
        │   ├── extraction.module.ts
        │   └── extraction.service.ts   # orchestrate AI + lưu DB
        ├── report/
        │   ├── report.module.ts
        │   ├── report.service.ts       # tạo file Excel
        │   └── report.scheduler.ts     # cronjob 8h + 20h
        └── entities/
            ├── conversation.entity.ts
            ├── message.entity.ts
            ├── order-extraction.entity.ts
            └── report-run.entity.ts
```

---

## Chrome Extension — Cách đọc DOM Messenger

### Selector an toàn (dùng aria, role, pattern — không dùng class random)

```js
// Danh sách conversation trong sidebar
const conversations = document.querySelectorAll('[role="row"]');

// Tên người nhắn
const senderName = el.querySelector('[aria-label]')?.getAttribute('aria-label');

// Nội dung tin nhắn
const messageText = el.querySelector('[dir="auto"]')?.innerText;

// Timestamp
const timeEl = el.querySelector('abbr[data-utime]');
const timestamp = timeEl ? new Date(timeEl.dataset.utime * 1000) : new Date();
```

> **Lưu ý:** Messenger DOM thay đổi thường xuyên. Phần này cần test lại và điều chỉnh selector sau khi mount thực tế.

### Polling strategy

```js
// content.js — polling mỗi 2 phút
setInterval(() => {
  const messages = extractVisibleMessages();
  if (messages.length > 0) {
    sendToBackend(messages);
  }
}, 2 * 60 * 1000);
```

---

## Prompt Gemini AI — Template chuẩn

```
Bạn là hệ thống phân tích tin nhắn bán hàng. Phân tích đoạn hội thoại sau và trả về JSON thuần túy (không có markdown, không có giải thích).

Hội thoại:
"""
{conversation_text}
"""

Trả về đúng format JSON này:
{
  "is_purchase_intent": boolean,
  "intent": "buy" | "ask_price" | "consult" | "complaint" | "spam" | "returning_customer" | "other",
  "customer_name": string | null,
  "phone": string | null,
  "address": string | null,
  "product": string | null,
  "quantity": number | null,
  "note": string | null,
  "status": "confirmed" | "pending" | "hesitating" | "high_potential" | "spam",
  "confidence": number (0.0 đến 1.0),
  "evidence_quote": string (câu ngắn nhất thể hiện ý định mua)
}
```

---

## Backend NestJS — Biến môi trường (.env)

```env
# App
PORT=3000
NODE_ENV=development

# MySQL (đã có sẵn)
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=your_password
DB_DATABASE=auto_ms_tool

# Gemini AI
GEMINI_API_KEY=AIzaSyD03NDx9lmP-t1JZpfzFSCkpz-w0V97EoA
GEMINI_MODEL=gemini-2.5-flash

# Report output
REPORT_OUTPUT_DIR=./reports
```

---

## Packages cần cài (Backend)

```bash
npm install @nestjs/core @nestjs/platform-express @nestjs/typeorm typeorm mysql2
npm install @nestjs/schedule
npm install @google/generative-ai
npm install exceljs
npm install date-fns
npm install class-validator class-transformer
npm install @nestjs/config
```

---

## Thứ tự implement (MVP — 1–2 tuần)

### Giai đoạn 1 — Backend core (Ngày 1–5)

- [ ] Khởi tạo NestJS project, kết nối MySQL, tạo entities
- [ ] Viết `GeminiService` — test extraction với data mẫu trước
- [ ] Viết `MessagesController` — nhận POST từ Extension
- [ ] Viết `ExtractionService` — gọi AI, lưu kết quả
- [ ] Viết `ReportService` — tạo Excel với ExcelJS
- [ ] Viết `ReportScheduler` — cronjob 8h + 20h

### Giai đoạn 2 — Chrome Extension (Ngày 6–10)

- [ ] Tạo Chrome Extension (Manifest V3)
- [ ] Viết `content.js` — đọc DOM Messenger, polling 2 phút/lần
- [ ] Viết `popup.html/js` — UI bật/tắt extension, xem log
- [ ] Test end-to-end: Extension → Backend → MySQL → Excel

### Giai đoạn 3 — Polish (Ngày 11–14)

- [ ] Xử lý duplicate message (hash dedup)
- [ ] Handle Gemini trả về sai format (retry, fallback)
- [ ] Tối ưu selector DOM khi Messenger thay đổi
- [ ] Thêm log + error tracking cơ bản

---

## Các vấn đề cần xử lý

| Vấn đề | Giải pháp |
|--------|-----------|
| Messenger DOM thay đổi | Dùng `aria-label`, `role`, `dir="auto"` thay vì class random |
| Duplicate tin nhắn | Hash `sender + content + timestamp` làm PRIMARY KEY |
| Gemini trả về không phải JSON | Try/catch + retry 1 lần + lưu raw fallback |
| Nhiều tin nhắn cùng lúc | Group theo conversation, xử lý theo batch |
| Extension bị tắt khi đóng Chrome | Hướng dẫn user ghim tab Messenger, để Chrome chạy nền |
| Tin nhắn từ chính mình | Lọc theo `sender_type = 'me'`, không đưa vào AI |

---

## Format Excel báo cáo xuất ra

| Thời gian | Tên khách | SĐT | Sản phẩm | SL | Địa chỉ | Trạng thái | Độ tin cậy | Bằng chứng (trích dẫn) |
|-----------|-----------|-----|----------|----|---------|-----------|-----------|----------------------|
| 08:10 | Nguyễn Văn A | 09xxxx | Cao thông gan | 2 | Hà Đông | Đã chốt | 97% | "Cho mình đặt 2 hộp, ship Hà Đông" |

---

## Lệnh khởi động

```bash
# Cài đặt
cd backend
npm install

# Chạy backend local
npm run start:dev
# → API chạy tại http://localhost:3000

# Load Extension vào Chrome
# Chrome → Cài đặt → Tiện ích mở rộng → Chế độ nhà phát triển ON
# → "Tải tiện ích chưa giải nén" → chọn thư mục /extension
```

---

## Bước tiếp theo ngay bây giờ

1. Bạn cung cấp **Gemini API Key** và **tên model**
2. Tôi khởi tạo NestJS project + `GeminiService` trước
3. Test extraction với dữ liệu chat mẫu
4. Sau đó mới build Chrome Extension

---

*Tài liệu cập nhật ngày 2026-05-09 — hướng Local Desktop Assistant (Chrome Extension + NestJS local).*
