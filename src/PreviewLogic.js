// ============================================================================
// DỰ ÁN: GOOGLE SHEETS MAIL MERGE PRO
// TỆP: PreviewLogic.js - XỬ LÝ XEM TRƯỚC TỐC ĐỘ CAO (CLIENT-SIDE RENDER & CACHE)
// ============================================================================

const PREVIEW_UPFRONT_HIDDEN_CHECK_LIMIT = 150;

function formatPreviewCellText(val) {
  if (val === null || val === undefined || val === "") return "";
  if (val instanceof Date) return val.toString();
  return String(val);
}

function countValidDriveAttachmentLinks(cellValue) {
  if (!cellValue) return 0;
  const str = String(cellValue).trim();
  if (!str) return 0;
  const links = str.split(/[,;\n]+/);
  let validLinks = 0;
  for (let k = 0; k < links.length; k++) {
    const part = links[k].trim();
    if (part !== "" && /[-\w]{25,}/.test(part)) {
      validLinks++;
    }
  }
  return validLinks;
}

function escapePreviewHtmlText(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function extractPreviewRowRecord(row, dataIndex, config) {
  const rec = {
    idx: dataIndex,
    r: dataIndex + 1,
    to: formatPreviewCellText(row[config.colEmail - 1]).trim()
  };

  if (config.colTitle > 0) {
    const t = formatPreviewCellText(row[config.colTitle - 1]);
    if (t) rec.t = t;
  }
  if (config.colName > 0) {
    const n = formatPreviewCellText(row[config.colName - 1]);
    if (n) rec.n = n;
  }
  if (config.colLink > 0) {
    const l = formatPreviewCellText(row[config.colLink - 1]);
    if (l) rec.l = l;
  }
  if (config.colAttachment > 0) {
    const attCount = countValidDriveAttachmentLinks(row[config.colAttachment - 1]);
    if (attCount > 0) rec.a = attCount;
  }
  if (config.colCc > 0) {
    const rawCc = formatPreviewCellText(row[config.colCc - 1]).trim();
    if (rawCc) rec.cc = rawCc.replace(/[;\n]+/g, ', ');
  }
  if (config.colBcc > 0) {
    const rawBcc = formatPreviewCellText(row[config.colBcc - 1]).trim();
    if (rawBcc) rec.bcc = rawBcc.replace(/[;\n]+/g, ', ');
  }

  let others = null;
  for (let j = 1; j <= 8; j++) {
    const colIdx = config["colOther" + j];
    if (colIdx > 0) {
      const val = formatPreviewCellText(row[colIdx - 1]);
      if (val) {
        if (!others) others = {};
        others[j] = val;
      }
    }
  }
  if (others) rec.o = others;

  return rec;
}

function extractEligiblePreviewRows(sheet, data, config) {
  if (!Array.isArray(data) || data.length <= 1) {
    return { validIndices: [], rows: [], hiddenCheckDeferred: false };
  }

  const headers = data[0] || [];
  const statusColIndex = headers.indexOf(config.statusName || "Status");
  const emailIdx = config.colEmail - 1;
  const ramCandidates = [];

  // Bước 1: Lọc trên RAM trước để bỏ qua tức thì dòng trống / sai email / đã gửi (0 RPC call)
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;

    const rawEmail = row[emailIdx];
    if (rawEmail === null || rawEmail === undefined || rawEmail === "") continue;
    const emailStr = String(rawEmail).trim();
    if (!emailStr || emailStr.indexOf("@") === -1) continue;

    if (statusColIndex !== -1) {
      const status = row[statusColIndex] ? String(row[statusColIndex]).trim() : "";
      if (status === "Đã gửi" || status === "Sent") continue;
    }

    ramCandidates.push(i);
  }

  let hiddenCheckDeferred = false;
  let eligibleIndices = [];

  // Bước 2: Với danh sách <= ngưỡng an toàn thì kiểm tra ẩn dòng; danh sách lớn tải nhanh không treo modal
  if (ramCandidates.length <= PREVIEW_UPFRONT_HIDDEN_CHECK_LIMIT && sheet) {
    const hasFilter = typeof sheet.getFilter === "function" ? !!sheet.getFilter() : true;
    const canCheckFilter = hasFilter && typeof sheet.isRowHiddenByFilter === "function";
    const canCheckUser = typeof sheet.isRowHiddenByUser === "function";

    for (let k = 0; k < ramCandidates.length; k++) {
      const rowIdx = ramCandidates[k];
      if (canCheckFilter && sheet.isRowHiddenByFilter(rowIdx + 1)) continue;
      if (canCheckUser && sheet.isRowHiddenByUser(rowIdx + 1)) continue;
      eligibleIndices.push(rowIdx);
    }
  } else {
    hiddenCheckDeferred = ramCandidates.length > PREVIEW_UPFRONT_HIDDEN_CHECK_LIMIT;
    eligibleIndices = ramCandidates;
  }

  const rows = [];
  for (let m = 0; m < eligibleIndices.length; m++) {
    const rowIdx = eligibleIndices[m];
    rows.push(extractPreviewRowRecord(data[rowIdx], rowIdx, config));
  }

  return {
    validIndices: eligibleIndices,
    rows: rows,
    hiddenCheckDeferred: hiddenCheckDeferred
  };
}

