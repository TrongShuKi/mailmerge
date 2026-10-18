# PROJECT CONTEXT & HANDOVER DOCUMENT: MAILMERGE-VIETHOPE
*(Tài liệu bàn giao ngữ cảnh dành cho AI Agent trên Antigravity IDE)*

## 1. MỤC TIÊU DỰ ÁN & VAI TRÒ CỦA AI AGENT
- **Tên dự án:** `MailMerge-VietHope` (Google Sheets Add-on nội bộ kèm quy trình CI/CD tự động).
- **Trình độ người dùng:** Sinh viên CNTT định hướng DevOps/DevSecOps, mới làm quen với Node.js, Clasp, Jest và GitHub Actions.
- **Yêu cầu dành cho AI Agent:**
  - Giải thích mã nguồn và các bước thực hiện một cách đơn giản, trực quan, kiên nhẫn.
  - Luôn cung cấp mã nguồn hoàn chỉnh, có chú thích rõ ràng để dễ sao chép và triển khai.
  - Hỗ trợ kiểm tra bảo mật (không để lộ Script ID thật, OAuth token `.clasprc.json` hay email nội bộ khi đẩy lên GitHub công khai).

## 2. KIẾN TRÚC HIỆN TẠI CỦA ỨNG DỤNG (GOOGLE APPS SCRIPT)
Toàn bộ mã nguồn của Google Sheets Add-on nằm trong thư mục `./src` với các thành phần cốt lõi đã hoàn thiện và chạy ổn định:
1. **`appsscript.json`:**
   - Đã cấu hình đầy đủ OAuth Scopes (`script.container.ui`, `userinfo.email`, `spreadsheets`, `gmail.send`, `gmail.readonly`, `drive.readonly`, `script.scriptapp`).
   - Đã xuất bản ở chế độ **Private** trên Google Workspace Marketplace SDK cho nội bộ tổ chức sử dụng.
2. **`MailMergePro.js` (hoặc `.gs`):**
   - Quản lý phiên bản qua hằng số `APP_VERSION`.
   - Tự động quét tiêu đề cột trên Google Sheets (`getAutoConfig`), đọc bản nháp Gmail (`GmailApp.getDrafts()`), thay thế các thẻ cá nhân hóa (`{{ten}}`, `{{danhxung}}`, `{{link}}`, `{{other1}}`..`{{other8}}`), đính kèm tệp từ Google Drive và gửi email.
3. **`PreviewLogic.js` (hoặc `.gs`):**
   - Đã khắc phục triệt để lỗi tràn hạn ngạch `PropertiesService` (500KB limit) bằng cách chuyển sang dùng `CacheService` kết hợp thuật toán chia mảnh dữ liệu lớn (`setBigCache` và `getBigCache` cắt chuỗi HTML chứa ảnh Base64 thành từng mảnh 80KB, tự hủy sau 15 phút).
4. **`ScheduleLogic.js` (hoặc `.gs`):**
   - Quản lý hẹn giờ gửi đa chiến dịch (`Multi-Campaign`) bằng `Time-driven Triggers`.
   - Đã tích hợp cơ chế tự động dọn rác các chiến dịch quá hạn (`autoCleanExpiredCampaigns`) và tối ưu tốc độ ghi trạng thái hàng loạt xuống Sheet bằng `setValues()`.
5. **Giao diện HTML:** `Sidebar.html`, `Preview.html`, `ScheduleDialog.html`.

## 3. TRẠNG THÁI THIẾT LẬP CI/CD HIỆN TẠI (LOCAL ENVIRONMENT)
Người dùng đã thực hiện thành công các bước sau trên máy tính Windows:
- Đã bật Google Apps Script API tại `script.google.com/home/usersettings`.
- Đã cài đặt Node.js LTS, `npm`, `@google/clasp`, và `jest`.
- Đã tạo cấu trúc thư mục và các tệp cấu hình CI/CD cơ bản:
  - `package.json` (đã có script `"test": "jest"`, `"push": "clasp push"`, `"pull": "clasp pull"`).
  - `.gitignore` (đã chặn `node_modules/` và `.clasprc.json`).
  - `.claspignore` (chỉ cho phép đẩy các tệp trong `src/` và `appsscript.json`).
  - `tests/mailmerge.test.js` (đã chạy `npm test` báo PASS thành công trên máy cục bộ).
  - `.github/workflows/deploy.yml` (kịch bản GitHub Actions chạy `npm test` và `npx clasp push --force`).

## 4. CÁC BƯỚC TIẾP THEO CẦN AI AGENT HỖ TRỢ TRIỂN KHAI
Hãy hướng dẫn người dùng thực hiện tuần tự các bước tiếp theo sau đây:
1. **Bước A - Kiểm tra thư mục `./src`:** Xác nhận xem người dùng đã chạy `npx clasp login` và `npx clasp clone "<SCRIPT_ID>" --rootDir ./src` để lấy toàn bộ code từ Google Apps Script về thư mục `./src` chưa.
2. **Bước B - Bảo mật trước khi lên GitHub:** Tạo tệp `.clasp.json.example` và thêm `.clasp.json` vào `.gitignore` (hoặc dùng GitHub Secrets cho `SCRIPT_ID`) nếu người dùng muốn để kho lưu trữ GitHub ở chế độ Công khai (Public) phục vụ làm Portfolio xin thực tập DevOps.
3. **Bước C - Mở rộng Unit Test thực tế:** Viết thêm các bài test trong `tests/mailmerge.test.js` cho các hàm kiểm tra email, tách ID Google Drive và thuật toán chia mảnh bộ đệm (Chunking logic).
4. **Bước D - Đẩy code lên GitHub & Cấu hình Secrets:** Hướng dẫn người dùng khởi tạo Git (`git init`), kết nối tới GitHub Repository (`git remote add origin ...`), lấy nội dung tệp `C:\Users\<User>\.clasprc.json` gắn vào mục **GitHub Settings > Secrets and variables > Actions** (tên biến: `CLASPRC_JSON`), và kích hoạt lần chạy CI/CD đầu tiên.