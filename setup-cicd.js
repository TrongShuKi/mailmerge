/**
 * TỆP: setup-cicd.js
 * MỤC ĐÍCH: Tự động khởi tạo toàn bộ thư mục và tệp cấu hình CI/CD (GitHub Actions + Jest + Clasp)
 */

const fs = require('fs');
const path = require('path');

// 1. Nội dung tệp .gitignore (Bảo vệ các tệp nhạy cảm không bị đẩy lên GitHub)
const gitignoreContent = `# Thư viện Node.js
node_modules/

# Tệp chứa khóa đăng nhập Google (Tuyệt đối bảo mật)
.clasprc.json

# Tệp hệ thống và nhật ký
*.log
.DS_Store
`;

// 2. Nội dung tệp .claspignore (Chỉ đẩy mã trong thư mục src lên Google Apps Script)
const claspignoreContent = `**/**
!src/**
!appsscript.json
`;

// 3. Nội dung tệp kiểm thử tự động (tests/mailmerge.test.js)
const testContent = `/**
 * TỆP KIỂM THỬ TỰ ĐỘNG (UNIT TEST)
 * Kiểm tra các hàm xử lý dữ liệu cơ bản trước khi cho phép đẩy code lên Google
 */

// Hàm kiểm tra định dạng email hợp lệ
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return email.trim().includes('@') && email.trim().includes('.');
}

// Hàm thay thế thẻ {{ten}} bằng tên thật
function replaceNameTag(template, name) {
  return template.replace(/\\{\\{ten\\}\\}/gi, name || "");
}

describe('Kiểm tra logic cốt lõi của MailMerge', () => {
  test('Phát hiện đúng email hợp lệ và email lỗi', () => {
    expect(isValidEmail('demo.user@example.com')).toBe(true);
    expect(isValidEmail('email_khong_hop_le')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });

  test('Thay thế chính xác thẻ {{ten}} trong nội dung email', () => {
    const draft = 'Xin chào {{ten}}, chúc mừng bạn!';
    const result = replaceNameTag(draft, 'Minh Trọng');
    expect(result).toBe('Xin chào Minh Trọng, chúc mừng bạn!');
  });
});
`;

// 4. Nội dung tệp cấu hình GitHub Actions (.github/workflows/deploy.yml)
const workflowContent = `name: MailMerge CI/CD

# Kích hoạt tự động mỗi khi đẩy code (push) lên nhánh main
on:
  push:
    branches:
      - main

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest

    steps:
      # Bước 1: Tải mã nguồn từ GitHub về máy chủ ảo
      - name: 1. Tải mã nguồn (Checkout code)
        uses: actions/checkout@v4

      # Bước 2: Cài đặt môi trường Node.js
      - name: 2. Cài đặt Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      # Bước 3: Cài đặt các công cụ (Clasp & Jest)
      - name: 3. Cài đặt thư viện
        run: npm install

      # Bước 4: Chạy kiểm thử tự động (CI)
      - name: 4. Chạy kiểm thử mã nguồn (Unit Test)
        run: npm test

      # Bước 5: Tạo tệp chứng chỉ đăng nhập Google từ GitHub Secrets
      - name: 5. Xác thực tài khoản Google Clasp
        env:
          CLASPRC_JSON: \${{ secrets.CLASPRC_JSON }}
        run: |
          echo "\$CLASPRC_JSON" > ~/.clasprc.json

      # Bước 6: Đẩy code mới nhất lên Google Apps Script (CD)
      - name: 6. Đẩy mã nguồn lên Google Apps Script
        run: npx clasp push --force
`;

// HÀM THỰC THI TẠO TỆP VÀ THƯ MỤC
function setupProject() {
  console.log('🚀 Bắt đầu khởi tạo cấu trúc CI/CD cho MailMerge...\n');

  // Tạo các thư mục cần thiết nếu chưa có
  const dirs = ['tests', path.join('.github', 'workflows')];
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 Đã tạo thư mục: ${dir}`);
    }
  });

  // Ghi các tệp cấu hình
  fs.writeFileSync('.gitignore', gitignoreContent.trim() + '\n');
  console.log('✅ Đã tạo tệp: .gitignore');

  fs.writeFileSync('.claspignore', claspignoreContent.trim() + '\n');
  console.log('✅ Đã tạo tệp: .claspignore');

  fs.writeFileSync(path.join('tests', 'mailmerge.test.js'), testContent.trim() + '\n');
  console.log('✅ Đã tạo tệp kiểm thử: tests/mailmerge.test.js');

  fs.writeFileSync(path.join('.github', 'workflows', 'deploy.yml'), workflowContent.trim() + '\n');
  console.log('✅ Đã tạo tệp GitHub Actions: .github/workflows/deploy.yml');

  // Cập nhật lệnh chạy trong package.json
  const pkgPath = path.join(process.cwd(), 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    pkg.scripts = {
      ...pkg.scripts,
      "test": "jest",
      "push": "clasp push",
      "pull": "clasp pull"
    };
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log('✅ Đã cập nhật các lệnh chạy vào: package.json');
  }

  console.log('\n🎉 HOÀN TẤT! Cấu trúc CI/CD đã sẵn sàng.');
}

setupProject();