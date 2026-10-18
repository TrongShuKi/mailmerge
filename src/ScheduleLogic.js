// ============================================================================
// DỰ ÁN: GOOGLE SHEETS MAIL MERGE PRO
// TỆP: ScheduleLogic.gs - QUẢN LÝ HẸN GIỜ ĐA CHIẾN DỊCH (BẢN TỐI ƯU TOÀN DIỆN)
// ============================================================================

/**
 * Mở cửa sổ Modal quản lý lịch hẹn
 * Sử dụng CacheService để lưu cấu hình tạm, tuyệt đối không làm đầy bộ nhớ Properties
 */
function openScheduleManagerDialog(config) {
  try {
    // 1. Lưu cấu hình tạm vào CacheService (Tự hủy sau 15 phút = 900 giây)
    CacheService.getUserCache().put('CURRENT_CAMPAIGN_CONFIG', JSON.stringify(config), 900);

    // 2. Dọn khóa cũ trong PropertiesService (nếu có tồn tại từ các bản trước)
    PropertiesService.getUserProperties().deleteProperty('CURRENT_CAMPAIGN_CONFIG');

    // 3. Hiển thị hộp thoại giao diện
    const html = HtmlService.createHtmlOutputFromFile('ScheduleDialog')
      .setWidth(780)
      .setHeight(540);
    SpreadsheetApp.getUi().showModalDialog(html, '📅 Quản Lý Lịch Gửi Email (Multi-Campaign)');
  } catch (e) {
    throw new Error("Lỗi khi mở Quản lý lịch: " + e.message);
  }
}

/**
 * Hàm trợ năng: Đếm số lượng email hợp lệ và chưa gửi trên Sheet
 */
function countEligibleRecipients(sheetName, colEmailIndex, statusName) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) return 0;

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return 0;

    const headers = data[0];
    let statusColIndex = headers.indexOf(statusName || "Status");
    if (statusColIndex === -1) statusColIndex = headers.length;

    let count = 0;
    for (let i = 1; i < data.length; i++) {
      if (sheet.isRowHiddenByFilter(i + 1) || sheet.isRowHiddenByUser(i + 1)) continue;

      let email = data[i][colEmailIndex - 1];
      if (!email || email.toString().trim() === "" || email.toString().indexOf("@") === -1) continue;

      let status = data[i][statusColIndex];
      // Bỏ qua nếu đã gửi thành công trước đó
      if (status === "Đã gửi" || status === "Sent") continue;

      count++;
    }
    return count;
  } catch (err) {
    return 0;
  }
}

/**
 * HÀM TRỢ NĂNG: Tự động loại bỏ các chiến dịch đã quá hạn hoặc đã chạy xong
 */
function autoCleanExpiredCampaigns(campaigns) {
  const now = new Date().getTime();
  const cleaned = {};

  for (let id in campaigns) {
    let camp = campaigns[id];
    let scheduleTime = new Date(camp.scheduleTimeStr).getTime();
    
    // Chỉ giữ lại những chiến dịch có thời gian hẹn còn ở tương lai (cộng thêm 1 phút đệm)
    if (scheduleTime > (now - 60000)) {
      cleaned[id] = camp;
    }
  }
  return cleaned;
}

/**
 * Lấy dữ liệu khởi tạo cho hộp thoại ScheduleDialog
 */
function getScheduleManagerData() {
  // 1. Lấy cấu hình từ CacheService (ưu tiên) hoặc PropertiesService dự phòng
  let currentConfigStr = CacheService.getUserCache().get('CURRENT_CAMPAIGN_CONFIG');
  if (!currentConfigStr) {
    currentConfigStr = PropertiesService.getUserProperties().getProperty('CURRENT_CAMPAIGN_CONFIG');
  }
  let currentConfig = currentConfigStr ? JSON.parse(currentConfigStr) : null;

  // 2. Tính số lượng email hợp lệ sẵn sàng gửi
  if (currentConfig) {
    currentConfig.recipientCount = countEligibleRecipients(
      currentConfig.sheetName, 
      currentConfig.colEmail, 
      currentConfig.statusName
    );
  }

  // 3. Đọc danh sách chiến dịch đang chạy và tự dọn dẹp rác cũ
  const campaignsStr = PropertiesService.getUserProperties().getProperty('SCHEDULED_CAMPAIGNS');
  let campaigns = campaignsStr ? JSON.parse(campaignsStr) : {};
  
  // Tự động dọn dẹp các chiến dịch quá hạn
  campaigns = autoCleanExpiredCampaigns(campaigns);
  PropertiesService.getUserProperties().setProperty('SCHEDULED_CAMPAIGNS', JSON.stringify(campaigns));

  return {
    currentConfig: currentConfig,
    activeCampaigns: Object.values(campaigns)
  };
}

