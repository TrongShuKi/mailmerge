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

function combineRecipients(draftList, sheetCell) {
  let final = draftList || "";
  if (sheetCell && sheetCell.toString().trim() !== "") {
    let formatted = sheetCell.toString().trim().replace(/[;\n]+/g, ',');
    final = final ? (final + "," + formatted) : formatted;
  }
  return final;
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

// H. Tạo HTML tracking pixel (logic trích xuất từ TrackingLogic.js)
function generateTrackingPixelHtml_test(webAppUrl, spreadsheetId, sheetName, rowIndex, statusColName, fixedTimestamp) {
  const ts = fixedTimestamp || new Date().getTime();
  const params = [
    "id=" + encodeURIComponent(spreadsheetId),
    "sheet=" + encodeURIComponent(sheetName),
    "row=" + rowIndex,
    "colName=" + encodeURIComponent(statusColName || "Tracking"),
    "ts=" + ts
  ].join("&");
  const trackingUrl = webAppUrl + "?" + params;
  return '<img src="' + trackingUrl + '" '
    + 'width="1" height="1" '
    + 'style="display:none !important; max-height:0; opacity:0;" '
    + 'alt="" />';
}

// I. Kiểm tra thời gian chống báo ảo (Anti-False Positive)
function isTrackingRequestValid(sendTimestamp, receiveTimestamp, cooldownMs) {
  if (isNaN(sendTimestamp) || isNaN(receiveTimestamp)) return false;
  return (receiveTimestamp - sendTimestamp) >= cooldownMs;
}

// J. Kiểm tra chống ghi đè trạng thái (Anti-Overwrite)
function shouldUpdateTrackingStatus(currentCellValue) {
  if (!currentCellValue) return true;
  return currentCellValue.toString().indexOf("Đã xem") === -1;
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

    test('Hợp nhất danh sách CC/BCC từ bản nháp Gmail và dữ liệu dòng trên Sheet (Test Mail & Gửi thật)', () => {
      const draftCc = "lead@example.com";
      const sheetCc = "manager@example.com;\nsupervisor@example.com";
      const combined = combineRecipients(draftCc, sheetCc);
      expect(combined).toBe("lead@example.com,manager@example.com,supervisor@example.com");

      // Trường hợp nháp không có CC, chỉ có trên Sheet
      expect(combineRecipients("", "member@example.com")).toBe("member@example.com");

      // Trường hợp Sheet không có CC, chỉ có trên nháp
      expect(combineRecipients("lead@example.com", "")).toBe("lead@example.com");
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

  // --- SUITE 8: HỆ THỐNG THEO DÕI MỞ EMAIL (OPEN TRACKING) ---
  describe('8. Kiểm tra Hệ thống Theo dõi Mở Email (Open Tracking)', () => {

    test('Tạo thẻ tracking pixel với đầy đủ thuộc tính ẩn (width=1, height=1, display:none, opacity:0)', () => {
      const pixel = generateTrackingPixelHtml_test(
        "https://script.google.com/macros/s/DEPLOY_ID/exec",
        "ss_abc123",
        "Sheet1",
        5,
        "Tracking",
        1729330800000
      );

      // Kiểm tra thuộc tính ẩn bắt buộc
      expect(pixel).toContain('width="1"');
      expect(pixel).toContain('height="1"');
      expect(pixel).toContain('display:none !important');
      expect(pixel).toContain('max-height:0');
      expect(pixel).toContain('opacity:0');
      expect(pixel).toContain('alt=""');
      expect(pixel).toContain('<img');
      expect(pixel).toContain('/>');
    });

    test('URL tracking pixel chứa đầy đủ tham số: id, sheet, row, colName, ts', () => {
      const pixel = generateTrackingPixelHtml_test(
        "https://script.google.com/macros/s/DEPLOY_ID/exec",
        "ss_spreadsheet_123",
        "Danh Sách Gửi",
        10,
        "Trạng Thái Xem",
        1729330800000
      );

      expect(pixel).toContain("id=ss_spreadsheet_123");
      expect(pixel).toContain("sheet=Danh%20S%C3%A1ch%20G%E1%BB%ADi"); // URL-encoded Vietnamese
      expect(pixel).toContain("row=10");
      expect(pixel).toContain("colName=Tr%E1%BA%A1ng%20Th%C3%A1i%20Xem");
      expect(pixel).toContain("ts=1729330800000");
    });

    test('Chống báo ảo: Từ chối request mở email nếu đến trong vòng 15 giây (Gmail Proxy pre-fetch)', () => {
      const COOLDOWN = 15000; // 15 giây
      const sendTime = 1729330800000;

      // Request đến sau 3 giây → Gmail Proxy → KHÔNG HỢP LỆ
      expect(isTrackingRequestValid(sendTime, sendTime + 3000, COOLDOWN)).toBe(false);

      // Request đến sau 10 giây → vẫn trong cooldown → KHÔNG HỢP LỆ
      expect(isTrackingRequestValid(sendTime, sendTime + 10000, COOLDOWN)).toBe(false);

      // Request đến sau 14.9 giây → vẫn trong cooldown → KHÔNG HỢP LỆ
      expect(isTrackingRequestValid(sendTime, sendTime + 14999, COOLDOWN)).toBe(false);

      // Request đến đúng 15 giây → HỢP LỆ (người dùng thật)
      expect(isTrackingRequestValid(sendTime, sendTime + 15000, COOLDOWN)).toBe(true);

      // Kiểm tra với ngưỡng cooldown 2 giây (cấu hình mặc định mới)
      expect(isTrackingRequestValid(sendTime, sendTime + 1000, 2000)).toBe(false);
      expect(isTrackingRequestValid(sendTime, sendTime + 2000, 2000)).toBe(true);

      // Request đến sau 2 phút → HỢP LỆ (người dùng thật mở muộn)
      expect(isTrackingRequestValid(sendTime, sendTime + 120000, COOLDOWN)).toBe(true);
    });

    test('Chống báo ảo: Xử lý an toàn khi timestamp không hợp lệ (NaN, undefined)', () => {
      const COOLDOWN = 15000;
      expect(isTrackingRequestValid(NaN, 1729330800000, COOLDOWN)).toBe(false);
      expect(isTrackingRequestValid(1729330800000, NaN, COOLDOWN)).toBe(false);
      expect(isTrackingRequestValid(undefined, undefined, COOLDOWN)).toBe(false);
    });

    test('Chống ghi đè: Không cập nhật nếu ô đã có trạng thái "Đã xem"', () => {
      // Ô trống → cho phép ghi
      expect(shouldUpdateTrackingStatus("")).toBe(true);
      expect(shouldUpdateTrackingStatus(null)).toBe(true);
      expect(shouldUpdateTrackingStatus(undefined)).toBe(true);

      // Ô đã có "Đã xem" → KHÔNG ghi đè
      expect(shouldUpdateTrackingStatus("Đã xem (14:30 19/10)")).toBe(false);
      expect(shouldUpdateTrackingStatus("Đã xem (09:00 20/10)")).toBe(false);

      // Ô có nội dung khác (ví dụ: "Đã gửi", "Chưa xem") → cho phép ghi
      expect(shouldUpdateTrackingStatus("Chưa xem")).toBe(true);
      expect(shouldUpdateTrackingStatus("Đã gửi")).toBe(true);
      expect(shouldUpdateTrackingStatus("Lỗi gửi")).toBe(true);
    });

    test('Mặc định sử dụng tên cột "Tracking" khi statusColName rỗng', () => {
      const pixel = generateTrackingPixelHtml_test(
        "https://script.google.com/macros/s/DEPLOY_ID/exec",
        "ss_123", "Sheet1", 2, "", 1729330800000
      );
      expect(pixel).toContain("colName=Tracking");
    });

    test('Tìm cột gần nhất còn trống trên hàng tiêu đề (tránh ghi đè dữ liệu có sẵn)', () => {
      function findNearestEmptyCol(headers) {
        for (let c = 0; c < headers.length; c++) {
          if (!headers[c] || headers[c].toString().trim() === "") {
            return c;
          }
        }
        return headers.length;
      }

      // Trường hợp có khoảng trống xen kẽ: Cột A: Tên, Cột B: Email, Cột C: trống, Cột D: Ghi chú
      const headersWithGap = ["Tên", "Email", "", "Ghi chú"];
      expect(findNearestEmptyCol(headersWithGap)).toBe(2); // Chọn đúng cột C (index 2)

      // Trường hợp các cột đều có dữ liệu đầy đủ: chọn cột tiếp theo ở cuối
      const headersFull = ["Tên", "Email", "Status"];
      expect(findNearestEmptyCol(headersFull)).toBe(3); // Cột kế tiếp (index 3)
    });
  });

  // --- SUITE 9: KIỂM TRA CƠ CHẾ TRIGGER ĐỘC LẬP THEO TỪNG FILE & CẢNH BÁO <1H ---
  describe('9. Kiểm tra Cơ chế Trigger Độc lập theo File Sheet & Chế độ Quản lý (ScheduleLogic.js)', () => {
    const ScheduleLogic = require('../src/ScheduleLogic.js');

    // Khởi tạo môi trường giả lập Google Apps Script áp đặt ĐÚNG giới hạn Add-on của Google:
    // - Tối đa 1 time-based trigger trên MỖI document (file Sheet).
    // - Có tùy chọn chặn gọi ScriptApp.newTrigger() từ bên trong background Trigger để mô phỏng thực tế Add-on!
    function createGasTestEnv(initialNowIso, options = {}) {
      let currentTimeMs = new Date(initialNowIso).getTime();
      const RealDate = Date;

      class MockDate extends RealDate {
        constructor(...args) {
          if (args.length === 0) {
            super(currentTimeMs);
          } else {
            super(...args);
          }
        }
        static now() {
          return currentTimeMs;
        }
      }
      global.Date = MockDate;

      const userPropsStore = {};
      const userCacheStore = {};
      const sentCalls = [];
      let activeTriggers = [];
      let triggerCounter = 1;
      let forceCreateTriggerError = null;
      let sendDurationAdvanceMs = 0;
      let insideBackgroundTrigger = false;
      let newTriggerCallsInBackground = 0;

      const spreadsheets = {
        ss_1: {
          id: 'ss_1',
          name: 'Danh sach Mentee 2026',
          sheets: {
            'mentee sau ct': [
              ['Họ tên', 'Email', 'Ghi chú'],
              ['Nguyễn An', 'an@example.com', ''],
              ['Trần Bình', 'binh@example.com', '']
            ],
            'mentor sau ct': [
              ['Họ tên', 'Email', 'Status'],
              ['Lê Cúc', 'cuc@example.com', ''],
              ['Phạm Dũng', 'dung@example.com', 'Đã gửi']
            ],
            'followup': [
              ['Họ tên', 'Email'],
              ['Hoàng Em', 'em@example.com']
            ]
          }
        },
        ss_2: {
          id: 'ss_2',
          name: 'Danh sach Mentor 2026 (Ban sao)',
          sheets: {
            'mentor sau ct': [
              ['Họ tên', 'Email'],
              ['Võ Giang', 'giang@example.com']
            ]
          }
        }
      };
      let activeSpreadsheetId = 'ss_1';

      function makeSheetWrapper(ssId, sheetName) {
        const rows = spreadsheets[ssId].sheets[sheetName];
        if (!rows) return null;
        return {
          getName: () => sheetName,
          getDataRange: () => ({
            getValues: () => rows.map(r => r.slice())
          }),
          isRowHiddenByFilter: () => false,
          isRowHiddenByUser: () => false,
          getRange: (row, col, numRows = 1, numCols = 1) => ({
            setValue: (val) => {
              while (rows.length < row) rows.push([]);
              while (rows[row - 1].length < col) rows[row - 1].push('');
              rows[row - 1][col - 1] = val;
            },
            getValues: () => {
              const out = [];
              for (let r = 0; r < numRows; r++) {
                const rowArr = [];
                const targetRow = rows[row - 1 + r] || [];
                for (let c = 0; c < numCols; c++) {
                  rowArr.push(targetRow[col - 1 + c] !== undefined ? targetRow[col - 1 + c] : '');
                }
                out.push(rowArr);
              }
              return out;
            },
            setValues: (vals) => {
              for (let r = 0; r < vals.length; r++) {
                while (rows.length < row + r) rows.push([]);
                for (let c = 0; c < vals[r].length; c++) {
                  while (rows[row - 1 + r].length < col + c) rows[row - 1 + r].push('');
                  rows[row - 1 + r][col - 1 + c] = vals[r][c];
                }
              }
            }
          })
        };
      }

      function makeSpreadsheetWrapper(ssId) {
        return {
          getId: () => ssId,
          getName: () => spreadsheets[ssId].name,
          getSheetByName: (name) => makeSheetWrapper(ssId, name)
        };
      }

      global.PropertiesService = {
        getUserProperties: () => ({
          getProperty: (k) => (k in userPropsStore ? userPropsStore[k] : null),
          setProperty: (k, v) => { userPropsStore[k] = String(v); },
          deleteProperty: (k) => { delete userPropsStore[k]; }
        })
      };

      global.CacheService = {
        getUserCache: () => ({
          get: (k) => (k in userCacheStore ? userCacheStore[k] : null),
          put: (k, v) => { userCacheStore[k] = String(v); },
          remove: (k) => { delete userCacheStore[k]; }
        })
      };

      global.LockService = {
        getUserLock: () => ({
          tryLock: () => true,
          releaseLock: () => {}
        })
      };

      global.SpreadsheetApp = {
        getActiveSpreadsheet: () => (activeSpreadsheetId ? makeSpreadsheetWrapper(activeSpreadsheetId) : null),
        openById: (id) => makeSpreadsheetWrapper(id)
      };

      global.ScriptApp = {
        getProjectTriggers: () => activeTriggers.slice(),
        deleteTrigger: (trig) => {
          activeTriggers = activeTriggers.filter(t => t.id !== trig.id);
        },
        newTrigger: (fnName) => ({
          timeBased: () => ({
            at: (dateObj) => ({
              create: () => {
                if (insideBackgroundTrigger) {
                  newTriggerCallsInBackground++;
                  if (options.blockBackgroundNewTrigger) {
                    throw new Error('Add-on background trigger chaining blocked by Google.');
                  }
                  // Mô phỏng chính xác thông báo lỗi thật từ Google Apps Script Cloud Logs:
                  // "Exception: Clock events must be scheduled at least 1 hour(s) apart."
                  if ((dateObj.getTime() - currentTimeMs) < 60 * 60 * 1000) {
                    throw new Error('Exception: Clock events must be scheduled at least 1 hour(s) apart.');
                  }
                }
                if (forceCreateTriggerError) {
                  throw forceCreateTriggerError;
                }
                // Giới hạn cứng của Google Add-on: TỐI ĐA 1 time-based trigger trên MỖI document!
                const sameDocTriggers = activeTriggers.filter(t => t.docId === activeSpreadsheetId);
                if (sameDocTriggers.length >= 1) {
                  throw new Error('This add-on has created too many time-based triggers in this document for this Google user account.');
                }
                if (!(dateObj instanceof RealDate) || isNaN(dateObj.getTime()) || dateObj.getTime() <= currentTimeMs) {
                  throw new Error('The scheduled date must be in the future.');
                }
                const created = {
                  id: 'trig_' + (triggerCounter++),
                  docId: activeSpreadsheetId || 'bg_doc',
                  fnName,
                  atMs: dateObj.getTime(),
                  getHandlerFunction: () => fnName,
                  getUniqueId: function () { return this.id; }
                };
                activeTriggers.push(created);
                return created;
              }
            })
          })
        })
      };

      global.sendMergeEmailsFromDraft = (config) => {
        sentCalls.push({
          runAtMs: currentTimeMs,
          spreadsheetId: config.spreadsheetId,
          sheetName: config.sheetName,
          draftSubject: config.draftSubject,
          enableTracking: config.enableTracking
        });
        const rows = spreadsheets[config.spreadsheetId].sheets[config.sheetName];
        const statusName = config.statusName || 'Status';
        let statusIdx = rows[0].indexOf(statusName);
        if (statusIdx === -1) {
          statusIdx = rows[0].length;
          rows[0].push(statusName);
        }
        for (let r = 1; r < rows.length; r++) {
          while (rows[r].length <= statusIdx) rows[r].push('');
          rows[r][statusIdx] = 'Đã gửi';
        }
        if (sendDurationAdvanceMs > 0) {
          currentTimeMs += sendDurationAdvanceMs;
        }
      };

      return {
        setNow: (iso) => { currentTimeMs = new Date(iso).getTime(); },
        getNowMs: () => currentTimeMs,
        setActiveSpreadsheet: (id) => { activeSpreadsheetId = id; },
        setActiveConfig: (cfg) => { userCacheStore['CURRENT_CAMPAIGN_CONFIG'] = JSON.stringify(cfg); },
        clearActiveConfig: () => { delete userCacheStore['CURRENT_CAMPAIGN_CONFIG']; },
        getActiveTriggers: () => activeTriggers,
        getSentCalls: () => sentCalls,
        getNewTriggerCallsInBackground: () => newTriggerCallsInBackground,
        getSheetRows: (ssId, name) => spreadsheets[ssId].sheets[name],
        getStoredCampaigns: () => JSON.parse(userPropsStore['SCHEDULED_CAMPAIGNS'] || '{}'),
        getDocTriggerMap: () => JSON.parse(userPropsStore['DOC_TRIGGER_MAP'] || '{}'),
        setForceTriggerError: (err) => { forceCreateTriggerError = err; },
        setSendDurationAdvanceMs: (ms) => { sendDurationAdvanceMs = ms; },
        fireTrigger: (trigObj) => {
          const prevSs = activeSpreadsheetId;
          activeSpreadsheetId = null; // Mô phỏng background không có ActiveSpreadsheet UI
          insideBackgroundTrigger = true;
          try {
            ScheduleLogic.processScheduledCampaigns({ triggerUid: trigObj.id });
          } finally {
            insideBackgroundTrigger = false;
            activeSpreadsheetId = prevSs;
          }
        },
        cleanup: () => {
          global.Date = RealDate;
          delete global.PropertiesService;
          delete global.CacheService;
          delete global.LockService;
          delete global.SpreadsheetApp;
          delete global.ScriptApp;
          delete global.sendMergeEmailsFromDraft;
        }
      };
    }

    let env;
    afterEach(() => {
      if (env) {
        env.cleanup();
        env = null;
      }
    });

    test('2 File Sheet giữ 2 Trigger ĐỘC LẬP (07:30 và 08:00): KHÔNG xóa nhầm của nhau, KHÔNG cần đẻ Trigger con trong nền', () => {
      // Bật flag blockBackgroundNewTrigger: nếu code cố gọi newTrigger() trong nền thì sẽ văng lỗi ngay!
      env = createGasTestEnv('2026-11-26T23:00:00+07:00', { blockBackgroundNewTrigger: true });

      // 1. Đặt trên File 1 (Mentee) lúc 07:30
      env.setActiveSpreadsheet('ss_1');
      env.setActiveConfig({
        draftSubject: '[CM2026] Mentee Invite',
        sheetName: 'mentee sau ct',
        colEmail: 2,
        enableTracking: true
      });
      const res1 = ScheduleLogic.createNewScheduledCampaign('2026-11-27T07:30:00+07:00');
      expect(res1).toBe('Đã lên lịch chiến dịch thành công cho 2 email!');

      // 2. Đặt trên File 2 (Mentor) lúc 08:00 (cách 30 phút nhưng khác file → không cảnh báo, giữ cả 2 Trigger độc lập!)
      env.setActiveSpreadsheet('ss_2');
      env.setActiveConfig({
        draftSubject: '[CM2026] Mentor Invite',
        sheetName: 'mentor sau ct',
        colEmail: 2,
        enableTracking: false
      });
      const res2 = ScheduleLogic.createNewScheduledCampaign('2026-11-27T08:00:00+07:00');
      expect(res2).toBe('Đã lên lịch chiến dịch thành công cho 1 email!');

      // Cả 2 Trigger tồn tại song song độc lập (1 trên ss_1, 1 trên ss_2)
      expect(env.getActiveTriggers()).toHaveLength(2);
      const map = env.getDocTriggerMap();
      const trig1 = env.getActiveTriggers().find(t => t.id === map['ss_1']);
      const trig2 = env.getActiveTriggers().find(t => t.id === map['ss_2']);
      expect(trig1.atMs).toBe(new Date('2026-11-27T07:30:00+07:00').getTime());
      expect(trig2.atMs).toBe(new Date('2026-11-27T08:00:00+07:00').getTime());

      // 3. Tới 07:30 → Trigger của File 1 nổ (CHỈ xóa trig1, giữ nguyên trig2, KHÔNG gọi newTrigger trong nền!)
      env.setNow('2026-11-27T07:30:05+07:00');
      env.fireTrigger(trig1);
      expect(env.getSentCalls().map(c => c.spreadsheetId)).toEqual(['ss_1']);
      expect(env.getSentCalls()[0].enableTracking).toBe(true);
      expect(env.getNewTriggerCallsInBackground()).toBe(0);
      expect(env.getActiveTriggers()).toHaveLength(1);
      expect(env.getActiveTriggers()[0].id).toBe(trig2.id);

      // 4. Tới 08:00 → Trigger của File 2 nổ độc lập → cả 2 file đều hoàn thành!
      env.setNow('2026-11-27T08:00:05+07:00');
      env.fireTrigger(trig2);
      expect(env.getSentCalls().map(c => c.spreadsheetId)).toEqual(['ss_1', 'ss_2']);
      expect(env.getNewTriggerCallsInBackground()).toBe(0);
      expect(env.getActiveTriggers()).toHaveLength(0);
      expect(Object.keys(env.getStoredCampaigns())).toHaveLength(0);
    });

    test('Hủy lịch ở File 1 KHÔNG được xóa Trigger đang chạy của File 2', () => {
      env = createGasTestEnv('2026-11-26T23:00:00+07:00');

      env.setActiveSpreadsheet('ss_1');
      env.setActiveConfig({ draftSubject: 'S1 Mail', sheetName: 'mentee sau ct', colEmail: 2 });
      ScheduleLogic.createNewScheduledCampaign('2026-11-27T07:30:00+07:00');

      env.setActiveSpreadsheet('ss_2');
      env.setActiveConfig({ draftSubject: 'S2 Mail', sheetName: 'mentor sau ct', colEmail: 2 });
      ScheduleLogic.createNewScheduledCampaign('2026-11-27T08:00:00+07:00');

      const data = ScheduleLogic.getScheduleManagerData();
      const s1Camp = data.activeCampaigns.find(c => c.spreadsheetId === 'ss_1');

      ScheduleLogic.cancelSingleCampaign(s1Camp.id);

      expect(env.getSheetRows('ss_1', 'mentee sau ct')[1][3]).toBe('');
      expect(env.getSheetRows('ss_2', 'mentor sau ct')[1][2]).toBe('🕒 Đã lên lịch');
      expect(env.getActiveTriggers()).toHaveLength(1);
      expect(env.getActiveTriggers()[0].id).toBe(env.getDocTriggerMap()['ss_2']);
    });

    test('CẤM tạo nhiều lịch cách nhau < 65 phút trên CÙNG 1 file Sheet, KHÔNG cấm nếu khác file', () => {
      env = createGasTestEnv('2026-11-26T23:00:00+07:00');

      env.setActiveSpreadsheet('ss_1');
      env.setActiveConfig({ draftSubject: 'Mentee Dot 1', sheetName: 'mentee sau ct', colEmail: 2 });
      expect(ScheduleLogic.createNewScheduledCampaign('2026-11-27T07:30:00+07:00')).toBe('Đã lên lịch chiến dịch thành công cho 2 email!');

      // 08:00 (cách 30 phút < 65 phút) trên CÙNG file ss_1 → BỊ CHẶN CỨNG
      env.setActiveConfig({ draftSubject: 'Mentor Dot 2', sheetName: 'mentor sau ct', colEmail: 2 });
      const block30 = ScheduleLogic.createNewScheduledCampaign('2026-11-27T08:00:00+07:00');
      expect(block30).toContain('Lỗi: Không thể đặt 2 lịch cách nhau dưới 65 phút');
      expect(block30).toContain('30 phút');

      // 08:34 (cách 64 phút < 65 phút) trên CÙNG file ss_1 → VẪN BỊ CHẶN CỨNG
      const block64 = ScheduleLogic.createNewScheduledCampaign('2026-11-27T08:34:00+07:00');
      expect(block64).toContain('Lỗi: Không thể đặt 2 lịch cách nhau dưới 65 phút');
      expect(block64).toContain('64 phút');
      expect(Object.keys(env.getStoredCampaigns())).toHaveLength(1);
      expect(env.getSheetRows('ss_1', 'mentor sau ct')[1][2]).toBe(''); // Không đánh dấu nhầm

      // 08:35 (đúng 65 phút >= 65 phút) trên CÙNG file ss_1 → HỢP LỆ!
      const allow65 = ScheduleLogic.createNewScheduledCampaign('2026-11-27T08:35:00+07:00');
      expect(allow65).toBe('Đã lên lịch chiến dịch thành công cho 1 email!');
      expect(Object.keys(env.getStoredCampaigns())).toHaveLength(2);

      // Kiểm tra nếu đặt sang FILE KHÁC ss_2 lúc 07:45 (cách 15 phút) → HỢP LỆ hoàn toàn!
      env.setActiveSpreadsheet('ss_2');
      env.setActiveConfig({ draftSubject: 'Other File Batch', sheetName: 'mentor sau ct', colEmail: 2 });
      const allowOtherFile = ScheduleLogic.createNewScheduledCampaign('2026-11-27T07:45:00+07:00');
      expect(allowOtherFile).toBe('Đã lên lịch chiến dịch thành công cho 1 email!');
      expect(env.getActiveTriggers()).toHaveLength(2);
    });

    test('Trên CÙNG 1 file đặt cách >= 1 giờ vẫn tự nối Trigger riêng cho file đó', () => {
      env = createGasTestEnv('2026-11-26T23:00:00+07:00');
      env.setActiveSpreadsheet('ss_1');

      env.setActiveConfig({ draftSubject: 'Mentor 09:00', sheetName: 'mentor sau ct', colEmail: 2 });
      ScheduleLogic.createNewScheduledCampaign('2026-11-27T09:00:00+07:00');

      env.setActiveConfig({ draftSubject: 'Mentee 07:30', sheetName: 'mentee sau ct', colEmail: 2 });
      const res2 = ScheduleLogic.createNewScheduledCampaign('2026-11-27T07:30:00+07:00');
      expect(res2).toBe('Đã lên lịch chiến dịch thành công cho 2 email!'); // >=1.5h nên không cảnh báo

      expect(env.getActiveTriggers()).toHaveLength(1);
      const trig1 = env.getActiveTriggers()[0];
      expect(trig1.atMs).toBe(new Date('2026-11-27T07:30:00+07:00').getTime());

      // Chạy 07:30 → tự đặt Trigger tiếp theo cho 09:00
      env.setNow('2026-11-27T07:30:05+07:00');
      env.fireTrigger(trig1);
      expect(env.getSentCalls().map(c => c.sheetName)).toEqual(['mentee sau ct']);
      expect(env.getActiveTriggers()).toHaveLength(1);
      const trig2 = env.getActiveTriggers()[0];
      expect(trig2.atMs).toBe(new Date('2026-11-27T09:00:00+07:00').getTime());

      // Chạy 09:00 → dọn sạch
      env.setNow('2026-11-27T09:00:05+07:00');
      env.fireTrigger(trig2);
      expect(env.getSentCalls().map(c => c.sheetName)).toEqual(['mentee sau ct', 'mentor sau ct']);
      expect(env.getActiveTriggers()).toHaveLength(0);
    });

    test('Nếu đợt 1 chạy trễ khiến đợt 2 chỉ còn < 60 phút, tự động nới mốc đợt 2 lên +62 phút để KHÔNG dính lỗi 1 hour(s) apart', () => {
      env = createGasTestEnv('2026-11-26T23:00:00+07:00');
      env.setActiveSpreadsheet('ss_1');

      env.setActiveConfig({ draftSubject: 'Dot 1', sheetName: 'mentee sau ct', colEmail: 2 });
      ScheduleLogic.createNewScheduledCampaign('2026-11-27T07:30:00+07:00');

      env.setActiveConfig({ draftSubject: 'Dot 2', sheetName: 'mentor sau ct', colEmail: 2 });
      ScheduleLogic.createNewScheduledCampaign('2026-11-27T08:35:00+07:00');

      // Giả lập Đợt 1 bị bắn trễ tới 07:37:00 và gửi hết 2 phút (tới 07:39:00) → chỉ còn 56 phút tới 08:35:00 (< 1h)!
      const trig1 = env.getActiveTriggers()[0];
      env.setSendDurationAdvanceMs(120 * 1000);
      env.setNow('2026-11-27T07:37:00+07:00');
      env.fireTrigger(trig1);

      expect(env.getSentCalls().map(c => c.draftSubject)).toEqual(['Dot 1']);
      expect(env.getActiveTriggers()).toHaveLength(1);
      // Tự động nới từ 08:35:00 sang 07:39:00 + 62 phút = 08:41:00 → VƯỢT qua rào 1 giờ của Google!
      const trig2 = env.getActiveTriggers()[0];
      expect(trig2.atMs).toBe(new Date('2026-11-27T08:41:00+07:00').getTime());
    });

    test('Chế độ VIEW_ONLY khi mở từ thanh công cụ ngoài: chỉ quản lý/hủy lịch, không cho tạo lịch khi chưa setup Sidebar', () => {
      env = createGasTestEnv('2026-11-26T23:00:00+07:00');

      // Tạo sẵn 1 lịch từ Sidebar
      env.setActiveSpreadsheet('ss_1');
      env.setActiveConfig({ draftSubject: 'Mentee Invite', sheetName: 'mentee sau ct', colEmail: 2 });
      ScheduleLogic.createNewScheduledCampaign('2026-11-27T07:30:00+07:00');

      // Mô phỏng mở nút Schedule Manager từ menu ngoài (xóa CURRENT_CAMPAIGN_CONFIG giống openScheduleViewerDialog)
      env.clearActiveConfig();
      const viewData = ScheduleLogic.getScheduleManagerData();

      expect(viewData.mode).toBe('VIEW_ONLY');
      expect(viewData.currentConfig).toBeNull();
      expect(viewData.currentSpreadsheetId).toBe('ss_1');
      expect(viewData.currentDocCampaignCount).toBe(1);
      expect(viewData.activeCampaigns).toHaveLength(1);

      // Thử tạo lịch trực tiếp khi chưa setup cấu hình → chặn kèm thông báo hướng dẫn mở Bảng Điều Khiển
      const blockedRes = ScheduleLogic.createNewScheduledCampaign('2026-11-27T09:00:00+07:00');
      expect(blockedRes).toContain('Bảng Điều Khiển');
      expect(env.getActiveTriggers()).toHaveLength(1);
    });

    test('Rollback nguyên tử khi tạo Trigger lỗi: KHÔNG sinh chiến dịch ma, KHÔNG làm mất Trigger của file khác', () => {
      env = createGasTestEnv('2026-11-26T23:00:00+07:00');

      // File 2 có sẵn trigger đang chạy bình yên
      env.setActiveSpreadsheet('ss_2');
      env.setActiveConfig({ draftSubject: 'S2 Safe', sheetName: 'mentor sau ct', colEmail: 2 });
      ScheduleLogic.createNewScheduledCampaign('2026-11-27T08:00:00+07:00');

      // File 1 tạo 1 lịch 09:00, sau đó cố thêm 07:30 nhưng gặp lỗi Google trigger
      env.setActiveSpreadsheet('ss_1');
      env.setActiveConfig({ draftSubject: 'S1 Old', sheetName: 'mentor sau ct', colEmail: 2 });
      ScheduleLogic.createNewScheduledCampaign('2026-11-27T09:00:00+07:00');

      let callCount = 0;
      const origNewTrigger = global.ScriptApp.newTrigger;
      global.ScriptApp.newTrigger = (fn) => ({
        timeBased: () => ({
          at: (d) => ({
            create: () => {
              callCount++;
              if (callCount === 1) throw new Error('Transient trigger error');
              return origNewTrigger(fn).timeBased().at(d).create();
            }
          })
        })
      });

      env.setActiveConfig({ draftSubject: 'S1 Fail', sheetName: 'mentee sau ct', colEmail: 2 });
      const failRes = ScheduleLogic.createNewScheduledCampaign('2026-11-27T07:30:00+07:00');
      expect(failRes).toContain('Transient trigger error');

      // Không có chiến dịch ma, Trigger ss_1 khôi phục về 09:00 và Trigger ss_2 vẫn còn nguyên!
      expect(Object.keys(env.getStoredCampaigns())).toHaveLength(2);
      expect(env.getSheetRows('ss_1', 'mentee sau ct')[0]).toEqual(['Họ tên', 'Email', 'Ghi chú']);
      expect(env.getActiveTriggers()).toHaveLength(2);
      const map = env.getDocTriggerMap();
      expect(env.getActiveTriggers().find(t => t.id === map['ss_1']).atMs).toBe(new Date('2026-11-27T09:00:00+07:00').getTime());
      expect(env.getActiveTriggers().find(t => t.id === map['ss_2']).atMs).toBe(new Date('2026-11-27T08:00:00+07:00').getTime());
    });

    test('Chống tạo trùng lặp & tự động dời lịch an toàn >= 62 phút (tuân thủ luật >= 1h của Google) khi quá 3.5 phút', () => {
      env = createGasTestEnv('2026-11-27T07:20:00+07:00');
      env.setActiveSpreadsheet('ss_1');

      env.setActiveConfig({ draftSubject: 'Heavy Batch', sheetName: 'mentee sau ct', colEmail: 2 });
      ScheduleLogic.createNewScheduledCampaign('2026-11-27T07:30:00+07:00');
      expect(ScheduleLogic.createNewScheduledCampaign('2026-11-27T07:30:00+07:00')).toContain('đã có trong hàng đợi');

      // Đặt đợt 2 hợp lệ cách đúng 65 phút (08:35)
      env.setActiveConfig({ draftSubject: 'Next Batch', sheetName: 'mentor sau ct', colEmail: 2 });
      expect(ScheduleLogic.createNewScheduledCampaign('2026-11-27T08:35:00+07:00')).toContain('thành công');

      // Giả lập Trigger 07:30 bị Google bắn trễ tới 08:31:00 (lúc này chỉ mới đợt 1 đến hạn), đợt 1 chạy mất 4 phút tới 08:35:00 (> 210s)
      const trig1 = env.getActiveTriggers()[0];
      env.setSendDurationAdvanceMs(240 * 1000);
      env.setNow('2026-11-27T08:31:00+07:00');
      env.fireTrigger(trig1);

      expect(env.getSentCalls().map(c => c.draftSubject)).toEqual(['Heavy Batch']);
      expect(env.getActiveTriggers()).toHaveLength(1);
      const trigDeferred = env.getActiveTriggers()[0];
      // Phải tự động đẩy sang +62 phút (= 09:37:00) để không dính lỗi Google "at least 1 hour(s) apart"
      expect(trigDeferred.atMs).toBe(new Date('2026-11-27T09:37:00+07:00').getTime());

      env.setSendDurationAdvanceMs(0);
      env.setNow('2026-11-27T09:37:00+07:00');
      env.fireTrigger(trigDeferred);
      expect(env.getSentCalls().map(c => c.draftSubject)).toEqual(['Heavy Batch', 'Next Batch']);
      expect(env.getActiveTriggers()).toHaveLength(0);
    });
  });

});