function applyPreviewMergeTags(htmlTemplate, rec) {
  let personalizedHtml = htmlTemplate || "";

  const replaceTagList = function (tags, rawVal, isLink) {
    const value = formatPreviewCellText(rawVal);
    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i];
      if (isLink) {
        const linkRegex = new RegExp("https?://(?:\\{\\{|%7B%7B)" + tag + "(?:\\}\\}|%7D%7D)", "gi");
        personalizedHtml = personalizedHtml.replace(linkRegex, function () { return value; });
      }
      const regex = new RegExp("(?:\\{\\{|%7B%7B)" + tag + "(?:\\}\\}|%7D%7D)", "gi");
      personalizedHtml = personalizedHtml.replace(regex, function () { return value; });
    }
  };

  if (rec.t !== undefined) {
    replaceTagList(["danhxung", "danh xưng", "chucdanh", "chức danh", "xungho", "xưng hô", "title"], rec.t, false);
  }
  if (rec.n !== undefined) {
    replaceTagList(["ten", "tên", "hoten", "họ tên", "ho va ten", "họ và tên", "nguoinhan", "người nhận", "name", "fullname"], rec.n, false);
  }
  if (rec.l !== undefined) {
    replaceTagList(["link", "liên kết", "url", "đường dẫn"], rec.l, true);
  }
  if (rec.o) {
    for (let j = 1; j <= 8; j++) {
      if (rec.o[j] !== undefined) {
        replaceTagList(["other" + j], rec.o[j], false);
      }
    }
  }

  return personalizedHtml;
}

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
      .setWidth(940)
      .setHeight(680);
    SpreadsheetApp.getUi().showModalDialog(html, '🔎 Xem trước Email');
  } catch (e) {
    throw new Error("Lỗi khi mở giao diện xem trước: " + e.message);
  }
}

/**
 * Đọc bản nháp Gmail và chuyển toàn bộ ảnh nội tuyến sang Base64 một lần duy nhất
 */
function buildPreviewDraftBundle(config) {
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
  const draftCc = templateMessage.getCc() || "";
  const draftBcc = templateMessage.getBcc() || "";
  const draftAttachments = templateMessage.getAttachments({ includeInlineImages: false, includeAttachments: true });

  let draftAttNames = [];
  if (draftAttachments.length > 0) {
    draftAttNames = draftAttachments.map(att => "📎 " + escapePreviewHtmlText(att.getName()) + " <i>(Từ Nháp)</i>");
  }

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

  const activeEmail = Session.getActiveUser().getEmail();
  const fromLabel = config.senderName ? `${config.senderName} <${activeEmail}>` : activeEmail;

  return {
    htmlTemplate: htmlTemplate,
    draftCc: draftCc,
    draftBcc: draftBcc,
    draftAttNames: draftAttNames,
    fromLabel: fromLabel
  };
}

