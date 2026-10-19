/**
 * ============================================================================
 * TỆP KIỂM THỬ TOÀN DIỆN HỆ THỐNG (FULL SYSTEM UNIT TESTS)
 * Dự án: MailMerge Pro
 * Công nghệ: Jest Test Runner
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// 1. CÁC HÀM LOGIC CỐT LÕI ĐƯỢC TRÍCH XUẤT TỪ MÃ NGUỒN SRC
// ----------------------------------------------------------------------------

// A. Xác thực và xử lý email
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function parseRecipientList(cellValue) {
  if (!cellValue || typeof cellValue !== 'string') return [];
  return cellValue
    .split(/[,;\n]+/)
    .map(email => email.trim())
    .filter(email => email.length > 0 && isValidEmail(email));
}

// B. Chuyển đổi số thứ tự cột sang chữ cái Sheets (A, B, ..., Z, AA, AB...)
function indexToLetter(columnNumber) {
  if (!columnNumber || columnNumber <= 0) return '';
  let letter = '';
  while (columnNumber > 0) {
    let temp = (columnNumber - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    columnNumber = Math.floor((columnNumber - temp - 1) / 26);
  }
  return letter;
}

// C. Thay thế các thẻ cá nhân hóa (Personalization Tag Replacement)
function replaceMergeTags(template, rowData, config) {
  let personalizedHtml = template;
  const mappingFields = [];

  const titleTags = ["danhxung", "danh xưng", "chucdanh", "chức danh", "xungho", "xưng hô", "title"];
  titleTags.forEach(tag => mappingFields.push({ tag: tag, colIndex: config.colTitle }));

  const nameTags = ["ten", "tên", "hoten", "họ tên", "ho va ten", "họ và tên", "nguoinhan", "người nhận", "name", "fullname"];
  nameTags.forEach(tag => mappingFields.push({ tag: tag, colIndex: config.colName }));

  const linkTags = ["link", "liên kết", "url", "đường dẫn"];
  linkTags.forEach(tag => mappingFields.push({ tag: tag, colIndex: config.colLink }));

  for (let j = 1; j <= 8; j++) {
    mappingFields.push({ tag: "other" + j, colIndex: config["colOther" + j] });
  }

  mappingFields.forEach(field => {
    if (field.colIndex > 0) {
      let value = rowData[field.colIndex - 1] || "";
      if (linkTags.includes(field.tag)) {
        let linkRegex = new RegExp("https?://(?:\\{\\{|%7B%7B)" + field.tag + "(?:\\}\\}|%7D%7D)", "gi");
        personalizedHtml = personalizedHtml.replace(linkRegex, value);
      }
      let regex = new RegExp("(?:\\{\\{|%7B%7B)" + field.tag + "(?:\\}\\}|%7D%7D)", "gi");
      personalizedHtml = personalizedHtml.replace(regex, value);
    }
  });

  return personalizedHtml;
}

// D. Mã hóa Emoji sang HTML Entity để chống lỗi ký tự
function encodeEmojiToHtmlEntity(html) {
  if (!html || typeof html !== 'string') return "";
  return html.replace(/[\u{10000}-\u{10FFFF}]/gu, ch => '&#' + ch.codePointAt(0) + ';');
}

// E. Trích xuất Google Drive File ID từ đường dẫn
function extractDriveFileIds(cellValue) {
  if (!cellValue) return [];
  const links = cellValue.toString().split(/[,;\n]+/);
  const fileIds = [];

  for (let k = 0; k < links.length; k++) {
    let url = links[k].trim();
    if (url === "") continue;
    let fileIdMatch = url.match(/[-\w]{25,}/);
    if (fileIdMatch && fileIdMatch[0]) {
      fileIds.push(fileIdMatch[0]);
    }
  }
  return fileIds;
}

// F. Thuật toán phân mảnh Cache (Chunking) chống tràn hạn ngạch 100KB của Google CacheService
function chunkString(value, chunkSize = 80 * 1024) {
  if (typeof value !== 'string') return {};
  const numChunks = Math.ceil(value.length / chunkSize);
  const chunkMap = {};

  for (let i = 0; i < numChunks; i++) {
    chunkMap[`chunk_${i}`] = value.substr(i * chunkSize, chunkSize);
  }
  chunkMap['total'] = numChunks;
  return chunkMap;
}

function assembleChunks(chunkMap) {
  if (!chunkMap || typeof chunkMap.total !== 'number') return null;
  let result = "";
  for (let i = 0; i < chunkMap.total; i++) {
    let part = chunkMap[`chunk_${i}`];
    if (part === undefined || part === null) return null; // Thiếu mảnh do quá hạn
    result += part;
  }
  return result;
}

// G. Tự động dọn dẹp các chiến dịch hẹn giờ quá hạn (Schedule Manager)
function autoCleanExpiredCampaigns(campaigns, currentTimestampMs) {
  const now = currentTimestampMs || new Date().getTime();
  const cleaned = {};

  for (let id in campaigns) {
    let camp = campaigns[id];
    let scheduleTime = new Date(camp.scheduleTimeStr).getTime();
    // Giữ lại chiến dịch có lịch hẹn ở tương lai (cộng thêm 1 phút đệm = 60000ms)
    if (scheduleTime > (now - 60000)) {
      cleaned[id] = camp;
    }
  }
  return cleaned;
}

// ----------------------------------------------------------------------------
// 2. TẬP HỢP TẤT CẢ CÁC BÀI TEST CHỨC NĂNG CỦA HỆ THỐNG
// ----------------------------------------------------------------------------

describe('HỆ THỐNG KIỂM THỬ MAILMERGE PRO', () => {

  // --- SUITE 1: XỬ LÝ VÀ XÁC THỰC EMAIL ---
  describe('1. Kiểm tra Xác thực Email & Xử lý Danh sách Người nhận', () => {
    test('Xác thực đúng các định dạng email hợp lệ', () => {
      expect(isValidEmail('user@example.com')).toBe(true);
      expect(isValidEmail('trọng.nguyen@company.com.vn')).toBe(true);
      expect(isValidEmail('  spaced.user@domain.org  ')).toBe(true);
    });

    test('Chặn các email không hợp lệ, rỗng hoặc thiếu domain', () => {
      expect(isValidEmail('')).toBe(false);
      expect(isValidEmail('user_khong_co_a_cong')).toBe(false);
      expect(isValidEmail('user@domain')).toBe(false);
      expect(isValidEmail(null)).toBe(false);
      expect(isValidEmail(undefined)).toBe(false);
      expect(isValidEmail(12345)).toBe(false);
    });

    test('Tách danh sách nhiều email trong ô CC/BCC (ngăn cách bởi phẩy, chấm phẩy, xuống dòng)', () => {
      const rawCell = "email1@example.com, email2@example.com;\nemail3@example.com; invalid_email";
      const parsed = parseRecipientList(rawCell);
      expect(parsed).toEqual([
        'email1@example.com',
        'email2@example.com',
        'email3@example.com'
      ]);
    });
  });

  // --- SUITE 2: CHUYỂN ĐỔI CHỈ SỐ CỘT SANG CHỮ CÁI EXCEL / SHEETS ---
  describe('2. Kiểm tra Bộ chuyển đổi Cột Sheet (indexToLetter)', () => {
    test('Chuyển đổi đúng các cột đơn A - Z', () => {
      expect(indexToLetter(1)).toBe('A');
      expect(indexToLetter(2)).toBe('B');
      expect(indexToLetter(26)).toBe('Z');
    });

    test('Chuyển đổi đúng các cột kép AA, AB, AZ, BA...', () => {
      expect(indexToLetter(27)).toBe('AA');
      expect(indexToLetter(28)).toBe('AB');
      expect(indexToLetter(52)).toBe('AZ');
      expect(indexToLetter(53)).toBe('BA');
      expect(indexToLetter(702)).toBe('ZZ');
      expect(indexToLetter(703)).toBe('AAA');
    });

    test('Xử lý an toàn khi số cột <= 0 hoặc rỗng', () => {
      expect(indexToLetter(0)).toBe('');
      expect(indexToLetter(-5)).toBe('');
      expect(indexToLetter(null)).toBe('');
    });
  });

  // --- SUITE 3: THAY THẾ THẺ CÁ NHÂN HÓA (PERSONALIZATION) ---
  describe('3. Kiểm tra Cơ chế Cá nhân hóa & Thay thế Thẻ mẫu', () => {
    const config = {
      colTitle: 1,      // Cột 1: Danh xưng
      colName: 2,       // Cột 2: Tên
      colLink: 3,       // Cột 3: Liên kết cá nhân
      colOther1: 4,     // Cột 4: Thông tin mở rộng 1
      colOther2: 5      // Cột 5: Thông tin mở rộng 2
    };

    const rowData = ["Anh", "Minh Trọng", "https://viethope.org/cert/123", "Khóa 2026", "Xuất Sắc"];

    test('Thay thế chuẩn xác các thẻ tiếng Việt và tiếng Anh (không phân biệt hoa thường)', () => {
      const draft = "Kính gửi {{DanhXung}} {{Ten}} (Họ tên: {{ho va ten}})!";
      const result = replaceMergeTags(draft, rowData, config);
      expect(result).toBe("Kính gửi Anh Minh Trọng (Họ tên: Minh Trọng)!");
    });

    test('Xử lý thẻ liên kết được nhúng trong thẻ HTML hoặc URL-encoded (%7B%7Blink%7D%7D)', () => {
      const htmlDraft = '<a href="https://{{link}}">Bấm vào đây để tải chứng chỉ</a> hoặc %7B%7Blink%7D%7D';
      const result = replaceMergeTags(htmlDraft, rowData, config);
      expect(result).toBe('<a href="https://viethope.org/cert/123">Bấm vào đây để tải chứng chỉ</a> hoặc https://viethope.org/cert/123');
    });

    test('Thay thế đúng các thẻ mở rộng {{other1}} đến {{other8}}', () => {
      const draft = "Niên khóa: {{other1}}, Xếp loại: {{OTHER2}}";
      const result = replaceMergeTags(draft, rowData, config);
      expect(result).toBe("Niên khóa: Khóa 2026, Xếp loại: Xuất Sắc");
    });

    test('Giữ nguyên văn bản nếu thẻ không được cấu hình cột', () => {
      const emptyConfig = { colTitle: 0, colName: 0 };
      const draft = "Xin chào {{ten}}";
      const result = replaceMergeTags(draft, rowData, emptyConfig);
      expect(result).toBe("Xin chào {{ten}}");
    });
  });

  // --- SUITE 4: MÃ HÓA EMOJI TRÁNH LỖI HTML (EMOJI ENTITY ENCODING) ---
  describe('4. Kiểm tra Cơ chế Mã hóa Emoji sang HTML Entity', () => {
    test('Chuyển đổi các Emoji 4-byte phức tạp sang mã thực thể &#...;', () => {
      const input = "Chúc mừng bạn 🎉🚀! Hãy kiểm tra hòm thư ✉️";
      const output = encodeEmojiToHtmlEntity(input);
      // 🎉 (U+1F389) -> &#127881;, 🚀 (U+1F680) -> &#128640;
      expect(output).toContain('&#127881;');
      expect(output).toContain('&#128640;');
      expect(output).toContain('Chúc mừng bạn');
    });

    test('Giữ nguyên các ký tự tiếng Việt có dấu và văn bản thông thường', () => {
      const input = "Nguyễn Minh Trọng - Đại học Bách Khoa ĐHQG-HCM";
      const output = encodeEmojiToHtmlEntity(input);
      expect(output).toBe(input);
    });
  });

  // --- SUITE 5: TRÍCH XUẤT FILE ID GOOGLE DRIVE ---
  describe('5. Kiểm tra Trích xuất Google Drive File ID', () => {
    test('Trích xuất chính xác ID từ các dạng liên kết Google Drive phổ biến', () => {
      const link1 = "https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/view?usp=sharing";
      const link2 = "https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
      
      const ids1 = extractDriveFileIds(link1);
      const ids2 = extractDriveFileIds(link2);

      expect(ids1).toEqual(['1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms']);
      expect(ids2).toEqual(['1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789']);
    });

    test('Tách được nhiều ID file khi ô Sheet chứa nhiều link ngăn cách bằng dấu phẩy hoặc xuống dòng', () => {
      const multipleLinks = `
        https://drive.google.com/file/d/111111111111111111111111111111111/view,
        https://drive.google.com/file/d/222222222222222222222222222222222/view;
        https://drive.google.com/file/d/333333333333333333333333333333333/view
      `;
      const ids = extractDriveFileIds(multipleLinks);
      expect(ids.length).toBe(3);
      expect(ids).toEqual([
        '111111111111111111111111111111111',
        '222222222222222222222222222222222',
        '333333333333333333333333333333333'
      ]);
    });

    test('Bỏ qua các chuỗi văn bản không phải link Drive hoặc ID quá ngắn (< 25 ký tự)', () => {
      expect(extractDriveFileIds("đây là ghi chú không có link")).toEqual([]);
      expect(extractDriveFileIds("https://example.com/short-id-123")).toEqual([]);
    });
  });

  // --- SUITE 6: THUẬT TOÁN PHÂN MẢNH CACHE (CHUNKING LOGIC) ---
  describe('6. Kiểm tra Thuật toán Phân mảnh Cache (Chống tràn bộ nhớ 100KB)', () => {
    test('Cắt chuỗi dữ liệu lớn (mô phỏng HTML chứa Base64 250KB) thành nhiều mảnh nhỏ và ghép lại nguyên vẹn', () => {
      // Tạo chuỗi giả lập 250 KB
      const largeData = "A".repeat(250 * 1024);
      const CHUNK_SIZE = 80 * 1024; // 80 KB mỗi mảnh
      
      const chunkMap = chunkString(largeData, CHUNK_SIZE);

      // 250KB / 80KB = 4 mảnh (80KB, 80KB, 80KB, 10KB)
      expect(chunkMap.total).toBe(4);
      expect(chunkMap['chunk_0'].length).toBe(CHUNK_SIZE);
      expect(chunkMap['chunk_1'].length).toBe(CHUNK_SIZE);
      expect(chunkMap['chunk_2'].length).toBe(CHUNK_SIZE);
      expect(chunkMap['chunk_3'].length).toBe(10 * 1024);

      // Ghép lại
      const reassembled = assembleChunks(chunkMap);
      expect(reassembled).toBe(largeData);
      expect(reassembled.length).toBe(250 * 1024);
    });

    test('Báo lỗi (null) an toàn nếu một mảnh trong bộ đệm bị mất hoặc hết hạn', () => {
      const data = "B".repeat(100 * 1024);
      const chunkMap = chunkString(data, 50 * 1024);
      
      // Giả lập chunk_1 bị quá hạn hoặc bị xóa
      delete chunkMap['chunk_1'];

      const result = assembleChunks(chunkMap);
      expect(result).toBeNull();
    });
  });

  // --- SUITE 7: QUẢN LÝ LỊCH HẸN VÀ DỌN RÁC CHIẾN DỊCH (SCHEDULE LOGIC) ---
  describe('7. Kiểm tra Quản lý Hẹn giờ Chiến dịch (Schedule Manager)', () => {
    test('Giữ lại các chiến dịch tương lai và tự động xóa bỏ các chiến dịch đã hết hạn', () => {
      const fixedNow = new Date('2026-10-19T10:00:00Z').getTime();

      const mockCampaigns = {
        'camp_past_expired': {
          draftSubject: 'Chiến dịch tuần trước',
          scheduleTimeStr: '2026-10-12T10:00:00Z' // Đã quá hạn 7 ngày
        },
        'camp_just_passed': {
          draftSubject: 'Chiến dịch vừa chạy xong 10 phút trước',
          scheduleTimeStr: '2026-10-19T09:50:00Z' // Quá hạn 10 phút
        },
        'camp_future_1': {
          draftSubject: 'Chiến dịch ngày mai',
          scheduleTimeStr: '2026-10-20T10:00:00Z' // Tương lai
        },
        'camp_future_2': {
          draftSubject: 'Chiến dịch tuần sau',
          scheduleTimeStr: '2026-10-26T10:00:00Z' // Tương lai
        }
      };

      const cleaned = autoCleanExpiredCampaigns(mockCampaigns, fixedNow);

      // Chỉ giữ lại 2 chiến dịch tương lai
      expect(Object.keys(cleaned)).toEqual(['camp_future_1', 'camp_future_2']);
      expect(cleaned['camp_future_1'].draftSubject).toBe('Chiến dịch ngày mai');
      expect(cleaned['camp_future_2'].draftSubject).toBe('Chiến dịch tuần sau');
      expect(cleaned['camp_past_expired']).toBeUndefined();
      expect(cleaned['camp_just_passed']).toBeUndefined();
    });
  });

});
