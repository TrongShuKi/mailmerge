// ============================================================================
// DỰ ÁN: GOOGLE SHEETS MAIL MERGE PRO
// TỆP: TrackingLogic.js - MÔ-ĐUN THEO DÕI MỞ EMAIL (OPEN TRACKING)
// ============================================================================

/**
 * HẰNG SỐ CẤU HÌNH TRACKING
 * - COOLDOWN_MS: Khoảng thời gian tối thiểu (5 giây) từ lúc gửi đến lúc nhận
 *   request mở email. Nếu request đến sớm hơn (0-2s) → Gmail Image Proxy pre-fetch,
 *   KHÔNG phải người dùng thật → bỏ qua để chống báo ảo (anti-false positive).
 * - STATUS_COL_DEFAULT: Tên cột trạng thái tracking mặc định trên Sheet.
 * - WEB_APP_URL_FALLBACK: URL Web App cố định khi gọi từ ngữ cảnh Add-on Google Sheets
 *   (nơi ScriptApp.getService().getUrl() trả về null).
 */
const TRACKING_COOLDOWN_MS = 2 * 1000; // 2 giây (chống pre-fetch bot tức thời 0-1s) // 5 giây (đủ để chống pre-fetch bot nhưng không chặn người thử nghiệm)
const TRACKING_STATUS_COL_DEFAULT = "Tracking";
const TRACKING_WEB_APP_URL_FALLBACK = "https://script.google.com/macros/s/AKfycbziVBkjablulWN_BQoh8TA8DeROesuBQtEKU_fMdvj0TMxYPuhZysXPO84etxNP-CI0/exec";

/**
 * Tạo thẻ HTML tracking pixel ẩn hoàn toàn.
 * Pixel này được chèn vào cuối body email, sử dụng kỹ thuật ẩn đa lớp
 * để tránh hiển thị ảnh vỡ (broken image) trên Gmail, Outlook, v.v.
 *
 * @param {string} webAppUrl     - URL Web App đã deploy
 * @param {string} spreadsheetId - ID của Google Spreadsheet chứa danh sách gửi
 * @param {string} sheetName     - Tên tab Sheet
 * @param {number} rowIndex      - Số thứ tự hàng (1-indexed, bao gồm header = hàng 1)
 * @param {string} statusColName - Tên cột trạng thái tracking (mặc định: "Tracking")
 * @returns {string} Thẻ <img> HTML ẩn hoàn toàn
 */
function generateTrackingPixelHtml(webAppUrl, spreadsheetId, sheetName, rowIndex, statusColName) {
  const ts = new Date().getTime(); // Timestamp lúc gửi → dùng để chống pre-fetch
  const params = [
    "id=" + encodeURIComponent(spreadsheetId),
    "sheet=" + encodeURIComponent(sheetName),
    "row=" + rowIndex,
    "colName=" + encodeURIComponent(statusColName || TRACKING_STATUS_COL_DEFAULT),
    "ts=" + ts
  ].join("&");

  const trackingUrl = webAppUrl + "?" + params;

  // Kỹ thuật ẩn đa lớp:
  // - width="1" height="1": kích thước tối thiểu để Gmail không cắt
  // - display:none !important: ẩn hoàn toàn khỏi layout
  // - max-height:0; opacity:0: backup cho các email client không hỗ trợ display:none
  // - alt="": không hiển thị text thay thế nếu ảnh bị chặn
  return '<img src="' + trackingUrl + '" '
    + 'width="1" height="1" '
    + 'style="display:none !important; max-height:0; opacity:0;" '
    + 'alt="" />';
}

/**
 * Web App endpoint: Nhận HTTP GET request khi email client tải tracking pixel.
 * Cập nhật trạng thái trên Sheet thành "Đã xem (HH:mm dd/MM)".
 *
 * Cơ chế chống báo ảo (Anti-False Positive):
 * - Gmail Image Proxy thường pre-fetch ảnh trong vòng 1-2 giây sau khi gửi.
 * - Nếu khoảng cách (now - ts) < 5 giây → bỏ qua, trả về pixel trống.
 *
 * Cơ chế chống ghi đè (Anti-Overwrite):
 * - Nếu ô đã có trạng thái "Đã xem" → không ghi đè lần xem đầu tiên.
 *
 * @param {Object} e - Event object từ Google Apps Script Web App
 * @param {Object} e.parameter - Các tham số từ URL query string
 * @returns {ContentService.TextOutput} Ảnh GIF 1x1 pixel trong suốt
 */