/**
 * HÀM KHỞI TẠO XEM TRƯỚC
 * Quét bản nháp + dữ liệu gọn nhẹ 1 lần để Client chuyển/nhảy tới mọi người nhận tức thì (< 5ms)
 */
function getPreviewInitialization() {
  const cache = CacheService.getUserCache();
  const configStr = cache.get('PREVIEW_CONFIG');
  if (!configStr) {
    throw new Error("Phiên xem trước đã hết hạn. Vui lòng đóng cửa sổ và bấm PREVIEW lại.");
  }
  const config = JSON.parse(configStr);
  const draftBundle = buildPreviewDraftBundle(config);

  // Vẫn duy trì cache phân mảnh làm dự phòng cho getSinglePreviewHtml
  try {
    setBigCache('PREVIEW_HTML_CACHE', draftBundle.htmlTemplate, 900);
    cache.put('PREVIEW_META_CACHE', JSON.stringify({
      cc: draftBundle.draftCc,
      bcc: draftBundle.draftBcc,
      attNames: draftBundle.draftAttNames
    }), 900);
  } catch (_) {}

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(config.sheetName);
  if (!sheet) throw new Error("Không tìm thấy Sheet: " + config.sheetName);

  const data = sheet.getDataRange().getValues();
  const extracted = extractEligiblePreviewRows(sheet, data, config);

  return {
    validIndices: extracted.validIndices,
    rows: extracted.rows,
    hiddenCheckDeferred: extracted.hiddenCheckDeferred,
    hiddenCheckLimit: PREVIEW_UPFRONT_HIDDEN_CHECK_LIMIT,
    config: config,
    template: {
      from: draftBundle.fromLabel,
      subject: config.draftSubject || "",
      htmlTemplate: draftBundle.htmlTemplate,
      cc: draftBundle.draftCc,
      bcc: draftBundle.draftBcc,
      attNames: draftBundle.draftAttNames
    }
  };
}

/**
 * HÀM RENDER TỪNG DÒNG (Giữ tương thích nếu gọi đơn lẻ từ Server)
 */
function getSinglePreviewHtml(rowIndex, config) {
  const cache = CacheService.getUserCache();

  let htmlTemplate = getBigCache('PREVIEW_HTML_CACHE');
  let metaStr = cache.get('PREVIEW_META_CACHE');

  if (!htmlTemplate || !metaStr) {
    throw new Error("Phiên làm việc xem trước đã hết hạn. Vui lòng đóng cửa sổ và bấm PREVIEW lại.");
  }

  let draftMeta = JSON.parse(metaStr);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(config.sheetName);
  const data = sheet.getDataRange().getValues();
  const row = data[rowIndex];
  if (!row) {
    throw new Error("Không tìm thấy dữ liệu ở dòng: " + (rowIndex + 1));
  }

  const rec = extractPreviewRowRecord(row, rowIndex, config);
  const personalizedHtml = applyPreviewMergeTags(htmlTemplate, rec);

  const activeEmail = Session.getActiveUser().getEmail();
  const fromLabel = config.senderName ? `${config.senderName} <${activeEmail}>` : activeEmail;

  const finalCc = [draftMeta.cc, rec.cc].filter(Boolean).join(", ");
  const finalBcc = [draftMeta.bcc, rec.bcc].filter(Boolean).join(", ");

  const attachmentNames = [...draftMeta.attNames];
  if (rec.a > 0) {
    attachmentNames.push(`📎 Đính kèm thêm ${rec.a} tệp từ Drive <i>(Sheet)</i>`);
  }

  return {
    from: fromLabel,
    to: rec.to,
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PREVIEW_UPFRONT_HIDDEN_CHECK_LIMIT,
    formatPreviewCellText,
    countValidDriveAttachmentLinks,
    extractPreviewRowRecord,
    extractEligiblePreviewRows,
    applyPreviewMergeTags,
    openPreviewDialog,
    getPreviewInitialization,
    getSinglePreviewHtml,
    setBigCache,
    getBigCache
  };
}