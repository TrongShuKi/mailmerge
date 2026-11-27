// ============================================================================
// DỰ ÁN: GOOGLE SHEETS MAIL MERGE PRO
// TỆP: MailMergePro.gs - CORE ENGINE (TÍCH HỢP OPEN TRACKING)
// ============================================================================
const APP_VERSION = "1.1.9";

function onOpen(e) {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('MailMerge')
    .addItem('Mở Bảng Điều Khiển', 'showSidebar')
    .addItem('⏰ Schedule Manager', 'openScheduleViewerDialog')
    .addSeparator()
    .addItem('📖 Hướng dẫn sử dụng', 'showGuideDialog')
    .addToUi();
}

function onInstall(e) {
  onOpen(e);
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Cấu Hình Mail Merge')
    .setWidth(300);
  SpreadsheetApp.getUi().showSidebar(html);
}

function showGuideDialog() {
  const html = HtmlService.createHtmlOutputFromFile('Guide')
    .setWidth(680)
    .setHeight(540);
  SpreadsheetApp.getUi().showModalDialog(html, '📖 Hướng Dẫn Sử Dụng MailMerge');
}

function indexToLetter(columnNumber) {
  let letter = '';
  while (columnNumber > 0) {
    let temp = (columnNumber - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    columnNumber = (columnNumber - temp - 1) / 26;
  }
  return letter;
}

function normalizeHeaderText(text) {
  if (text === null || text === undefined) return "";
  return text
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[\s.,;:!?*()\[\]{}<>'"`~@#$%^&+=\\/_|-]+/g, ' ')
    .trim();
}

function hasHeaderPhrase(normalizedHeader, phrase) {
  if (!normalizedHeader || !phrase) return false;
  return (" " + normalizedHeader + " ").indexOf(" " + phrase + " ") !== -1;
}

const IGNORED_HEADER_EXACT = [
  "status", "trang thai", "mail merge status", "email status",
  "tracking", "trang thai mo", "opened", "da xem",
  "stt", "no", "id", "timestamp", "ghi chu", "note", "notes"
];

const IGNORED_HEADER_PHRASES = [
  "status", "trang thai", "tracking", "da xem", "ghi chu"
];

const COLUMN_MAPPING_RULES = {
  colTestEmail: {
    exact: [
      "email test", "test email", "mail test", "test mail",
      "email thu", "email gui thu", "test cc", "cc test", "email kiem tra"
    ],
    phrases: [
      "email test", "test email", "mail test", "test mail",
      "email thu", "email gui thu", "gui thu"
    ],
    tokens: [],
    excludeTokens: ["status", "trang thai", "tracking"]
  },
  colCc: {
    exact: ["cc", "email cc", "cc email", "cc mail", "mail cc", "nguoi cc", "danh sach cc"],
    phrases: ["email cc", "cc email", "cc mail", "mail cc", "danh sach cc"],
    tokens: ["cc"],
    excludeTokens: ["bcc", "test", "email thu", "gui thu", "kiem tra"]
  },
  colBcc: {
    exact: ["bcc", "email bcc", "bcc email", "bcc mail", "mail bcc", "nguoi bcc", "danh sach bcc"],
    phrases: ["email bcc", "bcc email", "bcc mail", "mail bcc", "danh sach bcc"],
    tokens: ["bcc"],
    excludeTokens: ["test", "email thu", "gui thu", "kiem tra"]
  },
  colEmail: {
    exact: [
      "email", "e mail", "email chinh", "email nguoi nhan", "nguoi nhan email",
      "dia chi email", "dia chi mail", "mail address", "email address",
      "mail to", "recipient email", "hom thu", "to"
    ],
    phrases: [
      "dia chi email", "dia chi mail", "email chinh", "email nguoi nhan",
      "nguoi nhan email", "mail address", "email address", "recipient email",
      "hom thu", "e mail", "mail to"
    ],
    tokens: ["email", "emails"],
    excludeTokens: [
      "test", "email thu", "mail thu", "gui thu", "kiem tra",
      "cc", "bcc", "link", "url", "file", "dinh kem", "attachment", "tieu de", "subject"
    ]
  },
  colTitle: {
    exact: [
      "danh xung", "danhxung", "xung ho", "xungho",
      "chuc danh", "chuc vu", "dai tu", "title", "salutation", "honorific"
    ],
    phrases: ["danh xung", "danhxung", "xung ho", "xungho", "chuc danh", "chuc vu", "dai tu"],
    tokens: ["title", "salutation", "honorific"],
    excludeTokens: ["email", "mail", "link", "url", "file", "dinh kem", "attachment", "bai viet", "tai lieu", "su kien"]
  },
  colName: {
    exact: [
      "ho va ten", "ho ten", "hoten", "ten", "nguoi nhan",
      "ho ten nguoi nhan", "ten nguoi nhan", "full name", "fullname",
      "name", "recipient", "recipient name"
    ],
    phrases: [
      "ho va ten", "ho ten", "ten nguoi nhan", "ho ten nguoi nhan",
      "full name", "recipient name", "nguoi nhan"
    ],
    tokens: ["ten", "name", "fullname", "recipient", "hoten"],
    excludeTokens: [
      "email", "e mail", "cc", "bcc", "test", "file", "tep",
      "tai lieu", "dinh kem", "attachment", "link", "url",
      "danh xung", "danhxung", "chuc danh", "su kien", "chuong trinh",
      "du an", "nhom", "lop", "truong", "cong ty", "don vi", "to chuc", "nguoi gui"
    ]
  },
  colAttachment: {
    exact: [
      "dinh kem", "file dinh kem", "tep dinh kem", "link dinh kem",
      "link file", "link tai lieu", "link drive", "drive link", "google drive",
      "attachment", "attachments", "attach", "attach files", "tai lieu", "file", "files"
    ],
    phrases: [
      "dinh kem", "file dinh kem", "tep dinh kem", "link dinh kem",
      "link file", "link tai lieu", "link drive", "drive link", "google drive", "attach files"
    ],
    tokens: ["attachment", "attachments", "attach", "file", "files", "tep"],
    excludeTokens: ["email", "cc", "bcc", "test"]
  },
  colLink: {
    exact: ["link", "lien ket", "hyperlink", "url", "duong dan"],
    phrases: ["lien ket", "duong dan", "hyperlink"],
    tokens: ["link", "url", "hyperlink"],
    excludeTokens: [
      "dinh kem", "attachment", "attachments", "attach",
      "file", "files", "tep", "drive", "google drive", "tai lieu",
      "email", "cc", "bcc", "test"
    ]
  }
};

function scoreHeaderAgainstRule(normText, rule) {
  if (!normText || !rule) return 0;
  if (rule.excludeTokens && rule.excludeTokens.some(tok => hasHeaderPhrase(normText, tok))) {
    return 0;
  }
  if (rule.exact && rule.exact.includes(normText)) {
    return 200 + normText.length;
  }
  let best = 0;
  if (rule.phrases) {
    for (let i = 0; i < rule.phrases.length; i++) {
      const phrase = rule.phrases[i];
      if (hasHeaderPhrase(normText, phrase)) {
        const s = 100 + phrase.length;
        if (s > best) best = s;
      }
    }
  }
  if (best === 0 && rule.tokens) {
    for (let i = 0; i < rule.tokens.length; i++) {
      const tok = rule.tokens[i];
      if (hasHeaderPhrase(normText, tok)) {
        const s = 60 + tok.length;
        if (s > best) best = s;
      }
    }
  }
  return best;
}

/**
 * Tự động nhận diện danh sách cột và ánh xạ theo độ ưu tiên khớp (chống chồng lấn & 1 cột tối đa 1 trường)
 */
function detectColumnMappingsFromHeaders(headers) {
  const result = {
    columnsList: [],
    colTitle: "",
    colName: "",
    colEmail: "",
    colTestEmail: "",
    colCc: "",
    colBcc: "",
    colLink: "",
    colAttachment: "",
    colOther1: "", colOther2: "", colOther3: "", colOther4: "",
    colOther5: "", colOther6: "", colOther7: "", colOther8: ""
  };

  if (!Array.isArray(headers) || headers.length === 0) {
    return result;
  }

  const candidates = [];
  const fieldNames = Object.keys(COLUMN_MAPPING_RULES);

  for (let i = 0; i < headers.length; i++) {
    const letter = indexToLetter(i + 1);
    const headerText = headers[i] ? headers[i].toString().trim() : "";

    result.columnsList.push({
      letter: letter,
      name: headerText ? headerText : `(Cột ${letter})`
    });

    const normText = normalizeHeaderText(headerText);
    if (!normText) continue;
    if (IGNORED_HEADER_EXACT.includes(normText)) continue;
    if (IGNORED_HEADER_PHRASES.some(kw => hasHeaderPhrase(normText, kw))) continue;

    for (let f = 0; f < fieldNames.length; f++) {
      const field = fieldNames[f];
      const score = scoreHeaderAgainstRule(normText, COLUMN_MAPPING_RULES[field]);
      if (score > 0) {
        candidates.push({ field: field, colIndex: i, letter: letter, score: score });
      }
    }
  }

  // Sắp xếp điểm khớp giảm dần; bằng điểm thì ưu tiên cột đứng trước
  candidates.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.colIndex - b.colIndex;
  });

  const assignedFields = {};
  const assignedCols = {};
  for (let c = 0; c < candidates.length; c++) {
    const cand = candidates[c];
    if (assignedFields[cand.field] || assignedCols[cand.colIndex]) continue;
    result[cand.field] = cand.letter;
    assignedFields[cand.field] = true;
    assignedCols[cand.colIndex] = true;
  }

  return result;
}

