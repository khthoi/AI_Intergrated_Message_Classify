# Hướng dẫn khởi động AutoMSToolAI

## Bước 1 — Cấu hình MySQL

Mở file `backend/.env` và điền thông tin MySQL:

```env
DB_PASSWORD=your_mysql_password
DB_DATABASE=auto_ms_tool
```

Tạo database trong MySQL (chạy 1 lần):

```sql
CREATE DATABASE auto_ms_tool CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

## Bước 2 — Chạy backend

```powershell
cd D:\AutoMSToolAI\backend
npm run start:dev
```

Thấy dòng này là OK:
```
AutoMSToolAI backend running on http://localhost:3000
```

> TypeORM sẽ tự tạo tất cả bảng (synchronize: true).

## Bước 3 — Load Chrome Extension

1. Mở Chrome → `chrome://extensions/`
2. Bật **Chế độ nhà phát triển** (góc trên phải)
3. Nhấn **"Tải tiện ích chưa giải nén"**
4. Chọn thư mục `D:\AutoMSToolAI\extension`

## Bước 4 — Sử dụng

1. Mở Chrome → vào `https://www.messenger.com`
2. Đăng nhập Facebook thủ công
3. Mở một hội thoại bất kỳ
4. Click icon Extension → nhấn **"▶ Bắt đầu theo dõi"**
5. Extension sẽ tự đọc tin nhắn mỗi 2 phút

## Xuất báo cáo thủ công

Trong popup Extension → nhấn **"📊 Xuất báo cáo Excel"**

Hoặc gọi API trực tiếp:
```
POST http://localhost:3000/api/report/generate
GET  http://localhost:3000/api/report/download
```

File Excel được lưu tại: `D:\AutoMSToolAI\backend\reports\`

## Báo cáo tự động

- **8:00 sáng** → báo cáo kỳ tối hôm trước (20h → 8h)
- **20:00 tối** → báo cáo kỳ ban ngày (8h → 20h)
