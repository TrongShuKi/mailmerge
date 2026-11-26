// ============================================================================
// DỰ ÁN: GOOGLE SHEETS MAIL MERGE PRO
// TỆP: ScheduleLogic.js - QUẢN LÝ HẸN GIỜ ĐỘC LẬP THEO TỪNG FILE SHEET
// ============================================================================

const SCHEDULE_HANDLER_NAME = 'processScheduledCampaigns';
const SCHEDULE_DUE_TOLERANCE_MS = 60 * 1000;       // Dung sai 1 phút cho thời điểm kích hoạt Trigger
const SCHEDULE_MIN_TRIGGER_LEAD_MS = 65 * 1000;    // Khoảng đệm tối thiểu >1 phút khi tạo Trigger .at()
const SCHEDULE_EXPIRATION_GRACE_MS = 5 * 60 * 1000;  // Giữ lịch trễ tối đa 5 phút phòng Google bắn Trigger chậm
const SCHEDULE_MAX_BATCH_RUNTIME_MS = 210 * 1000;  // Giới hạn an toàn ~3.5 phút/lần chạy (tránh vượt 6 phút của GAS)
const SCHEDULE_SAME_FILE_MIN_GAP_MS = 65 * 60 * 1000; // Bắt buộc cách >= 65 phút giữa 2 lịch trên cùng 1 file Sheet
const SCHEDULE_CLOCK_COOLDOWN_LEAD_MS = 62 * 60 * 1000; // Khoảng đệm > 1 giờ khi đặt Trigger kế tiếp từ trong Trigger nền (tránh lỗi "Clock events must be scheduled at least 1 hour(s) apart")

/**
 * Mở cửa sổ Modal quản lý lịch hẹn từ Sidebar (cho phép tạo lịch mới + quản lý hàng đợi)
 */
function openScheduleManagerDialog(config) {
  try {
    CacheService.getUserCache().put('CURRENT_CAMPAIGN_CONFIG', JSON.stringify(config), 900);
    PropertiesService.getUserProperties().deleteProperty('CURRENT_CAMPAIGN_CONFIG');

    const html = HtmlService.createHtmlOutputFromFile('ScheduleDialog')
      .setWidth(800)
      .setHeight(560);
    SpreadsheetApp.getUi().showModalDialog(html, '📅 Quản Lý Lịch Gửi Email (Multi-Campaign)');
  } catch (e) {
    throw new Error("Lỗi khi mở Quản lý lịch: " + e.message);
  }
}

/**
 * Mở cửa sổ Modal Schedule Manager từ thanh công cụ bên ngoài (chỉ quản lý/hủy lịch,
 * điều hướng người dùng mở Bảng điều khiển để setup cấu hình trước khi tạo lịch mới).
 */