/**
 * Quét hàng tiêu đề của 1 đối tượng Sheet cụ thể để trả về cấu hình cột cho Sidebar
 */
function scanSheetConfig(sheet) {
  const sheetName = sheet.getName();
  const lastCol = sheet.getLastColumn();
  const headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const mapped = detectColumnMappingsFromHeaders(headers);
  mapped.sheetName = sheetName;
  return mapped;
}

/**
 * API gọi từ Sidebar khi người dùng đổi Tab Sheet: chuyển tab hiển thị và quét lại toàn bộ cột
 */
function getConfigForSheet(targetSheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = targetSheetName ? ss.getSheetByName(targetSheetName) : ss.getActiveSheet();
  if (!sheet) {
    throw new Error("Không tìm thấy Tab Sheet: " + targetSheetName);
  }
  try {
    ss.setActiveSheet(sheet);
  } catch (_) {}
  return scanSheetConfig(sheet);
}

function getAutoConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getActiveSheet() : SpreadsheetApp.getActiveSheet();
  const sheetNames = ss ? ss.getSheets().map(s => s.getName()) : [sheet.getName()];

  const drafts = GmailApp.getDrafts();
  const draftSubjects = [];
  let defaultDraftSubject = "";

  for (let i = 0; i < drafts.length; i++) {
    let subj = drafts[i].getMessage().getSubject();
    if (subj && !draftSubjects.includes(subj)) {
      draftSubjects.push(subj);
    }
  }
  if (draftSubjects.length > 0) defaultDraftSubject = draftSubjects[0];

  let defaultSenderName = "";
  if (drafts.length > 0) {
    let rawFrom = drafts[0].getMessage().getFrom();
    let nameMatch = rawFrom.match(/^"?([^"<]+)"?\s*<.*>/);
    if (nameMatch && nameMatch[1]) defaultSenderName = nameMatch[1].trim();
  }
  if (!defaultSenderName) {
    let activeEmail = Session.getActiveUser().getEmail();
    defaultSenderName = activeEmail ? activeEmail.split('@')[0] : "";
  }

  const sheetConfig = scanSheetConfig(sheet);

  return {
    appVersion: APP_VERSION,
    sheetNames: sheetNames,
    sheetName: sheetConfig.sheetName,
    draftSubjects: draftSubjects,
    draftSubject: defaultDraftSubject,
    senderName: defaultSenderName,
    columnsList: sheetConfig.columnsList,
    colTitle: sheetConfig.colTitle,
    colName: sheetConfig.colName,
    colEmail: sheetConfig.colEmail,
    colTestEmail: sheetConfig.colTestEmail,
    colCc: sheetConfig.colCc,
    colBcc: sheetConfig.colBcc,
    colLink: sheetConfig.colLink,
    colAttachment: sheetConfig.colAttachment,
    colOther1: "", colOther2: "", colOther3: "", colOther4: "",
    colOther5: "", colOther6: "", colOther7: "", colOther8: "",
    delayTime: 0.5,
    enableTracking: false,              // Mặc định TẮT theo dõi mở email
    trackingStatusColName: "Tracking"   // Tên cột tracking trên Sheet
  };
}

