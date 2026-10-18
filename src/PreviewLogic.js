// ============================================================================
// DỰ ÁN: GOOGLE SHEETS MAIL MERGE PRO
// TỆP: PreviewLogic.gs - XỬ LÝ XEM TRƯỚC (CHUNKING CACHE & KHÔNG TRÀN BỘ NHỚ)
// ============================================================================

/**
 * Mở hộp thoại xem trước (Tự động dọn rác cũ và lưu cấu hình an toàn)
 */
function openPreviewDialog(config) {
  try {
    // 1. Tự động dọn các khóa rác cũ trong PropertiesService để tránh nghẽn bộ nhớ
    const userProps = PropertiesService.getUserProperties();
    userProps.deleteProperty('PREVIEW_HTML_CACHE');
    userProps.deleteProperty('PREVIEW_META_CACHE');
    userProps.deleteProperty('PREVIEW_CONFIG');

    // 2. Lưu cấu hình hiện tại vào CacheService (Tự hủy sau 15 phút)
    CacheService.getUserCache().put('PREVIEW_CONFIG', JSON.stringify(config), 900);

    // 3. Mở giao diện Modal
    const html = HtmlService.createHtmlOutputFromFile('Preview')
      .setWidth(900)
      .setHeight(650);
    SpreadsheetApp.getUi().showModalDialog(html, '🔎 Xem trước Email');
  } catch (e) {
    throw new Error("Lỗi khi mở giao diện xem trước: " + e.message);
  }
}

/**
 * HÀM KHỞI TẠO XEM TRƯỚC
 * Quét bản nháp, nhúng ảnh Base64 và phân mảnh lưu vào CacheService
 */
