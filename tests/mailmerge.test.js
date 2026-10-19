/**
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
  return template.replace(/\{\{ten\}\}/gi, name || "");
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