function encodeEmojiToHtmlEntity(html) {
  return html.replace(/[\u{10000}-\u{10FFFF}]/gu, ch => '&#' + ch.codePointAt(0) + ';');
}

/**
 * Gửi email hàng loạt
 */
function sendMergeEmailsFromDraft(config) {
  try {
    const ss = config.spreadsheetId ? SpreadsheetApp.openById(config.spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(config.sheetName);
    if (!sheet) return "Lỗi: Không tìm thấy Sheet có tên '" + config.sheetName + "'.";

    const data = sheet.getDataRange().getValues();
    const drafts = GmailApp.getDrafts();
    let templateMessage = null;

    for (let i = 0; i < drafts.length; i++) {
      if (drafts[i].getMessage().getSubject() === config.draftSubject) {
        templateMessage = drafts[i].getMessage();
        break;
      }
    }
    if (!templateMessage) return "Lỗi: Không tìm thấy bản nháp có tiêu đề: " + config.draftSubject;

    const htmlTemplate = templateMessage.getBody();
    const draftCc = templateMessage.getCc() || "";
    const draftBcc = templateMessage.getBcc() || "";

    const inlineImages = {};
    const inlineAtts = templateMessage.getAttachments({ includeInlineImages: true, includeAttachments: false });
    const draftAttachments = templateMessage.getAttachments({ includeInlineImages: false, includeAttachments: true });

    if (inlineAtts.length > 0) {
      let mapped = false;
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
          inlineImages[cid] = inlineAtts[idx].copyBlob();
        });
        mapped = true;
      }

      if (!mapped) {
        const cidPattern = /src="cid:([^"]+)"/gi;
        const cidFromHtml = [];
        let hit;
        while ((hit = cidPattern.exec(htmlTemplate)) !== null) {
          if (!cidFromHtml.includes(hit[1])) cidFromHtml.push(hit[1]);
        }
        cidFromHtml.forEach((cid, idx) => {
          if (inlineAtts[idx]) inlineImages[cid] = inlineAtts[idx].copyBlob();
        });
      }
    }

    let sentCount = 0;
    let errorCount = 0;
    const headers = data[0];
    let statusName = config.statusName || "Status";
    let statusColIndex = headers.indexOf(statusName);

    if (statusColIndex === -1) {
      // Tìm cột gần nhất còn trống trên hàng tiêu đề
      for (let c = 0; c < headers.length; c++) {
        if (!headers[c] || headers[c].toString().trim() === "") {
          statusColIndex = c;
          break;
        }
      }
      if (statusColIndex === -1) {
        statusColIndex = headers.length;
      }
      sheet.getRange(1, statusColIndex + 1).setValue(statusName);
      headers[statusColIndex] = statusName;
    }

    // === TẠO CỘT TRACKING NGAY KHI GỬI (NẾU BẬT THEO DÕI) ===
    let trackingColIndex = -1;
    let trackingColName = config.trackingStatusColName || "Tracking";
    if (config.enableTracking) {
      trackingColIndex = headers.indexOf(trackingColName);
      if (trackingColIndex === -1) {
        // Tìm cột gần nhất còn trống trên hàng tiêu đề để tránh ghi đè dữ liệu
        for (let c = 0; c < headers.length; c++) {
          if (!headers[c] || headers[c].toString().trim() === "") {
            trackingColIndex = c;
            break;
          }
        }
        if (trackingColIndex === -1) {
          trackingColIndex = headers.length;
        }
        sheet.getRange(1, trackingColIndex + 1).setValue(trackingColName);
        headers[trackingColIndex] = trackingColName;
      }
    }

    let delayMs = (parseFloat(config.delayTime) || 1) * 1000;

    for (let i = 1; i < data.length; i++) {
      if (sheet.isRowHiddenByFilter(i + 1) || sheet.isRowHiddenByUser(i + 1)) continue;

      let row = data[i];
      let emailAddress = row[config.colEmail - 1];
      let status = (row[statusColIndex] || "").toString().trim();

      if (status === "Đã gửi") continue;

      if (!emailAddress || emailAddress.toString().trim() === "") {
        sheet.getRange(i + 1, statusColIndex + 1).setValue("❌ Lỗi: Email rỗng");
        errorCount++; continue;
      }
      if (emailAddress.toString().indexOf("@") === -1) {
        sheet.getRange(i + 1, statusColIndex + 1).setValue("❌ Lỗi: Email sai định dạng");
        errorCount++; continue;
      }

      try {
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

        personalizedHtml = encodeEmojiToHtmlEntity(personalizedHtml);

        // === OPEN TRACKING: Chèn tracking pixel ẩn vào cuối email nếu bật ===
        if (config.enableTracking) {
          var webAppUrl = getTrackingWebAppUrl();
          if (webAppUrl) {
            var ssId = ss.getId();
            var pixelHtml = generateTrackingPixelHtml(webAppUrl, ssId, config.sheetName, i + 1, trackingColName);
            personalizedHtml += pixelHtml;
          }
        }

        let emailOptions = { htmlBody: personalizedHtml };
        if (Object.keys(inlineImages).length > 0) emailOptions.inlineImages = inlineImages;
        if (config.senderName && config.senderName.trim() !== "") emailOptions.name = config.senderName;

        let finalCc = draftCc;
        if (config.colCc > 0) {
          let sheetCc = row[config.colCc - 1];
          if (sheetCc && sheetCc.toString().trim() !== "") {
            let formattedSheetCc = sheetCc.toString().trim().replace(/[;\n]+/g, ',');
            finalCc = finalCc ? (finalCc + "," + formattedSheetCc) : formattedSheetCc;
          }
        }
        if (finalCc) emailOptions.cc = finalCc;

        let finalBcc = draftBcc;
        if (config.colBcc > 0) {
          let sheetBcc = row[config.colBcc - 1];
          if (sheetBcc && sheetBcc.toString().trim() !== "") {
            let formattedSheetBcc = sheetBcc.toString().trim().replace(/[;\n]+/g, ',');
            finalBcc = finalBcc ? (finalBcc + "," + formattedSheetBcc) : formattedSheetBcc;
          }
        }
        if (finalBcc) emailOptions.bcc = finalBcc;

        let attachmentsArray = [];
        if (draftAttachments.length > 0) {
          attachmentsArray = attachmentsArray.concat(draftAttachments);
        }

        if (config.colAttachment > 0) {
          let cellValue = row[config.colAttachment - 1] || "";
          if (cellValue.toString().trim() !== "") {
            let links = cellValue.toString().split(/[,;\n]+/);
            let hasError = false;

            for (let k = 0; k < links.length; k++) {
              let url = links[k].trim();
              if (url === "") continue;

              let fileIdMatch = url.match(/[-\w]{25,}/);
              if (fileIdMatch && fileIdMatch[0]) {
                try {
                  let file = DriveApp.getFileById(fileIdMatch[0]);
                  attachmentsArray.push(file.getBlob());
                } catch (err) {
                  hasError = true;
                  break;
                }
              }
            }

            if (hasError) {
              sheet.getRange(i + 1, statusColIndex + 1).setValue("❌ Lỗi đính kèm: Link file lỗi hoặc chưa cấp quyền");
              errorCount++;
              continue;
            }
          }
        }

        if (attachmentsArray.length > 0) emailOptions.attachments = attachmentsArray;

        GmailApp.sendEmail(emailAddress, config.draftSubject, "", emailOptions);
        sheet.getRange(i + 1, statusColIndex + 1).setValue("Đã gửi");

        // Khởi tạo trạng thái Tracking nếu bật theo dõi
        if (config.enableTracking && trackingColIndex !== -1) {
          let currentTrackVal = sheet.getRange(i + 1, trackingColIndex + 1).getValue();
          if (!currentTrackVal || currentTrackVal.toString().trim() === "") {
            sheet.getRange(i + 1, trackingColIndex + 1).setValue("Chưa xem");
          }
        }

        SpreadsheetApp.flush();
        sentCount++;
        Utilities.sleep(delayMs);

      } catch (error) {
        sheet.getRange(i + 1, statusColIndex + 1).setValue("Lỗi gửi: " + error.message);
        errorCount++;
      }
    }

    if (sentCount === 0 && errorCount > 0) return `Không có email nào được gửi. Có ${errorCount} dòng bị lỗi.`;
    if (errorCount > 0) return `Đã gửi thành công ${sentCount} email. Bỏ qua ${errorCount} dòng lỗi.`;
    return `Đã gửi thành công toàn bộ ${sentCount} email.`;

  } catch (e) {
    return "Lỗi hệ thống: " + e.message;
  }
}