function getPreviewInitialization() {
  const cache = CacheService.getUserCache();
  const configStr = cache.get('PREVIEW_CONFIG');
  if (!configStr) {
    throw new Error("Phiên xem trước đã hết hạn. Vui lòng đóng cửa sổ và bấm PREVIEW lại.");
  }
  const config = JSON.parse(configStr);

  const drafts = GmailApp.getDrafts();
  let templateMessage = null;
  for (let i = 0; i < drafts.length; i++) {
    if (drafts[i].getMessage().getSubject() === config.draftSubject) {
      templateMessage = drafts[i].getMessage();
      break;
    }
  }
  if (!templateMessage) {
    throw new Error("Không tìm thấy bản nháp có tiêu đề: " + config.draftSubject);
  }

  let htmlTemplate = templateMessage.getBody();

  // 1. Trích xuất CC/BCC và tệp đính kèm từ Draft
  const draftCc = templateMessage.getCc() || "";
  const draftBcc = templateMessage.getBcc() || "";
  const draftAttachments = templateMessage.getAttachments({ includeInlineImages: false, includeAttachments: true });
  
  let draftAttNames = [];
  if (draftAttachments.length > 0) {
    draftAttNames = draftAttachments.map(att => "📎 " + att.getName() + " <i>(Từ Nháp)</i>");
  }

  // 2. Xử lý ảnh nhúng (Inline Images) sang Base64 để hiển thị xem trước
  const inlineAtts = templateMessage.getAttachments({ includeInlineImages: true, includeAttachments: false });
  if (inlineAtts.length > 0) {
    const inlineImages = {};
    const rawContent = templateMessage.getRawContent();
    const cidInMimeOrder = [];
    const mimePattern = /Content-ID:\s*<([^>\s]+)>/gi;
    let m;
    while ((m = mimePattern.exec(rawContent)) !== null) {
      const cid = m[1].trim();
      if (!cidInMimeOrder.includes(cid)) cidInMimeOrder.push(cid);
    }

    if (cidInMimeOrder.length === inlineAtts.length) {
      cidInMimeOrder.forEach((cid, idx) => {
        let blob = inlineAtts[idx].copyBlob();
        let b64 = Utilities.base64Encode(blob.getBytes());
        inlineImages[cid] = `data:${blob.getContentType()};base64,${b64}`;
      });
    } else {
      const cidPattern = /src="cid:([^"]+)"/gi;
      const cidFromHtml = [];
      let hit;
      while ((hit = cidPattern.exec(htmlTemplate)) !== null) {
        if (!cidFromHtml.includes(hit[1])) cidFromHtml.push(hit[1]);
      }
      cidFromHtml.forEach((cid, idx) => {
        if (inlineAtts[idx]) {
          let blob = inlineAtts[idx].copyBlob();
          let b64 = Utilities.base64Encode(blob.getBytes());
          inlineImages[cid] = `data:${blob.getContentType()};base64,${b64}`;
        }
      });
    }

    for (let cid in inlineImages) {
      let regex = new RegExp(`src=["']?cid:${cid}["']?`, 'gi');
      htmlTemplate = htmlTemplate.replace(regex, `src="${inlineImages[cid]}" style="max-width:100%; height:auto;"`);
    }
  }

  // 3. LƯU VÀO BỘ NHỚ ĐỆM BẰNG PHƯƠNG PHÁP PHÂN MẢNH (CHUNKING)
  // htmlTemplate chứa Base64 có thể nặng hàng trăm KB, lưu qua setBigCache an toàn 100%
  setBigCache('PREVIEW_HTML_CACHE', htmlTemplate, 900);
  
  cache.put('PREVIEW_META_CACHE', JSON.stringify({
    cc: draftCc,
    bcc: draftBcc,
    attNames: draftAttNames
  }), 900);

  // 4. Lọc các dòng hợp lệ từ Google Sheets
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(config.sheetName);
  if (!sheet) throw new Error("Không tìm thấy Sheet: " + config.sheetName);

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  let statusColIndex = headers.indexOf(config.statusName || "Status");
  if (statusColIndex === -1) statusColIndex = headers.length;

  let validIndices = [];
  for (let i = 1; i < data.length; i++) {
    if (sheet.isRowHiddenByFilter(i + 1) || sheet.isRowHiddenByUser(i + 1)) continue;
    let email = data[i][config.colEmail - 1];
    if (!email || email.toString().trim() === "" || email.toString().indexOf("@") === -1) continue;
    
    let status = data[i][statusColIndex];
    if (status === "Đã gửi" || status === "Sent") continue;

    validIndices.push(i);
  }

  return {
    validIndices: validIndices,
    config: config
  };
}

/**
 * HÀM RENDER TỪNG DÒNG (Tốc độ phản hồi tức thì từ RAM)
 */