/**
 * Thêm một chiến dịch hẹn giờ mới vào danh sách chờ
 */
function createNewScheduledCampaign(scheduleTimeStr) {
  try {
    if (!scheduleTimeStr) return "Lỗi: Vui lòng chọn ngày và giờ hẹn!";

    const scheduleDate = new Date(scheduleTimeStr);
    const now = new Date();

    // Kiểm tra thời gian hẹn phải cách hiện tại ít nhất 2 phút
    if (scheduleDate.getTime() <= now.getTime() + 120000) {
      return "Lỗi: Thời gian hẹn giờ phải cách thời điểm hiện tại ít nhất 2 phút.";
    }

    // Lấy cấu hình từ Cache
    let currentConfigStr = CacheService.getUserCache().get('CURRENT_CAMPAIGN_CONFIG');
    if (!currentConfigStr) {
      currentConfigStr = PropertiesService.getUserProperties().getProperty('CURRENT_CAMPAIGN_CONFIG');
    }
    if (!currentConfigStr) return "Lỗi: Phiên làm việc đã hết hạn. Vui lòng mở lại Bảng điều khiển.";
    
    const rawConfig = JSON.parse(currentConfigStr);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    rawConfig.spreadsheetId = ss.getId();

    // Rút gọn cấu hình tối giản trước khi lưu để tiết kiệm bộ nhớ
    const minimalConfig = {
      spreadsheetId: rawConfig.spreadsheetId,
      sheetName: rawConfig.sheetName,
      statusName: rawConfig.statusName || "Status",
      draftSubject: rawConfig.draftSubject,
      senderName: rawConfig.senderName || "",
      colTitle: rawConfig.colTitle || 0,
      colName: rawConfig.colName || 0,
      colEmail: rawConfig.colEmail,
      colCc: rawConfig.colCc || 0,
      colBcc: rawConfig.colBcc || 0,
      colLink: rawConfig.colLink || 0,
      colAttachment: rawConfig.colAttachment || 0,
      colOther1: rawConfig.colOther1 || 0,
      colOther2: rawConfig.colOther2 || 0,
      colOther3: rawConfig.colOther3 || 0,
      colOther4: rawConfig.colOther4 || 0,
      colOther5: rawConfig.colOther5 || 0,
      colOther6: rawConfig.colOther6 || 0,
      colOther7: rawConfig.colOther7 || 0,
      colOther8: rawConfig.colOther8 || 0,
      delayTime: rawConfig.delayTime || 1
    };

    const recipientCount = countEligibleRecipients(minimalConfig.sheetName, minimalConfig.colEmail, minimalConfig.statusName);
    if (recipientCount === 0) {
      return "Lỗi: Không tìm thấy người nhận nào hợp lệ để lên lịch!";
    }

    const campaignId = "camp_" + now.getTime();
    const newCampaign = {
      id: campaignId,
      draftSubject: minimalConfig.draftSubject,
      sheetName: minimalConfig.sheetName,
      senderName: minimalConfig.senderName || "(Mặc định)",
      scheduleTimeStr: scheduleTimeStr,
      recipientCount: recipientCount,
      config: minimalConfig
    };

    // 1. Đọc và tự làm sạch danh sách chiến dịch trong Properties
    const campaignsStr = PropertiesService.getUserProperties().getProperty('SCHEDULED_CAMPAIGNS');
    let campaigns = campaignsStr ? JSON.parse(campaignsStr) : {};
    campaigns = autoCleanExpiredCampaigns(campaigns);

    campaigns[campaignId] = newCampaign;
    PropertiesService.getUserProperties().setProperty('SCHEDULED_CAMPAIGNS', JSON.stringify(campaigns));

    // 2. Tạo Trigger gọi hàm điều phối ngầm tại thời điểm hẹn
    ScriptApp.newTrigger('processScheduledCampaigns')
      .timeBased()
      .at(scheduleDate)
      .create();

    // 3. ĐÁNH DẤU TRẠNG THÁI HÀNG LOẠT (BATCH UPDATE - SIÊU NHANH)
    const sheet = ss.getSheetByName(minimalConfig.sheetName);
    if (sheet) {
      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      let statusColIndex = headers.indexOf(minimalConfig.statusName);

      // Nếu chưa có cột Status, tự động tạo tiêu đề
      if (statusColIndex === -1) {
        statusColIndex = headers.length;
        sheet.getRange(1, statusColIndex + 1).setValue(minimalConfig.statusName);
      }

      if (data.length > 1) {
        // Lấy phạm vi cột Status để xử lý trên RAM
        const statusRange = sheet.getRange(2, statusColIndex + 1, data.length - 1, 1);
        const statusValues = statusRange.getValues();
        let hasChanges = false;

        for (let i = 1; i < data.length; i++) {
          if (sheet.isRowHiddenByFilter(i + 1) || sheet.isRowHiddenByUser(i + 1)) continue;
          
          let email = data[i][minimalConfig.colEmail - 1];
          let currentStatus = statusValues[i - 1][0];

          if (currentStatus !== "Đã gửi" && currentStatus !== "Sent" && email && email.toString().indexOf("@") !== -1) {
            statusValues[i - 1][0] = "🕒 Đã lên lịch";
            hasChanges = true;
          }
        }

        // Ghi xuống Google Sheets trong đúng 1 lần gọi duy nhất
        if (hasChanges) {
          statusRange.setValues(statusValues);
        }
      }
    }

    return `Đã lên lịch chiến dịch thành công cho ${recipientCount} email!`;
  } catch (e) {
    return "Lỗi lên lịch: " + e.message;
  }
}