function parseEmailListFromCell(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "") return [];
  const str = typeof rawValue === "string" ? rawValue : String(rawValue);
  if (str.indexOf("@") === -1) return [];
  const trimmed = str.trim();
  if (!trimmed) return [];

  const results = [];
  const emailPattern = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
  const parts = trimmed.split(/[,;\r\n]+/);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part || part.indexOf("@") === -1) continue;

    const bracketMatch = part.match(/<([^>\s]+@[^>\s]+)>/);
    if (bracketMatch && bracketMatch[1]) {
      const candidate = bracketMatch[1].trim();
      if (emailPattern.test(candidate)) results.push(candidate);
      continue;
    }

    const tokens = part.split(/\s+/);
    for (let t = 0; t < tokens.length; t++) {
      const token = tokens[t].trim();
      if (token && emailPattern.test(token)) {
        results.push(token);
      }
    }
  }

  return results;
}

/**
 * Gom toàn bộ email hợp lệ trong cột Email test (từ dòng 2 trở xuống, loại trùng & bỏ qua nhanh dòng trống)
 */
function collectTestEmailAddresses(sheet, data, colTestEmailIndex, excludeEmails) {
  if (!colTestEmailIndex || colTestEmailIndex <= 0 || !Array.isArray(data) || data.length <= 1) {
    return [];
  }

  const colIdx = colTestEmailIndex - 1;
  const seen = {};
  if (Array.isArray(excludeEmails)) {
    for (let x = 0; x < excludeEmails.length; x++) {
      if (excludeEmails[x]) {
        seen[String(excludeEmails[x]).trim().toLowerCase()] = true;
      }
    }
  }

  const hasFilterCheck = sheet && typeof sheet.isRowHiddenByFilter === "function";
  const hasUserHiddenCheck = sheet && typeof sheet.isRowHiddenByUser === "function";
  const collected = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;

    // Kiểm tra ô trống trên RAM trước để bỏ qua tức thì mà không gọi API Sheet hàng loạt
    const rawCell = row[colIdx];
    if (rawCell === null || rawCell === undefined || rawCell === "") continue;
    const cellStr = typeof rawCell === "string" ? rawCell : String(rawCell);
    if (cellStr.indexOf("@") === -1) continue;
    if (!cellStr.trim()) continue;

    if (hasFilterCheck && sheet.isRowHiddenByFilter(i + 1)) continue;
    if (hasUserHiddenCheck && sheet.isRowHiddenByUser(i + 1)) continue;

    const cellEmails = parseEmailListFromCell(cellStr);
    for (let e = 0; e < cellEmails.length; e++) {
      const email = cellEmails[e];
      const lowerKey = email.toLowerCase();
      if (!seen[lowerKey]) {
        seen[lowerKey] = true;
        collected.push(email);
      }
    }
  }

  return collected;
}

