/**
 * UrbanGrid — Assessment Request Handler
 * Deploy as a Google Apps Script Web App (execute as: Me, access: Anyone)
 *
 * SETUP:
 * 1. Go to https://script.google.com → New project
 * 2. Paste this entire file
 * 3. Replace SHEET_ID with your Google Sheet ID (from the URL)
 * 4. Replace DRIVE_FOLDER_ID with a Google Drive folder ID for bill uploads
 * 5. Click Deploy → New deployment → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 6. Copy the web app URL and paste it into app.js as APPS_SCRIPT_URL
 *
 * SHEET SETUP:
 * Create a sheet named "Leads" with this header row (Row 1):
 * Sr No | Individual Name | Designation | Company Name | Site | Number | Email ID | First Date | Industry | Interest | Bill URL
 */

var SHEET_ID       = 'YOUR_GOOGLE_SHEET_ID_HERE';   // e.g. '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms'
var DRIVE_FOLDER_ID = 'YOUR_DRIVE_FOLDER_ID_HERE';  // folder where bill images are saved

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // ── Save bill to Drive ──────────────────────────────
    var billUrl = '';
    if (data.bill && data.bill.data) {
      var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
      var decoded = Utilities.base64Decode(data.bill.data);
      var blob = Utilities.newBlob(decoded, data.bill.mimeType, data.bill.name);
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      billUrl = file.getUrl();
    }

    // ── Append row to Sheet ─────────────────────────────
    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('Leads');
    if (!sheet) sheet = ss.getActiveSheet();

    var srNo = sheet.getLastRow(); // header is row 1, so last data row + 1 = sr no

    var date = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy');

    sheet.appendRow([
      srNo,
      data.name        || '',
      data.designation || '',
      data.company     || '',
      data.site        || '',
      data.phone       || '',
      data.email       || '',
      date,
      data.industry    || '',
      data.interest    || '',
      billUrl
    ]);

    // ── Optional: send notification email ──────────────
    var notifyEmail = 'sales@urbangrids.in';
    var subject = 'New Assessment Request — ' + (data.company || data.name);
    var body =
      'New lead from urbangrids.in\n\n' +
      'Name: '        + (data.name || '')        + '\n' +
      'Designation: ' + (data.designation || '')  + '\n' +
      'Company: '     + (data.company || '')      + '\n' +
      'Site: '        + (data.site || '')         + '\n' +
      'Phone: '       + (data.phone || '')        + '\n' +
      'Email: '       + (data.email || '')        + '\n' +
      'Industry: '    + (data.industry || '')     + '\n' +
      'Interest: '    + (data.interest || '')     + '\n' +
      (billUrl ? '\nBill: ' + billUrl : '') +
      '\n\nView all leads: https://docs.google.com/spreadsheets/d/' + SHEET_ID;

    MailApp.sendEmail(notifyEmail, subject, body);

    return response({ status: 'success', srNo: srNo });

  } catch (err) {
    return response({ status: 'error', error: err.message });
  }
}

function doGet() {
  return ContentService.createTextOutput('UrbanGrid Assessment API — OK');
}

function response(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
