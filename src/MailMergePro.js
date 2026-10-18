// ============================================================================
// DỰ ÁN: GOOGLE SHEETS MAIL MERGE PRO
// TỆP: MailMergePro.gs - CORE ENGINE (BẢN TINH GIẢN, KHÔNG TRACKING)
// ============================================================================
const APP_VERSION = "1.0.4";

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('MailMerge')
    .addItem('Mở Bảng Điều Khiển', 'showSidebar')
    .addSeparator()
    .addItem('📖 Hướng dẫn sử dụng', 'showGuideDialog')
    .addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Cấu Hình Mail Merge')
    .setWidth(300);
  SpreadsheetApp.getUi().showSidebar(html);
}

function showGuideDialog() {
  const html = HtmlService.createHtmlOutputFromFile('Guide')
    .setWidth(600)
    .setHeight(450);
  SpreadsheetApp.getUi().showModalDialog(html, '📖 Hướng Dẫn Sử Dụng Mail Merge');
}

function getAutoConfig() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const sheetName = sheet.getName();
  
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
  
  function indexToLetter(columnNumber) {
    let letter = '';
    while (columnNumber > 0) {
      let temp = (columnNumber - 1) % 26;
      letter = String.fromCharCode(temp + 65) + letter;
      columnNumber = (columnNumber - temp - 1) / 26;
    }
    return letter;
  }

  let colTitle = "", colName = "", colEmail = "", colLink = "", colAttachment = "", colCc = "", colBcc = "";
  const columnsList = [];
  const lastCol = sheet.getLastColumn();
  
  if (lastCol > 0) {
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    
    const titleKeywords  = ["danh xưng", "danhxung", "chức danh", "xưng hô", "title", "chức vụ", "đại từ"];
    const nameKeywords   = ["tên", "ten", "name", "họ tên", "họ và tên", "người nhận", "recipient"];
    const emailKeywords  = ["email", "e-mail", "mail address", "địa chỉ email", "hòm thư", "mail to"];
    const linkKeywords   = ["link", "liên kết", "url", "đường dẫn"];
    const attachKeywords = ["đính kèm", "attachment", "file", "tài liệu", "attach"];
    const ccKeywords     = ["cc", "CC"];
    const bccKeywords    = ["bcc", "BCC"];
    const ignoreKeywords = ["status", "trạng thái"];

    for (let i = 0; i < headers.length; i++) {
      let letter = indexToLetter(i + 1);
      let headerText = headers[i] ? headers[i].toString().trim() : "";
      
      columnsList.push({
        letter: letter,
        name: headerText ? headerText : `(Cột ${letter})`
      });

      let lowerHeader = headerText.toLowerCase();
      if (ignoreKeywords.some(kw => lowerHeader.includes(kw))) continue;

      if (titleKeywords.some(kw => lowerHeader.includes(kw))) colTitle = letter;
      if (nameKeywords.some(kw => lowerHeader.includes(kw))) colName = letter;
      if (emailKeywords.some(kw => lowerHeader.includes(kw))) colEmail = letter;
      if (linkKeywords.some(kw => lowerHeader.includes(kw))) colLink = letter;
      if (attachKeywords.some(kw => lowerHeader.includes(kw))) colAttachment = letter;
      
      if (ccKeywords.some(kw => lowerHeader === kw.toLowerCase())) colCc = letter;
      if (bccKeywords.some(kw => lowerHeader === kw.toLowerCase())) colBcc = letter;
    }
  }
  
  return {
    appVersion: APP_VERSION,
    sheetName: sheetName,
    draftSubjects: draftSubjects,
    draftSubject: defaultDraftSubject,
    senderName: defaultSenderName,
    columnsList: columnsList,
    colTitle: colTitle,
    colName: colName,
    colEmail: colEmail,
    colCc: colCc,
    colBcc: colBcc,
    colLink: colLink,
    colAttachment: colAttachment,
    colOther1: "", colOther2: "", colOther3: "", colOther4: "",
    colOther5: "", colOther6: "", colOther7: "", colOther8: "",
    delayTime: 1
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
    let statusColIndex = headers.indexOf(config.statusName || "Status");
    
    if (statusColIndex === -1) {
      statusColIndex = headers.length; 
      sheet.getRange(1, statusColIndex + 1).setValue(config.statusName || "Status"); 
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
      if (sheet.isRowHiddenByFilter(i + 1) || sheet.isRowHiddenByUser(i + 1)) continue;
      let emailCell = data[i][config.colEmail - 1];
      if (emailCell && emailCell.toString().trim() !== "" && emailCell.toString().indexOf("@") !== -1) {
        sampleRow = data[i];
        break;
      }
    }

    if (!sampleRow) return "Lỗi: Không tìm thấy dòng dữ liệu mẫu hợp lệ nào trên Sheet.";

    let personalizedHtml = templateMessage.getBody();
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
            } catch (err) {}
          }
        }
      }
    }

    let emailOptions = { htmlBody: personalizedHtml };
    if (Object.keys(inlineImages).length > 0) emailOptions.inlineImages = inlineImages;
    if (config.senderName && config.senderName.trim() !== "") emailOptions.name = config.senderName;
    if (attachmentsArray.length > 0) emailOptions.attachments = attachmentsArray;

    GmailApp.sendEmail(myEmail, "[TEST] " + config.draftSubject, "", emailOptions);
    return `Đã gửi thư thử nghiệm thành công đến: ${myEmail}`;
  } catch (e) {
    return "Lỗi gửi thử: " + e.message;
  }
}