function mergeEmailCsvParts(parts) {
  const seen = {};
  const merged = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const list = Array.isArray(part) ? part : String(part).split(/[,;\r\n]+/);
    for (let j = 0; j < list.length; j++) {
      const item = list[j] ? String(list[j]).trim() : "";
      if (!item) continue;
      const key = item.toLowerCase();
      if (!seen[key]) {
        seen[key] = true;
        merged.push(item);
      }
    }
  }

  return merged.join(",");
}

function sendTestEmail(config) {
  try {
    const myEmail = Session.getActiveUser().getEmail();
    if (!myEmail) return "Lỗi: Không xác định được email tài khoản của bạn.";

    const ss = config.spreadsheetId ? SpreadsheetApp.openById(config.spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(config.sheetName);
    if (!sheet) return "Lỗi: Không tìm thấy Sheet có tên '" + config.sheetName + "'.";

    const data = sheet.getDataRange().getValues();
    const drafts = GmailApp.getDrafts();
    let templateMessage = null;

    for (let i = 0; i < drafts.length; i++) {
      if (drafts[i].getMessage().getSubject() === config.draftSubject) {
        templateMessage = drafts[i].getMessage();
        break;
      }
    }
    if (!templateMessage) return "Lỗi: Không tìm thấy bản nháp có tiêu đề: " + config.draftSubject;

    let sampleRow = null;
    for (let i = 1; i < data.length; i++) {
      let emailCell = data[i][config.colEmail - 1];
      if (!emailCell || emailCell.toString().trim() === "" || emailCell.toString().indexOf("@") === -1) continue;
      if (sheet.isRowHiddenByFilter(i + 1) || sheet.isRowHiddenByUser(i + 1)) continue;
      sampleRow = data[i];
      break;
    }

    if (!sampleRow) return "Lỗi: Không tìm thấy dòng dữ liệu mẫu hợp lệ nào trên Sheet.";

    let personalizedHtml = templateMessage.getBody();
    const draftCc = templateMessage.getCc() || "";
    const draftBcc = templateMessage.getBcc() || "";
    const inlineImages = {};
    const inlineAtts = templateMessage.getAttachments({ includeInlineImages: true, includeAttachments: false });
    const draftAttachments = templateMessage.getAttachments({ includeInlineImages: false, includeAttachments: true });

    if (inlineAtts.length > 0) {
      let mapped = false;
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
          inlineImages[cid] = inlineAtts[idx].copyBlob();
        });
        mapped = true;
      }

      if (!mapped) {
        const cidPattern = /src="cid:([^"]+)"/gi;
        const cidFromHtml = [];
        let hit;
        while ((hit = cidPattern.exec(personalizedHtml)) !== null) {
          if (!cidFromHtml.includes(hit[1])) cidFromHtml.push(hit[1]);
        }
        cidFromHtml.forEach((cid, idx) => {
          if (inlineAtts[idx]) inlineImages[cid] = inlineAtts[idx].copyBlob();
        });
      }
    }

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
        let value = sampleRow[field.colIndex - 1] || "";
        if (linkTags.includes(field.tag)) {
          let linkRegex = new RegExp("https?://(?:\\{\\{|%7B%7B)" + field.tag + "(?:\\}\\}|%7D%7D)", "gi");
          personalizedHtml = personalizedHtml.replace(linkRegex, value);
        }
        let regex = new RegExp("(?:\\{\\{|%7B%7B)" + field.tag + "(?:\\}\\}|%7D%7D)", "gi");
        personalizedHtml = personalizedHtml.replace(regex, value);
      }
    });

    personalizedHtml = encodeEmojiToHtmlEntity(personalizedHtml);

    let attachmentsArray = [];
    if (draftAttachments.length > 0) attachmentsArray = attachmentsArray.concat(draftAttachments);

    if (config.colAttachment > 0) {
      let cellValue = sampleRow[config.colAttachment - 1] || "";
      if (cellValue.toString().trim() !== "") {
        let links = cellValue.toString().split(/[,;\n]+/);
        for (let k = 0; k < links.length; k++) {
          let url = links[k].trim();
          if (url === "") continue;
          let fileIdMatch = url.match(/[-\w]{25,}/);
          if (fileIdMatch && fileIdMatch[0]) {
            try {
              let file = DriveApp.getFileById(fileIdMatch[0]);
              attachmentsArray.push(file.getBlob());
            } catch (err) { }
          }
        }
      }
    }

    let emailOptions = { htmlBody: personalizedHtml };
    if (Object.keys(inlineImages).length > 0) emailOptions.inlineImages = inlineImages;
    if (config.senderName && config.senderName.trim() !== "") emailOptions.name = config.senderName;

    let sheetCc = "";
    if (config.colCc > 0) {
      const rawSheetCc = sampleRow[config.colCc - 1];
      if (rawSheetCc && rawSheetCc.toString().trim() !== "") {
        sheetCc = rawSheetCc.toString().trim();
      }
    }
    const testCcEmails = collectTestEmailAddresses(sheet, data, config.colTestEmail, [myEmail]);
    const finalCc = mergeEmailCsvParts([draftCc, sheetCc, testCcEmails]);
    if (finalCc) emailOptions.cc = finalCc;

    let finalBcc = draftBcc;
    if (config.colBcc > 0) {
      let sheetBcc = sampleRow[config.colBcc - 1];
      if (sheetBcc && sheetBcc.toString().trim() !== "") {
        let formattedSheetBcc = sheetBcc.toString().trim().replace(/[;\n]+/g, ',');
        finalBcc = finalBcc ? (finalBcc + "," + formattedSheetBcc) : formattedSheetBcc;
      }
    }
    if (finalBcc) emailOptions.bcc = finalBcc;
    if (attachmentsArray.length > 0) emailOptions.attachments = attachmentsArray;

    GmailApp.sendEmail(myEmail, "[TEST] " + config.draftSubject, "", emailOptions);
    let successMsg = `Đã gửi thư thử nghiệm thành công đến: ${myEmail}`;
    if (finalCc) successMsg += ` (CC: ${finalCc})`;
    if (finalBcc) successMsg += ` (BCC: ${finalBcc})`;
    return successMsg;
  } catch (e) {
    return "Lỗi gửi thử: " + e.message;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    APP_VERSION,
    indexToLetter,
    normalizeHeaderText,
    detectColumnMappingsFromHeaders,
    scanSheetConfig,
    getAutoConfig,
    getConfigForSheet,
    parseEmailListFromCell,
    collectTestEmailAddresses,
    sendTestEmail,
    sendMergeEmailsFromDraft,
    encodeEmojiToHtmlEntity
  };
}