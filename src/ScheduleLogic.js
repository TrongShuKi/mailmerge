// ============================================================================
// DỰ ÁN: GOOGLE SHEETS MAIL MERGE PRO
// TỆP: ScheduleLogic.js - QUẢN LÝ HẸN GIỜ ĐA CHIẾN DỊCH (1 TRIGGER NỐI TIẾP)
// ============================================================================

const SCHEDULE_HANDLER_NAME = 'processScheduledCampaigns';
const SCHEDULE_DUE_TOLERANCE_MS = 60 * 1000;      // Dung sai 1 phút cho thời điểm kích hoạt Trigger
const SCHEDULE_MIN_TRIGGER_LEAD_MS = 65 * 1000;   // Khoảng đệm tối thiểu >1 phút khi tạo Trigger .at()
const SCHEDULE_EXPIRATION_GRACE_MS = 5 * 60 * 1000; // Giữ lịch trễ tối đa 5 phút phòng Google bắn Trigger chậm
const SCHEDULE_MAX_BATCH_RUNTIME_MS = 210 * 1000; // Giới hạn an toàn ~3.5 phút/lần chạy (tránh vượt 6 phút của GAS)

/**
 * Mở cửa sổ Modal quản lý lịch hẹn
 * Sử dụng CacheService để lưu cấu hình tạm, tuyệt đối không làm đầy bộ nhớ Properties
 */
function openScheduleManagerDialog(config) {
  try {
    CacheService.getUserCache().put('CURRENT_CAMPAIGN_CONFIG', JSON.stringify(config), 900);
    PropertiesService.getUserProperties().deleteProperty('CURRENT_CAMPAIGN_CONFIG');

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
      if (status === "Đã gửi" || status === "Sent") continue;

      count++;
    }
    return count;
  } catch (err) {
    return 0;
  }
}

/**
 * HÀM TRỢ NĂNG: Tự động loại bỏ các chiến dịch đã quá hạn hoặc dữ liệu lỗi
 */
function autoCleanExpiredCampaigns(campaigns, currentTimestampMs, graceMs) {
  const now = typeof currentTimestampMs === 'number' ? currentTimestampMs : new Date().getTime();
  const grace = typeof graceMs === 'number' ? graceMs : 60000;
  const cleaned = {};

  if (!campaigns || typeof campaigns !== 'object') return cleaned;

  for (let id in campaigns) {
    let camp = campaigns[id];
    if (!camp || !camp.scheduleTimeStr) continue;
    let scheduleTime = new Date(camp.scheduleTimeStr).getTime();

    if (!isNaN(scheduleTime) && scheduleTime > (now - grace)) {
      cleaned[id] = camp;
    }
  }
  return cleaned;
}

/**
 * Tách danh sách chiến dịch thành 2 nhóm: đến hạn chạy ngay (due) và chờ tương lai (future),
 * sắp xếp nhóm đến hạn theo thứ tự thời gian tăng dần.
 */
function partitionDueAndFutureCampaigns(campaigns, currentTimestampMs, dueToleranceMs) {
  const now = typeof currentTimestampMs === 'number' ? currentTimestampMs : new Date().getTime();
  const tolerance = typeof dueToleranceMs === 'number' ? dueToleranceMs : SCHEDULE_DUE_TOLERANCE_MS;
  const due = [];
  const future = {};

  if (!campaigns || typeof campaigns !== 'object') {
    return { due: due, future: future };
  }

  for (let id in campaigns) {
    let camp = campaigns[id];
    if (!camp || !camp.scheduleTimeStr) continue;
    let scheduleTime = new Date(camp.scheduleTimeStr).getTime();
    if (isNaN(scheduleTime)) continue;

    if (scheduleTime <= (now + tolerance)) {
      due.push(camp);
    } else {
      future[id] = camp;
    }
  }

  due.sort(function (a, b) {
    return new Date(a.scheduleTimeStr).getTime() - new Date(b.scheduleTimeStr).getTime();
  });

  return { due: due, future: future };
}