function getSinglePreviewHtml(rowIndex, config) {
  const cache = CacheService.getUserCache();
  
  // 1. Tái hợp chuỗi HTML từ các mảnh cache
  let htmlTemplate = getBigCache('PREVIEW_HTML_CACHE');
  let metaStr = cache.get('PREVIEW_META_CACHE');

  if (!htmlTemplate || !metaStr) {
    throw new Error("Phiên làm việc xem trước đã hết hạn. Vui lòng đóng cửa sổ và bấm PREVIEW lại.");
  }
  
  let draftMeta = JSON.parse(metaStr);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(config.sheetName);
  const data = sheet.getDataRange().getValues();
  let row = data[rowIndex];

  let personalizedHtml = htmlTemplate;
  let mappingFields = [];

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
      let value = row[field.colIndex - 1] || "";
      if (linkTags.includes(field.tag)) {
        let linkRegex = new RegExp("https?://(?:\\{\\{|%7B%7B)" + field.tag + "(?:\\}\\}|%7D%7D)", "gi");
        personalizedHtml = personalizedHtml.replace(linkRegex, value);
      }
      let regex = new RegExp("(?:\\{\\{|%7B%7B)" + field.tag + "(?:\\}\\}|%7D%7D)", "gi"); 
      personalizedHtml = personalizedHtml.replace(regex, value);
    }
  });

  let activeEmail = Session.getActiveUser().getEmail();
  let fromLabel = config.senderName ? `${config.senderName} <${activeEmail}>` : activeEmail;
  let to = row[config.colEmail - 1];

  // Gộp CC
  let finalCc = draftMeta.cc; 
  if (config.colCc > 0) {
    let sheetCc = row[config.colCc - 1];
    if (sheetCc && sheetCc.toString().trim() !== "") {
      let formattedSheetCc = sheetCc.toString().trim().replace(/[;\n]+/g, ', ');
      finalCc = finalCc ? (finalCc + ", " + formattedSheetCc) : formattedSheetCc;
    }
  }
  
  // Gộp BCC
  let finalBcc = draftMeta.bcc; 
  if (config.colBcc > 0) {
    let sheetBcc = row[config.colBcc - 1];
    if (sheetBcc && sheetBcc.toString().trim() !== "") {
      let formattedSheetBcc = sheetBcc.toString().trim().replace(/[;\n]+/g, ', ');
      finalBcc = finalBcc ? (finalBcc + ", " + formattedSheetBcc) : formattedSheetBcc;
    }
  }
  
  // Gộp danh sách tệp đính kèm
  let attachmentNames = [...draftMeta.attNames];
  if (config.colAttachment > 0) {
    let cellValue = row[config.colAttachment - 1] || "";
    if (cellValue.toString().trim() !== "") {
      let links = cellValue.toString().split(/[,;\n]+/);
      let validLinks = 0;
      for (let k = 0; k < links.length; k++) {
        if (links[k].trim() !== "" && links[k].match(/[-\w]{25,}/)) {
          validLinks++;
        }
      }
      if (validLinks > 0) {
        attachmentNames.push(`📎 Đính kèm thêm ${validLinks} tệp từ Drive <i>(Sheet)</i>`);
      }
    }
  }

  return {
    from: fromLabel,
    to: to,
    cc: finalCc,
    bcc: finalBcc,
    subject: config.draftSubject,
    htmlBody: personalizedHtml,
    attachments: attachmentNames.join("<br>")
  };
}

// ============================================================================
// CÁC HÀM TRỢ NĂNG: BỘ ĐỆM PHÂN MẢNH CHO DỮ LIỆU LỚN (> 100 KB)
// ============================================================================

/**
 * Chia nhỏ chuỗi văn bản lớn thành từng phần 80 KB và lưu vào CacheService
 */
function setBigCache(key, value, expirationInSeconds) {
  const cache = CacheService.getUserCache();
  const CHUNK_SIZE = 80 * 1024; // 80 KB mỗi mảnh (An toàn dưới ngưỡng 100 KB của Google)
  const numChunks = Math.ceil(value.length / CHUNK_SIZE);
  const chunkMap = {};

  for (let i = 0; i < numChunks; i++) {
    chunkMap[`${key}_chunk_${i}`] = value.substr(i * CHUNK_SIZE, CHUNK_SIZE);
  }
  chunkMap[`${key}_total`] = String(numChunks);
  
  cache.putAll(chunkMap, expirationInSeconds);
}

/**
 * Ghép các mảnh trong CacheService lại thành chuỗi hoàn chỉnh
 */
function getBigCache(key) {
  const cache = CacheService.getUserCache();
  const totalStr = cache.get(`${key}_total`);
  if (!totalStr) return null;

  const numChunks = parseInt(totalStr, 10);
  const chunkKeys = [];
  for (let i = 0; i < numChunks; i++) {
    chunkKeys.push(`${key}_chunk_${i}`);
  }

  const chunks = cache.getAll(chunkKeys);
  let completeString = "";
  for (let i = 0; i < numChunks; i++) {
    let part = chunks[`${key}_chunk_${i}`];
    if (!part) return null; // Thiếu mảnh do quá hạn
    completeString += part;
  }

  return completeString;
}