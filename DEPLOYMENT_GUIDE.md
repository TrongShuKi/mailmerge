# 🚀 QUY TRÌNH PHÁT HÀNH & TRIỂN KHAI (DEPLOYMENT WORKFLOW)

> **Tài liệu chuẩn hóa quy trình phát hành phiên bản mới cho dự án MailMerge.**  
> Mỗi khi hoàn thiện một tính năng hoặc sửa lỗi, hãy thực hiện theo đúng các bước dưới đây để hệ thống tự động kiểm thử và deploy lên Google Apps Script.

---

## 📌 TÓM TẮT QUY TRÌNH (QUICK CHEAT SHEET)

```powershell
# 1. Kiểm tra tag hiện tại
git describe --tags --abbrev=0

# 2. Chạy test xác nhận
npm test

# 3. Đóng gói & Đẩy code lên GitHub
git add src/MailMergePro.js src/Sidebar.html package.json
git commit -m "chore(release): bump version to vX.Y.Z"
git push origin main

# 4. Dán nhãn Tag để CI/CD tự động deploy lên Apps Script
git tag vX.Y.Z -m "Release vX.Y.Z: Mô tả tính năng mới"
git push origin vX.Y.Z
```

---

## 🔍 CHI TIẾT CÁC BƯỚC THỰC HIỆN

### Bước 1: Kiểm tra phiên bản hiện tại
Trước khi tạo bản mới, xác định xem phiên bản mới nhất đang là bao nhiêu:
```powershell
git describe --tags --abbrev=0
```
*Ví dụ kết quả: `v1.1.2` $\rightarrow$ Phiên bản tiếp theo sẽ là `v1.1.3` (hoặc `v1.2.0` nếu là cụm tính năng lớn).*

---

### Bước 2: Đồng bộ số phiên bản trong mã nguồn (BẮT BUỘC)
Trước khi commit và push, **phải cập nhật cùng một số phiên bản** ở 3 vị trí sau:

1. **`src/MailMergePro.js`** (Dòng 5):
   ```javascript
   const APP_VERSION = "1.1.3";
   ```
2. **`src/Sidebar.html`** (Dòng hiển thị chân trang):
   ```html
   MailMerge v<span id="versionText" style="font-weight: bold; color: #1a73e8;">1.1.3</span>
   ```
3. **`package.json`** (Dòng 3):
   ```json
   "version": "1.1.3",
   ```

---

### Bước 3: Chạy kiểm thử tự động (Unit Test)
Đảm bảo tất cả các bài kiểm thử đều đạt kết quả xanh (PASS 100%) trước khi đóng gói:
```powershell
npm test
```
> [!IMPORTANT]
> Nếu có bất kỳ bài test nào báo đỏ (**FAIL**), robot CI/CD trên GitHub Actions sẽ **CHẶN ĐỨNG** quá trình deploy để bảo vệ người dùng trên Production. Phải sửa lỗi test trước khi đi tiếp.

---

### Bước 4: Commit và đẩy mã nguồn lên nhánh `main`
```powershell
git add .
git commit -m "chore(release): bump version to v1.1.3"
git push origin main
```
*Lúc này, GitHub Actions sẽ chỉ chạy kiểm thử và cập nhật bản nháp `HEAD`.*

---

### Bước 5: Dán nhãn Git Tag để kích hoạt Deploy tự động
Đây là bước quyết định để xuất bản chính thức:
```powershell
git tag v1.1.3 -m "Release v1.1.3: Cập nhật hỗ trợ CC và BCC cho email thử nghiệm"
git push origin v1.1.3
```

---

## 🤖 ROBOT CI/CD LÀM GÌ KHI CÓ GIT TAG?

Khi nhận được sự kiện đẩy Tag (`v*`), file cấu hình `.github/workflows/deploy.yml` sẽ tự động thực hiện:

1. **Chạy kiểm thử Jest 100%**.
2. **Khởi tạo thông tin xác thực Google Clasp từ Secrets**.
3. **Tự động cập nhật đè (In-place Update)** vào 2 Deployment Active hiện có bằng tham số `-i`:
   * **Deployment Add-on:** `AKfycbyKfCVe_XvnrWl8i2Rw4TFAs-40XlJfGA3vtYKKYvJcHOPlVmRjsOfshrKpaIIwmYGH`
   * **Deployment Tracking Web App:** `AKfycbziVBkjablulWN_BQoh8TA8DeROesuBQtEKU_fMdvj0TMxYPuhZysXPO84etxNP-CI0`
4. Người dùng mở Google Sheets lên sẽ nhận phiên bản mới ngay lập tức mà **không cần vào Apps Script bấm chuột thủ công**.

---

## 🚨 QUY TRÌNH KHÔI PHỤC KHẨN CẤP (ROLLBACK)

Nếu bản mới vừa phát hành phát sinh lỗi ngoài ý muốn:

### Cách 1: Cứu hỏa trong 10 giây (Trên Google Apps Script)
1. Mở dự án Google Apps Script $\rightarrow$ Bấm nút xanh **Deploy (Triển khai)** $\rightarrow$ **Manage deployments (Quản lý bản triển khai)**.
2. Bấm vào deployment bị lỗi $\rightarrow$ Chọn biểu tượng **Cây bút chì (Chỉnh sửa)**.
3. Ở mục **Version**: Chọn lại Version cũ ổn định trước đó (ví dụ: Version 6 hoặc 7).
4. Bấm **Deploy**. Hệ thống quay về bản cũ ngay lập tức!

### Cách 2: Quay ngược mã nguồn trên Git
```powershell
git revert HEAD
git push origin main
```