/**
 * Tìm chiến dịch có thời gian hẹn sớm nhất trong hàng đợi
 */
function getEarliestCampaign(campaigns) {
  if (!campaigns || typeof campaigns !== 'object') return null;

  let earliest = null;
  let earliestTimeMs = Infinity;

  for (let id in campaigns) {
    let camp = campaigns[id];
    if (!camp || !camp.scheduleTimeStr) continue;
    let t = new Date(camp.scheduleTimeStr).getTime();
    if (!isNaN(t) && t < earliestTimeMs) {
      earliestTimeMs = t;
      earliest = camp;
    }
  }

  return earliest ? { campaign: earliest, scheduleTimeMs: earliestTimeMs } : null;
}

/**
 * Tính thời điểm (ms) an toàn để đặt 1 Trigger .at() cho chiến dịch sớm nhất tiếp theo
 */
function computeNextTriggerTimestampMs(campaigns, currentTimestampMs, minLeadMs) {
  const earliest = getEarliestCampaign(campaigns);
  if (!earliest) return null;

  const now = typeof currentTimestampMs === 'number' ? currentTimestampMs : new Date().getTime();
  const lead = typeof minLeadMs === 'number' ? minLeadMs : SCHEDULE_MIN_TRIGGER_LEAD_MS;
  return Math.max(earliest.scheduleTimeMs, now + lead);
}

/**
 * Kiểm tra xem đã có chiến dịch trùng lặp (cùng file + tab + bản nháp + cùng phút hẹn) chưa
 */