function doGet(e) {
  try {
    var params = e.parameter || {};
    var spreadsheetId = params.id;
    var sheetName = params.sheet;
    var rowIndex = parseInt(params.row, 10);
    var statusColName = params.colName || TRACKING_STATUS_COL_DEFAULT;
    var sendTimestamp = parseInt(params.ts, 10);

    // Validate tham số đầu vào
    if (!spreadsheetId || !sheetName || isNaN(rowIndex) || rowIndex < 2) {
      return _serveTransparentPixel();
    }

    // === CHỐNG BÁO ẢO (Anti-False Positive) ===
    // Kiểm tra khoảng cách thời gian từ lúc gửi (ts) đến lúc nhận request
    var now = new Date().getTime();
    if (!isNaN(sendTimestamp) && (now - sendTimestamp) < TRACKING_COOLDOWN_MS) {
      // Request đến quá sớm (dưới 5s) → Gmail Image Proxy pre-fetch → BỎ QUA
      return _serveTransparentPixel();
    }

    // Mở Spreadsheet và tìm cột trạng thái tracking
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return _serveTransparentPixel();

    var lastCol = sheet.getLastColumn();
    var headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    var trackingColIndex = -1;
    for (var i = 0; i < headers.length; i++) {
      if (headers[i].toString().trim() === statusColName) {
        trackingColIndex = i;
        break;
      }
    }

    // Nếu chưa có cột tracking → tìm cột trống gần nhất, nếu không có mới tạo ở cuối
    if (trackingColIndex === -1) {
      for (var c = 0; c < headers.length; c++) {
        if (!headers[c] || headers[c].toString().trim() === "") {
          trackingColIndex = c;
          break;
        }
      }
      if (trackingColIndex === -1) {
        trackingColIndex = headers.length;
      }
      sheet.getRange(1, trackingColIndex + 1).setValue(statusColName);
    }

    // === CHỐNG GHI ĐÈ (Anti-Overwrite) ===
    // Chỉ ghi lần xem đầu tiên, không ghi đè nếu đã có "Đã xem"
    var currentValue = sheet.getRange(rowIndex, trackingColIndex + 1).getValue();
    if (currentValue && currentValue.toString().indexOf("Đã xem") !== -1) {
      return _serveTransparentPixel(); // Đã ghi nhận trước đó → bỏ qua
    }

    // Ghi trạng thái "Đã xem (HH:mm dd/MM)" theo múi giờ Việt Nam
    var viewTime = new Date();
    var formattedTime = Utilities.formatDate(viewTime, "Asia/Ho_Chi_Minh", "HH:mm dd/MM");
    sheet.getRange(rowIndex, trackingColIndex + 1).setValue("Đã xem (" + formattedTime + ")");
    SpreadsheetApp.flush();

  } catch (err) {
    // Lỗi bất kỳ → vẫn trả pixel bình thường, không để lộ lỗi cho client
    Logger.log("TrackingLogic doGet error: " + err.message);
  }

  return _serveTransparentPixel();
}

/**
 * Trả về ảnh GIF 1x1 pixel trong suốt (transparent).
 * Đây là response chuẩn cho tracking pixel để email client xử lý đúng.
 *
 * @returns {ContentService.TextOutput} Base64-encoded transparent GIF
 */
function _serveTransparentPixel() {
  // GIF89a 1x1 pixel transparent (43 bytes)
  var gifBase64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  return ContentService
    .createTextOutput(gifBase64)
    .setMimeType(ContentService.MimeType.TEXT);
}

/**
 * Lấy URL Web App hiện tại đã deploy.
 * Hàm tiện ích này được gọi từ MailMergePro.js để lấy URL tracking.
 * 
 * Thứ tự ưu tiên:
 * 1. Thuộc tính Script Properties ("TRACKING_WEB_APP_URL") nếu quản trị viên cấu hình riêng.
 * 2. ScriptApp.getService().getUrl() (khi chạy trong ngữ cảnh Web App).
 * 3. TRACKING_WEB_APP_URL_FALLBACK: URL Web App đã xuất bản chính thức của dự án.
 *
 * @returns {string} URL Web App hợp lệ
 */
function getTrackingWebAppUrl() {
  try {
    var scriptPropUrl = PropertiesService.getScriptProperties().getProperty("TRACKING_WEB_APP_URL");
    if (scriptPropUrl && scriptPropUrl.trim() !== "") {
      return scriptPropUrl.trim();
    }
    var url = ScriptApp.getService().getUrl();
    if (url && url.indexOf("/exec") !== -1) {
      return url;
    }
  } catch (err) {
    Logger.log("TrackingLogic: getTrackingWebAppUrl error: " + err.message);
  }
  return TRACKING_WEB_APP_URL_FALLBACK;
}