function openScheduleViewerDialog() {
  try {
    CacheService.getUserCache().remove('CURRENT_CAMPAIGN_CONFIG');
    PropertiesService.getUserProperties().deleteProperty('CURRENT_CAMPAIGN_CONFIG');

    const html = HtmlService.createHtmlOutputFromFile('ScheduleDialog')
      .setWidth(800)
      .setHeight(520);
    SpreadsheetApp.getUi().showModalDialog(html, '⏰ Schedule Manager - Quản Lý Tiến Trình Hẹn Giờ');
  } catch (e) {
    throw new Error("Lỗi khi mở Schedule Manager: " + e.message);
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
 * Lọc danh sách chiến dịch theo một file Spreadsheet cụ thể (hoặc toàn bộ nếu không truyền spreadsheetId)
 */
function filterCampaignsForDoc(campaigns, spreadsheetId) {
  const result = {};
  if (!campaigns || typeof campaigns !== 'object') return result;

  for (let id in campaigns) {
    let camp = campaigns[id];
    if (!camp) continue;
    let campSsId = camp.config && camp.config.spreadsheetId ? camp.config.spreadsheetId : camp.spreadsheetId;
    if (!spreadsheetId || campSsId === spreadsheetId) {
      result[id] = camp;
    }
  }
  return result;
}

/**
 * Tách danh sách chiến dịch thành 2 nhóm: đến hạn chạy ngay (due) và chờ tương lai/file khác (future).
 * Nếu truyền targetSpreadsheetId, chỉ đưa các chiến dịch đến hạn của đúng file đó vào due;
 * các chiến dịch của file khác được giữ nguyên trong future để Trigger riêng của file đó xử lý.
 */
function partitionDueAndFutureCampaigns(campaigns, currentTimestampMs, dueToleranceMs, targetSpreadsheetId) {
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

    let campSsId = camp.config && camp.config.spreadsheetId ? camp.config.spreadsheetId : camp.spreadsheetId;
    let matchesTargetDoc = !targetSpreadsheetId || campSsId === targetSpreadsheetId;

    if (matchesTargetDoc && scheduleTime <= (now + tolerance)) {
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
 * Tìm chiến dịch có thời gian hẹn sớm nhất trong tập chiến dịch truyền vào
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
 * Kiểm tra trong CÙNG 1 file Spreadsheet có lịch nào đang đặt cách targetTimeMs dưới minGapMs (< 65 phút) không
 */
function findCloseCampaignGapOnSameDoc(campaigns, spreadsheetId, targetTimeMs, minGapMs) {
  if (!campaigns || !spreadsheetId || isNaN(targetTimeMs)) return null;
  const threshold = typeof minGapMs === 'number' ? minGapMs : SCHEDULE_SAME_FILE_MIN_GAP_MS;
  let closestConflict = null;
  let minDiffMs = Infinity;

  for (let id in campaigns) {
    let camp = campaigns[id];
    if (!camp || !camp.scheduleTimeStr) continue;
    let campSsId = camp.config && camp.config.spreadsheetId ? camp.config.spreadsheetId : camp.spreadsheetId;
    if (campSsId !== spreadsheetId) continue;

    let campTimeMs = new Date(camp.scheduleTimeStr).getTime();
    if (isNaN(campTimeMs)) continue;

    let diffMs = Math.abs(campTimeMs - targetTimeMs);
    if (diffMs < threshold && diffMs < minDiffMs) {
      minDiffMs = diffMs;
      closestConflict = {
        campaign: camp,
        diffMinutes: Math.max(0, Math.round(diffMs / 60000))
      };
    }
  }

  return closestConflict;
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

function loadDocTriggerMap() {
  const raw = PropertiesService.getUserProperties().getProperty('DOC_TRIGGER_MAP');
  return raw ? JSON.parse(raw) : {};
}

function saveDocTriggerMap(map) {
  PropertiesService.getUserProperties().setProperty('DOC_TRIGGER_MAP', JSON.stringify(map || {}));
}

function findSpreadsheetIdByTriggerUid(docTriggerMap, triggerUid) {
  if (!docTriggerMap || !triggerUid) return null;
  const uidStr = String(triggerUid);
  for (let ssId in docTriggerMap) {
    if (String(docTriggerMap[ssId]) === uidStr) {
      return ssId;
    }
  }
  return null;
}

/**
 * Xóa trigger đúng theo UID (không đụng chạm đến Trigger của các file Spreadsheet khác)
 */
function deleteTriggerByUid(triggerUid) {
  if (!triggerUid) return false;
  const uidStr = String(triggerUid);
  const triggers = ScriptApp.getProjectTriggers();
  let deleted = false;
  for (let i = 0; i < triggers.length; i++) {
    if (String(triggers[i].getUniqueId()) === uidStr) {
      ScriptApp.deleteTrigger(triggers[i]);
      deleted = true;
    }
  }
  return deleted;
}

/**
 * Dọn Trigger thuộc về một file Spreadsheet cụ thể (và các trigger mồ côi cũ chưa được gán file),
 * tuyệt đối GIỮ NGUYÊN Trigger của các file Spreadsheet khác đang hoạt động.
 */
function cleanupTriggersForDoc(targetSpreadsheetId) {
  const docTriggerMap = loadDocTriggerMap();
  const targetUid = targetSpreadsheetId ? docTriggerMap[targetSpreadsheetId] : null;

  // Thu thập danh sách UID đang thuộc quyền sở hữu của các file khác để bảo vệ
  const protectedOtherUids = {};
  for (let ssId in docTriggerMap) {
    if (!targetSpreadsheetId || ssId !== targetSpreadsheetId) {
      if (docTriggerMap[ssId]) {
        protectedOtherUids[String(docTriggerMap[ssId])] = true;
      }
    }
  }

  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() !== SCHEDULE_HANDLER_NAME) continue;
    const uid = String(triggers[i].getUniqueId());
    const isTargetOwned = targetUid && uid === String(targetUid);
    const isOrphanLegacyTrigger = !protectedOtherUids[uid];

    if (!targetSpreadsheetId || isTargetOwned || isOrphanLegacyTrigger) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  if (targetSpreadsheetId) {
    delete docTriggerMap[targetSpreadsheetId];
    saveDocTriggerMap(docTriggerMap);
  } else {
    saveDocTriggerMap({});
  }
}

/**
 * Đồng bộ 1 Trigger ĐỘC LẬP cho riêng file Spreadsheet truyền vào (Per-Document Trigger).
 * - Khi người dùng dùng 2 file Sheet khác nhau, mỗi file giữ 1 Trigger riêng biệt hoàn toàn
 *   qua DOC_TRIGGER_MAP[spreadsheetId], không bao giờ xóa nhầm Trigger của file kia.
 */
function syncDocumentTrigger(targetSpreadsheetId, allCampaigns, currentTimestampMs, minLeadMsOverride) {
  if (!targetSpreadsheetId) {
    return syncScheduleTrigger(allCampaigns, currentTimestampMs, minLeadMsOverride);
  }

  cleanupTriggersForDoc(targetSpreadsheetId);

  const docCampaigns = filterCampaignsForDoc(allCampaigns, targetSpreadsheetId);
  const leadMs = typeof minLeadMsOverride === 'number' ? minLeadMsOverride : SCHEDULE_MIN_TRIGGER_LEAD_MS;
  const nextTriggerMs = computeNextTriggerTimestampMs(docCampaigns, currentTimestampMs, leadMs);
  if (nextTriggerMs === null) {
    return null;
  }

  const created = ScriptApp.newTrigger(SCHEDULE_HANDLER_NAME)
    .timeBased()
    .at(new Date(nextTriggerMs))
    .create();

  const docTriggerMap = loadDocTriggerMap();
  docTriggerMap[targetSpreadsheetId] = String(created.getUniqueId());
  saveDocTriggerMap(docTriggerMap);

  return nextTriggerMs;
}

/**
 * Hàm tương thích ngược: đồng bộ trigger cho toàn cục hoặc cho tất cả file có chiến dịch
 */
function syncScheduleTrigger(campaigns, currentTimestampMs, minLeadMsOverride) {
  cleanupAllScheduleTriggers();

  const leadMs = typeof minLeadMsOverride === 'number' ? minLeadMsOverride : SCHEDULE_MIN_TRIGGER_LEAD_MS;
  const nextTriggerMs = computeNextTriggerTimestampMs(campaigns, currentTimestampMs, leadMs);
  if (nextTriggerMs === null) {
    return null;
  }

  const created = ScriptApp.newTrigger(SCHEDULE_HANDLER_NAME)
    .timeBased()
    .at(new Date(nextTriggerMs))
    .create();

  const earliest = getEarliestCampaign(campaigns);
  const ssId = earliest && earliest.campaign && earliest.campaign.config ? earliest.campaign.config.spreadsheetId : null;
  if (ssId) {
    const map = {};
    map[ssId] = String(created.getUniqueId());
    saveDocTriggerMap(map);
  }

  return nextTriggerMs;
}

/**
 * Lấy dữ liệu khởi tạo cho hộp thoại ScheduleDialog (hỗ trợ cả chế độ từ Sidebar & chế độ Xem từ thanh công cụ)
 */
function getScheduleManagerData() {
  let currentConfigStr = CacheService.getUserCache().get('CURRENT_CAMPAIGN_CONFIG');
  if (!currentConfigStr) {
    currentConfigStr = PropertiesService.getUserProperties().getProperty('CURRENT_CAMPAIGN_CONFIG');
  }
  let currentConfig = currentConfigStr ? JSON.parse(currentConfigStr) : null;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const currentSpreadsheetId = ss ? ss.getId() : null;
  const currentSpreadsheetName = ss ? ss.getName() : "";

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

  // Dọn các map trigger mồ côi nếu không còn chiến dịch nào cho spreadsheet đó
  const docTriggerMap = loadDocTriggerMap();
  let mapDirty = false;
  for (let ssId in docTriggerMap) {
    const docCamps = filterCampaignsForDoc(campaigns, ssId);
    if (Object.keys(docCamps).length === 0) {
      deleteTriggerByUid(docTriggerMap[ssId]);
      delete docTriggerMap[ssId];
      mapDirty = true;
    }
  }
  if (mapDirty) saveDocTriggerMap(docTriggerMap);

  const activeList = Object.values(campaigns).sort(function (a, b) {
    return new Date(a.scheduleTimeStr).getTime() - new Date(b.scheduleTimeStr).getTime();
  });

  const currentDocCampaignCount = currentSpreadsheetId
    ? Object.keys(filterCampaignsForDoc(campaigns, currentSpreadsheetId)).length
    : 0;

  return {
    mode: currentConfig ? 'CREATE_AND_MANAGE' : 'VIEW_ONLY',
    currentSpreadsheetId: currentSpreadsheetId,
    currentSpreadsheetName: currentSpreadsheetName,
    currentConfig: currentConfig,
    currentDocCampaignCount: currentDocCampaignCount,
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
 * Thêm một chiến dịch hẹn giờ mới vào danh sách chờ cho file Sheet hiện tại
 * (cô lập Trigger theo từng file, tự rollback nếu tạo Trigger lỗi)
 */
function createNewScheduledCampaign(scheduleTimeStr) {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(10000)) {
    return "Lỗi: Hệ thống đang xử lý một lịch hẹn khác, vui lòng thử lại sau vài giây.";
  }

  let previousCampaigns = null;
  let savedToProperties = false;
  let currentSsId = null;

  try {
    if (!scheduleTimeStr) return "Lỗi: Vui lòng chọn ngày và giờ hẹn!";

    const scheduleDate = new Date(scheduleTimeStr);
    const now = new Date();

    if (isNaN(scheduleDate.getTime())) {
      return "Lỗi: Thời gian hẹn giờ không hợp lệ!";
    }

    if (scheduleDate.getTime() <= now.getTime() + 120000) {
      return "Lỗi: Thời gian hẹn giờ phải cách thời điểm hiện tại ít nhất 2 phút.";
    }

    let currentConfigStr = CacheService.getUserCache().get('CURRENT_CAMPAIGN_CONFIG');
    if (!currentConfigStr) {
      currentConfigStr = PropertiesService.getUserProperties().getProperty('CURRENT_CAMPAIGN_CONFIG');
    }
    if (!currentConfigStr) return "Lỗi: Bạn cần mở Bảng Điều Khiển để setup cấu hình gửi trước khi lên lịch mới.";

    const rawConfig = JSON.parse(currentConfigStr);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    currentSsId = ss.getId();
    const currentSsName = ss.getName();
    rawConfig.spreadsheetId = currentSsId;

    const minimalConfig = {
      spreadsheetId: currentSsId,
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

    previousCampaigns = autoCleanExpiredCampaigns(
      loadCampaignsFromProperties(),
      now.getTime(),
      SCHEDULE_EXPIRATION_GRACE_MS
    );

    if (hasDuplicateCampaign(previousCampaigns, currentSsId, minimalConfig.sheetName, minimalConfig.draftSubject, scheduleDate.getTime())) {
      return "Lỗi: Chiến dịch cho bản nháp và tab Sheet này vào thời điểm đó đã có trong hàng đợi!";
    }

    const closeConflict = findCloseCampaignGapOnSameDoc(
      previousCampaigns,
      currentSsId,
      scheduleDate.getTime(),
      SCHEDULE_SAME_FILE_MIN_GAP_MS
    );
    if (closeConflict) {
      return `Lỗi: Không thể đặt 2 lịch cách nhau dưới 65 phút trên cùng 1 file Sheet (đang có lịch "${closeConflict.campaign.draftSubject}" cách ${closeConflict.diffMinutes} phút). Vui lòng chọn giờ cách ít nhất 65 phút hoặc tách sang 1 file Sheet bản sao khác!`;
    }

    const campaignId = "camp_" + now.getTime() + "_" + Math.floor(Math.random() * 1000);
    const newCampaign = {
      id: campaignId,
      spreadsheetId: currentSsId,
      spreadsheetName: currentSsName,
      draftSubject: minimalConfig.draftSubject,
      sheetName: minimalConfig.sheetName,
      senderName: minimalConfig.senderName || "(Mặc định)",
      scheduleTimeStr: scheduleTimeStr,
      recipientCount: recipientCount,
      config: minimalConfig
    };

    const nextCampaigns = Object.assign({}, previousCampaigns);
    nextCampaigns[campaignId] = newCampaign;

    // Đồng bộ 1 Trigger ĐỘC LẬP cho riêng file Spreadsheet này (không đụng Trigger của file khác)
    try {
      syncDocumentTrigger(currentSsId, nextCampaigns, now.getTime());
    } catch (triggerErr) {
      try {
        syncDocumentTrigger(currentSsId, previousCampaigns, now.getTime());
      } catch (_) {}
      return "Lỗi lên lịch: " + triggerErr.message;
    }

    saveCampaignsToProperties(nextCampaigns);
    savedToProperties = true;

    markSheetRowsAsScheduled(ss, minimalConfig);

    return `Đã lên lịch chiến dịch thành công cho ${recipientCount} email!`;
  } catch (e) {
    if (savedToProperties && previousCampaigns !== null && currentSsId) {
      try {
        saveCampaignsToProperties(previousCampaigns);
        syncDocumentTrigger(currentSsId, previousCampaigns, Date.now());
      } catch (_) {}
    }
    return "Lỗi lên lịch: " + e.message;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Hủy một chiến dịch cụ thể theo ID và chỉ đồng bộ lại Trigger của đúng file Sheet sở hữu chiến dịch đó
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

    const targetSsId = targetCampaign.config && targetCampaign.config.spreadsheetId
      ? targetCampaign.config.spreadsheetId
      : targetCampaign.spreadsheetId;

    delete campaigns[campaignId];
    campaigns = autoCleanExpiredCampaigns(campaigns, Date.now(), SCHEDULE_EXPIRATION_GRACE_MS);

    if (
      targetSsId &&
      !hasOtherCampaignForSheet(campaigns, targetSsId, targetCampaign.sheetName)
    ) {
      try {
        const ss = SpreadsheetApp.openById(targetSsId);
        const sheet = ss.getSheetByName(targetCampaign.sheetName);
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

    saveCampaignsToProperties(campaigns);
    if (targetSsId) {
      syncDocumentTrigger(targetSsId, campaigns, Date.now());
    } else {
      syncScheduleTrigger(campaigns, Date.now());
    }

    return "Đã hủy chiến dịch thành công!";
  } catch (e) {
    return "Lỗi khi hủy: " + e.message;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Hàm điều phối ngầm được kích hoạt bởi Time Trigger.
 * Sử dụng e.triggerUid để xác định đúng file Spreadsheet vừa đến hẹn, xóa đúng Trigger của file đó
 * mà KHÔNG ảnh hưởng Trigger của các file Spreadsheet khác đang chờ song song.
 */
function processScheduledCampaigns(e) {
  const execStartMs = Date.now();
  const lock = LockService.getUserLock();
  const firedUid = (e && e.triggerUid) ? String(e.triggerUid) : null;
  let targetSsId = null;

  if (firedUid) {
    const initialMap = loadDocTriggerMap();
    targetSsId = findSpreadsheetIdByTriggerUid(initialMap, firedUid);
  }

  while (true) {
    let batchToRun = [];

    if (!lock.tryLock(10000)) {
      return;
    }

    try {
      const campaigns = loadCampaignsFromProperties();
      const now = Date.now();
      const split = partitionDueAndFutureCampaigns(campaigns, now, SCHEDULE_DUE_TOLERANCE_MS, targetSsId);

      if (split.due.length === 0) {
        const cleaned = autoCleanExpiredCampaigns(split.future, now, SCHEDULE_EXPIRATION_GRACE_MS);

        if (targetSsId) {
          // Bảo đảm chiến dịch kế tiếp trên cùng file luôn cách >= 62 phút sau thời điểm vừa chạy,
          // tránh Google ném lỗi "Clock events must be scheduled at least 1 hour(s) apart." nếu đợt trước chạy chậm.
          const minAllowedMs = now + SCHEDULE_CLOCK_COOLDOWN_LEAD_MS;
          const docRemaining = filterCampaignsForDoc(cleaned, targetSsId);
          for (let cid in docRemaining) {
            let t = new Date(cleaned[cid].scheduleTimeStr).getTime();
            if (!isNaN(t) && t < minAllowedMs) {
              cleaned[cid].scheduleTimeStr = new Date(minAllowedMs).toISOString();
            }
          }
          saveCampaignsToProperties(cleaned);
          syncDocumentTrigger(targetSsId, cleaned, now, SCHEDULE_CLOCK_COOLDOWN_LEAD_MS);
        } else {
          saveCampaignsToProperties(cleaned);
          if (firedUid) deleteTriggerByUid(firedUid);
        }
        return;
      }

      if ((now - execStartMs) >= SCHEDULE_MAX_BATCH_RUNTIME_MS) {
        const deferredTimeIso = new Date(now + SCHEDULE_CLOCK_COOLDOWN_LEAD_MS).toISOString();
        for (let i = 0; i < split.due.length; i++) {
          split.due[i].scheduleTimeStr = deferredTimeIso;
          split.future[split.due[i].id] = split.due[i];
        }
        saveCampaignsToProperties(split.future);

        if (targetSsId) {
          syncDocumentTrigger(targetSsId, split.future, now, SCHEDULE_CLOCK_COOLDOWN_LEAD_MS);
        } else {
          syncScheduleTrigger(split.future, now, SCHEDULE_CLOCK_COOLDOWN_LEAD_MS);
        }
        return;
      }

      // Rút các chiến dịch đến hạn ra khỏi hàng đợi trước khi gửi (chống gửi trùng)
      batchToRun = split.due;
      saveCampaignsToProperties(split.future);

      // Xóa đúng Trigger vừa kích hoạt của file hiện tại (giữ nguyên Trigger các file khác)
      if (firedUid) {
        deleteTriggerByUid(firedUid);
        const map = loadDocTriggerMap();
        if (targetSsId && map[targetSsId] === firedUid) {
          delete map[targetSsId];
          saveDocTriggerMap(map);
        }
      } else if (targetSsId) {
        cleanupTriggersForDoc(targetSsId);
      } else {
        cleanupAllScheduleTriggers();
      }
    } finally {
      lock.releaseLock();
    }

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
 * Xóa sạch toàn bộ trigger hẹn giờ ngầm của hàm điều phối (dùng khi reset toàn bộ)
 */
function cleanupAllScheduleTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === SCHEDULE_HANDLER_NAME) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  saveDocTriggerMap({});
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SCHEDULE_HANDLER_NAME,
    SCHEDULE_DUE_TOLERANCE_MS,
    SCHEDULE_MIN_TRIGGER_LEAD_MS,
    SCHEDULE_EXPIRATION_GRACE_MS,
    SCHEDULE_MAX_BATCH_RUNTIME_MS,
    SCHEDULE_SAME_FILE_MIN_GAP_MS,
    SCHEDULE_CLOCK_COOLDOWN_LEAD_MS,
    autoCleanExpiredCampaigns,
    filterCampaignsForDoc,
    partitionDueAndFutureCampaigns,
    getEarliestCampaign,
    computeNextTriggerTimestampMs,
    findCloseCampaignGapOnSameDoc,
    hasDuplicateCampaign,
    hasOtherCampaignForSheet,
    cleanupTriggersForDoc,
    syncDocumentTrigger,
    syncScheduleTrigger,
    getScheduleManagerData,
    createNewScheduledCampaign,
    cancelSingleCampaign,
    processScheduledCampaigns,
    cleanupAllScheduleTriggers
  };
}