function hasDuplicateCampaign(campaigns, spreadsheetId, sheetName, draftSubject, targetTimeMs) {
  if (!campaigns || typeof campaigns !== 'object') return false;
  const targetMinute = Math.floor(targetTimeMs / 60000);

  for (let id in campaigns) {
    let camp = campaigns[id];
    if (!camp || !camp.config) continue;
    let campTimeMs = new Date(camp.scheduleTimeStr).getTime();
    if (isNaN(campTimeMs)) continue;

    if (
      camp.config.spreadsheetId === spreadsheetId &&
      camp.sheetName === sheetName &&
      camp.draftSubject === draftSubject &&
      Math.floor(campTimeMs / 60000) === targetMinute
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Kiểm tra xem còn chiến dịch nào khác đang nhắm vào cùng Sheet & Tab hay không
 */
function hasOtherCampaignForSheet(campaigns, spreadsheetId, sheetName) {
  if (!campaigns || typeof campaigns !== 'object') return false;
  for (let id in campaigns) {
    let camp = campaigns[id];
    if (
      camp &&
      camp.config &&
      camp.config.spreadsheetId === spreadsheetId &&
      camp.sheetName === sheetName
    ) {
      return true;
    }
  }
  return false;
}

function loadCampaignsFromProperties() {
  const campaignsStr = PropertiesService.getUserProperties().getProperty('SCHEDULED_CAMPAIGNS');
  return campaignsStr ? JSON.parse(campaignsStr) : {};
}

function saveCampaignsToProperties(campaigns) {
  PropertiesService.getUserProperties().setProperty('SCHEDULED_CAMPAIGNS', JSON.stringify(campaigns || {}));
}

/**
 * Đồng bộ hóa cơ chế 1 TRIGGER DUY NHẤT (Single Chained Trigger):
 * - Luôn xóa sạch các trigger hẹn giờ cũ của handler 'processScheduledCampaigns'.
 * - Nếu hàng đợi còn chiến dịch, chỉ tạo ĐÚNG 1 trigger trỏ tới mốc giờ SỚM NHẤT.
 *   Khi mốc đó chạy xong, processScheduledCampaigns() sẽ tự động đặt tiếp trigger kế tiếp.
 * Nhờ vậy KHÔNG BAO GIỜ vượt quá giới hạn "1 time-based trigger / tài liệu" của Google Add-on.
 */
function syncScheduleTrigger(campaigns, currentTimestampMs) {
  cleanupAllScheduleTriggers();

  const nextTriggerMs = computeNextTriggerTimestampMs(campaigns, currentTimestampMs, SCHEDULE_MIN_TRIGGER_LEAD_MS);
  if (nextTriggerMs === null) {
    return null;
  }

  ScriptApp.newTrigger(SCHEDULE_HANDLER_NAME)
    .timeBased()
    .at(new Date(nextTriggerMs))
    .create();

  return nextTriggerMs;
}

/**
 * Lấy dữ liệu khởi tạo cho hộp thoại ScheduleDialog
 */
function getScheduleManagerData() {
  let currentConfigStr = CacheService.getUserCache().get('CURRENT_CAMPAIGN_CONFIG');
  if (!currentConfigStr) {
    currentConfigStr = PropertiesService.getUserProperties().getProperty('CURRENT_CAMPAIGN_CONFIG');
  }
  let currentConfig = currentConfigStr ? JSON.parse(currentConfigStr) : null;

  if (currentConfig) {
    currentConfig.recipientCount = countEligibleRecipients(
      currentConfig.sheetName,
      currentConfig.colEmail,
      currentConfig.statusName
    );
  }

  let campaigns = loadCampaignsFromProperties();
  campaigns = autoCleanExpiredCampaigns(campaigns, Date.now(), SCHEDULE_EXPIRATION_GRACE_MS);
  saveCampaignsToProperties(campaigns);

  const activeList = Object.values(campaigns).sort(function (a, b) {
    return new Date(a.scheduleTimeStr).getTime() - new Date(b.scheduleTimeStr).getTime();
  });

  return {
    currentConfig: currentConfig,
    activeCampaigns: activeList
  };
}

/**
 * Đánh dấu trạng thái "🕒 Đã lên lịch" hàng loạt trên Sheet (tìm cột trống gần nhất nếu chưa có cột Status)
 */
function markSheetRowsAsScheduled(ss, minimalConfig) {
  const sheet = ss.getSheetByName(minimalConfig.sheetName);
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  const headers = data[0] || [];
  let statusColIndex = headers.indexOf(minimalConfig.statusName);

  if (statusColIndex === -1) {
    for (let c = 0; c < headers.length; c++) {
      if (!headers[c] || headers[c].toString().trim() === "") {
        statusColIndex = c;
        break;
      }
    }
    if (statusColIndex === -1) {
      statusColIndex = headers.length;
    }
    sheet.getRange(1, statusColIndex + 1).setValue(minimalConfig.statusName);
  }

  if (data.length > 1) {
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

    if (hasChanges) {
      statusRange.setValues(statusValues);
    }
  }
}

/**
 * Thêm một chiến dịch hẹn giờ mới vào danh sách chờ (an toàn giao dịch, tự rollback nếu tạo Trigger lỗi)
 */
function createNewScheduledCampaign(scheduleTimeStr) {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(10000)) {
    return "Lỗi: Hệ thống đang xử lý một lịch hẹn khác, vui lòng thử lại sau vài giây.";
  }

  let previousCampaigns = null;
  let savedToProperties = false;

  try {
    if (!scheduleTimeStr) return "Lỗi: Vui lòng chọn ngày và giờ hẹn!";

    const scheduleDate = new Date(scheduleTimeStr);
    const now = new Date();

    if (isNaN(scheduleDate.getTime())) {
      return "Lỗi: Thời gian hẹn giờ không hợp lệ!";
    }

    // Kiểm tra thời gian hẹn phải cách hiện tại ít nhất 2 phút
    if (scheduleDate.getTime() <= now.getTime() + 120000) {
      return "Lỗi: Thời gian hẹn giờ phải cách thời điểm hiện tại ít nhất 2 phút.";
    }

    let currentConfigStr = CacheService.getUserCache().get('CURRENT_CAMPAIGN_CONFIG');
    if (!currentConfigStr) {
      currentConfigStr = PropertiesService.getUserProperties().getProperty('CURRENT_CAMPAIGN_CONFIG');
    }
    if (!currentConfigStr) return "Lỗi: Phiên làm việc đã hết hạn. Vui lòng mở lại Bảng điều khiển.";

    const rawConfig = JSON.parse(currentConfigStr);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    rawConfig.spreadsheetId = ss.getId();

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
      delayTime: rawConfig.delayTime || 1,
      enableTracking: !!rawConfig.enableTracking,
      trackingStatusColName: rawConfig.trackingStatusColName || "Tracking"
    };

    const recipientCount = countEligibleRecipients(minimalConfig.sheetName, minimalConfig.colEmail, minimalConfig.statusName);
    if (recipientCount === 0) {
      return "Lỗi: Không tìm thấy người nhận nào hợp lệ để lên lịch!";
    }

    // 1. Đọc danh sách hiện tại & dọn rác quá hạn
    previousCampaigns = autoCleanExpiredCampaigns(
      loadCampaignsFromProperties(),
      now.getTime(),
      SCHEDULE_EXPIRATION_GRACE_MS
    );

    if (hasDuplicateCampaign(previousCampaigns, minimalConfig.spreadsheetId, minimalConfig.sheetName, minimalConfig.draftSubject, scheduleDate.getTime())) {
      return "Lỗi: Chiến dịch cho bản nháp và tab Sheet này vào thời điểm đó đã có trong hàng đợi!";
    }

    const campaignId = "camp_" + now.getTime() + "_" + Math.floor(Math.random() * 1000);
    const newCampaign = {
      id: campaignId,
      draftSubject: minimalConfig.draftSubject,
      sheetName: minimalConfig.sheetName,
      senderName: minimalConfig.senderName || "(Mặc định)",
      scheduleTimeStr: scheduleTimeStr,
      recipientCount: recipientCount,
      config: minimalConfig
    };

    const nextCampaigns = Object.assign({}, previousCampaigns);
    nextCampaigns[campaignId] = newCampaign;

    // 2. Đồng bộ 1 Trigger duy nhất TRƯỚC khi chốt lưu Properties (chống sinh "chiến dịch ma")
    try {
      syncScheduleTrigger(nextCampaigns, now.getTime());
    } catch (triggerErr) {
      // Khôi phục trigger cho các chiến dịch trước đó nếu không tạo được trigger mới
      try {
        syncScheduleTrigger(previousCampaigns, now.getTime());
      } catch (_) {}
      return "Lỗi lên lịch: " + triggerErr.message;
    }

    saveCampaignsToProperties(nextCampaigns);
    savedToProperties = true;

    // 3. Đánh dấu trạng thái lên lịch trên Sheet
    markSheetRowsAsScheduled(ss, minimalConfig);

    return `Đã lên lịch chiến dịch thành công cho ${recipientCount} email!`;
  } catch (e) {
    if (savedToProperties && previousCampaigns !== null) {
      try {
        saveCampaignsToProperties(previousCampaigns);
        syncScheduleTrigger(previousCampaigns, Date.now());
      } catch (_) {}
    }
    return "Lỗi lên lịch: " + e.message;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Hủy một chiến dịch cụ thể theo ID và tự động dời Trigger duy nhất sang chiến dịch kế tiếp
 */
function cancelSingleCampaign(campaignId) {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(10000)) {
    return "Lỗi: Hệ thống đang bận, vui lòng thử lại sau vài giây.";
  }

  try {
    let campaigns = loadCampaignsFromProperties();
    const targetCampaign = campaigns[campaignId];
    if (!targetCampaign) return "Chiến dịch không tồn tại hoặc đã chạy xong.";

    delete campaigns[campaignId];
    campaigns = autoCleanExpiredCampaigns(campaigns, Date.now(), SCHEDULE_EXPIRATION_GRACE_MS);

    // 1. Xóa nhãn "🕒 Đã lên lịch" trên Sheet nếu không còn chiến dịch nào khác dùng cùng Sheet & Tab
    if (
      targetCampaign.config &&
      !hasOtherCampaignForSheet(campaigns, targetCampaign.config.spreadsheetId, targetCampaign.config.sheetName)
    ) {
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
    }

    // 2. Lưu danh sách mới & đồng bộ lại Trigger duy nhất (chuyển sang chiến dịch kế tiếp hoặc xóa sạch nếu rỗng)
    saveCampaignsToProperties(campaigns);
    syncScheduleTrigger(campaigns, Date.now());

    return "Đã hủy chiến dịch thành công!";
  } catch (e) {
    return "Lỗi khi hủy: " + e.message;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Hàm điều phối ngầm được kích hoạt bởi Time Trigger duy nhất.
 * Chạy tất cả chiến dịch đến hạn và tự động đặt 1 Trigger nối tiếp cho chiến dịch kế tiếp.
 */
function processScheduledCampaigns() {
  const execStartMs = Date.now();
  const lock = LockService.getUserLock();

  while (true) {
    let batchToRun = [];

    if (!lock.tryLock(10000)) {
      return;
    }

    try {
      const campaigns = loadCampaignsFromProperties();
      const now = Date.now();
      const split = partitionDueAndFutureCampaigns(campaigns, now, SCHEDULE_DUE_TOLERANCE_MS);

      if (split.due.length === 0) {
        const cleaned = autoCleanExpiredCampaigns(split.future, now, SCHEDULE_EXPIRATION_GRACE_MS);
        saveCampaignsToProperties(cleaned);
        syncScheduleTrigger(cleaned, now);
        return;
      }

      // Bảo vệ chống vượt giới hạn thực thi 6 phút của Apps Script:
      // Nếu đã chạy quá ngưỡng an toàn, dời các chiến dịch đến hạn còn lại sang +65 giây để lượt Trigger tiếp theo xử lý
      if ((now - execStartMs) >= SCHEDULE_MAX_BATCH_RUNTIME_MS) {
        const deferredTimeIso = new Date(now + SCHEDULE_MIN_TRIGGER_LEAD_MS).toISOString();
        for (let i = 0; i < split.due.length; i++) {
          split.due[i].scheduleTimeStr = deferredTimeIso;
          split.future[split.due[i].id] = split.due[i];
        }
        saveCampaignsToProperties(split.future);
        syncScheduleTrigger(split.future, now);
        return;
      }

      // Rút các chiến dịch đến hạn ra khỏi hàng đợi trước khi gửi (chống gửi trùng)
      batchToRun = split.due;
      saveCampaignsToProperties(split.future);
      cleanupAllScheduleTriggers();
    } finally {
      lock.releaseLock();
    }

    // Thực thi gửi ngoài Lock để tránh nghẽn phiên làm việc UI
    for (let i = 0; i < batchToRun.length; i++) {
      const camp = batchToRun[i];
      try {
        sendMergeEmailsFromDraft(camp.config);
      } catch (err) {
        console.error("Lỗi khi chạy chiến dịch " + camp.id + ": " + err.message);
      }
    }
  }
}

/**
 * Xóa sạch các trigger hẹn giờ ngầm của hàm điều phối
 */
function cleanupAllScheduleTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === SCHEDULE_HANDLER_NAME) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SCHEDULE_HANDLER_NAME,
    SCHEDULE_DUE_TOLERANCE_MS,
    SCHEDULE_MIN_TRIGGER_LEAD_MS,
    SCHEDULE_EXPIRATION_GRACE_MS,
    SCHEDULE_MAX_BATCH_RUNTIME_MS,
    autoCleanExpiredCampaigns,
    partitionDueAndFutureCampaigns,
    getEarliestCampaign,
    computeNextTriggerTimestampMs,
    hasDuplicateCampaign,
    hasOtherCampaignForSheet,
    syncScheduleTrigger,
    getScheduleManagerData,
    createNewScheduledCampaign,
    cancelSingleCampaign,
    processScheduledCampaigns,
    cleanupAllScheduleTriggers
  };
}