/**
 * Hủy một chiến dịch cụ thể theo ID
 */
function cancelSingleCampaign(campaignId) {
  try {
    const campaignsStr = PropertiesService.getUserProperties().getProperty('SCHEDULED_CAMPAIGNS');
    if (!campaignsStr) return "Không tìm thấy danh sách chiến dịch.";
    
    let campaigns = JSON.parse(campaignsStr);
    const targetCampaign = campaigns[campaignId];
    if (!targetCampaign) return "Chiến dịch không tồn tại hoặc đã chạy xong.";

    // 1. Xóa nhãn "🕒 Đã lên lịch" hàng loạt trên Sheet
    try {
      const ss = SpreadsheetApp.openById(targetCampaign.config.spreadsheetId);
      const sheet = ss.getSheetByName(targetCampaign.config.sheetName);
      if (sheet) {
        const data = sheet.getDataRange().getValues();
        const statusColIndex = data[0].indexOf(targetCampaign.config.statusName);

        if (statusColIndex !== -1 && data.length > 1) {
          const statusRange = sheet.getRange(2, statusColIndex + 1, data.length - 1, 1);
          const statusValues = statusRange.getValues();
          let hasChanges = false;

          for (let i = 0; i < statusValues.length; i++) {
            if (statusValues[i][0] === "🕒 Đã lên lịch") {
              statusValues[i][0] = "";
              hasChanges = true;
            }
          }

          if (hasChanges) {
            statusRange.setValues(statusValues);
          }
        }
      }
    } catch (err) {
      console.warn("Không thể xóa trạng thái trên sheet: " + err.message);
    }

    // 2. Xóa chiến dịch khỏi bộ nhớ
    delete campaigns[campaignId];
    campaigns = autoCleanExpiredCampaigns(campaigns);
    PropertiesService.getUserProperties().setProperty('SCHEDULED_CAMPAIGNS', JSON.stringify(campaigns));

    // 3. Nếu không còn chiến dịch nào đang chờ, xóa toàn bộ Trigger ngầm
    if (Object.keys(campaigns).length === 0) {
      cleanupAllScheduleTriggers();
    }

    return "Đã hủy chiến dịch thành công!";
  } catch (e) {
    return "Lỗi khi hủy: " + e.message;
  }
}

/**
 * Hàm điều phối ngầm được kích hoạt bởi Time Trigger
 */
function processScheduledCampaigns() {
  const campaignsStr = PropertiesService.getUserProperties().getProperty('SCHEDULED_CAMPAIGNS');
  if (!campaignsStr) return;

  let campaigns = JSON.parse(campaignsStr);
  const now = new Date().getTime();
  let remainingCount = 0;

  for (let id in campaigns) {
    let camp = campaigns[id];
    let scheduleTime = new Date(camp.scheduleTimeStr).getTime();

    // Nếu đã tới hoặc qua giờ hẹn (dung sai 1 phút)
    if (scheduleTime <= now + 60000) {
      try {
        // Thực hiện gửi email tự động
        sendMergeEmailsFromDraft(camp.config);
      } catch (err) {
        console.error("Lỗi khi chạy chiến dịch " + id + ": " + err.message);
      }
      delete campaigns[id];
    } else {
      remainingCount++;
    }
  }

  // Tự động dọn rác và cập nhật lại danh sách
  campaigns = autoCleanExpiredCampaigns(campaigns);
  PropertiesService.getUserProperties().setProperty('SCHEDULED_CAMPAIGNS', JSON.stringify(campaigns));

  if (remainingCount === 0) {
    cleanupAllScheduleTriggers();
  }
}

/**
 * Xóa sạch các trigger ngầm khi không còn chiến dịch nào chờ gửi
 */
function cleanupAllScheduleTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processScheduledCampaigns') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}