// ╔══════════════════════════════════════════════════════════════════╗
// ║  GREEN SALON — BILLING MANAGEMENT SYSTEM                        ║
// ║  Backend: Google Apps Script (Code.gs)                          ║
// ║  Version: FINAL (merged best of v12 + v21)                      ║
// ║  Owner: Harsha | Developer: one stop solutions - dlb             ║
// ║  Architecture: Master Sheet (branches registry) +               ║
// ║                Branch Sheets (staff, entries, reports, daily,    ║
// ║                monthly) + time-based triggers                    ║
// ╚══════════════════════════════════════════════════════════════════╝
//
// ══════════════════════════════════════════════════════════════════
// QUICK SETUP GUIDE
// ══════════════════════════════════════════════════════════════════
// 1. Create 4 Google Sheets (1 master + 3 branch sheets)
//    - Each sheet must be in the SAME Google Account as this script
// 2. Copy each Sheet's ID from its URL:
//    URL pattern: docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
// 3. Paste the IDs into the constants below
// 4. In Apps Script editor → Run → firstTimeSetup()
//    → Accept all permission dialogs that appear
// 5. Run setupTriggers() ONCE (creates 4 daily auto-triggers)
// 6. Deploy → New Deployment → Web App
//    → Execute as: Me
//    → Who has access: Anyone
// 7. Copy the /exec URL → paste into both HTML files where prompted
// 8. Open owner panel → login → click "Fix All Branches" to verify
// ══════════════════════════════════════════════════════════════════

// ── CONFIGURATION ────────────────────────────────────────────────
// REPLACE THESE 4 VALUES WITH YOUR ACTUAL SHEET IDs
// The master sheet stores the branch registry (list of all branches)
const MASTER_SHEET_ID = "MASTER_SHEET_ID_HERE";

// Owner login password — change before production
const OWNER_PASSWORD = "harsha@greensalon2026";

// Pre-configured branch IDs → their Google Sheet IDs
// These are the 3 default branches. More branches can be added via owner panel.
const BRANCH_SHEETS = {
  "branch1": "BRANCH1_SHEET_ID_HERE",  // JC Nagar branch sheet
  "branch2": "BRANCH2_SHEET_ID_HERE",  // Koramangala branch sheet
  "branch3": "BRANCH3_SHEET_ID_HERE",  // Indiranagar branch sheet
};

// Multi-admin accounts — add more admins here as needed
// role: "owner" = full access | "manager" = read + limited write
const ADMIN_ACCOUNTS = [
  { id: "admin1", name: "Harsha",  password: "harsha@greensalon2026", role: "owner"   },
  { id: "admin2", name: "Manager", password: "manager@green2026",      role: "manager" },
];

// Sheet color palette — used when formatting headers
const C_DARK  = "#1a5c38";  // Dark green — branch header row
const C_MED   = "#2d8653";  // Medium green — monthly column headers
const C_WHITE = "#ffffff";  // White text
const C_ALT   = "#e8f5ee";  // Alternating row tint in monthly sheet
const C_RAW   = "#0f172a";  // Near-black — used for data tabs (Entries, Staff…)

// ── HTTP ROUTER (POST) ────────────────────────────────────────────
// Apps Script calls doPost() for every POST request to the /exec URL.
// We parse the JSON body, read the "action" field, and dispatch.
// All responses are wrapped in R() (success) or E() (error).
function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents); // parse raw JSON body
    switch (d.action) {
      // ── AUTH
      case "ownerLogin":       return R(ownerLogin(d));
      case "adminLogin":       return R(adminLogin(d));
      // ── BRANCHES
      case "getBranches":      return R(getBranches());
      case "addBranch":        return R(addBranch(d));
      case "removeBranch":     return R(removeBranch(d));
      case "recoverBranch":    return R(recoverBranch(d));
      case "renameBranch":     return R(renameBranch(d));
      // ── STAFF
      case "getStaffAdmin":    return R(getStaffAdmin(d));
      case "addStaff":         return R(addStaff(d));
      case "removeStaff":      return R(removeStaff(d));
      case "renameStaff":      return R(renameStaff(d));
      case "updateStaffComm":  return R(updateStaffComm(d));
      // ── MENU
      case "updateServices":   return R(updateServices(d));
      case "updateProducts":   return R(updateProducts(d));
      // ── ENTRY SUBMISSION
      case "submitEntry":      return R(submitEntry(d));    // service
      case "submitProduct":    return R(submitProduct(d));  // product sale
      case "submitExpense":    return R(submitExpense(d));  // expense
      // ── READS
      case "getMyEntries":     return R(getMyEntries(d));
      case "getTodayAll":      return R(getTodayAll(d));
      case "getBranchSummary": return R(getBranchSummary(d));
      case "getMonthSummary":  return R(getMonthSummary(d));
      // ── SOFT DELETE (flagged=true, data preserved)
      case "deleteEntry":      return R(deleteEntry(d));
      case "deleteProduct":    return R(deleteProduct(d));
      case "deleteExpense":    return R(deleteExpense(d));
      // ── HARD DELETE (actual row removal, logged to AdminLog)
      case "hardDeleteEntry":  return R(hardDeleteEntry(d));
      // ── REPORTS / COMPLAINTS
      case "submitReport":     return R(submitReport(d));
      case "getReports":       return R(getReports(d));
      case "resolveReport":    return R(resolveReport(d));
      // ── EMAILS
      case "setReportEmails":  return R(setReportEmails(d));
      case "getReportEmails":  return R(getReportEmails(d));
      case "sendManualReport": return R(sendManualReport(d));
      // ── ADMIN AUDIT LOG
      case "logAdminAction":   return R(logAdminAction(d));
      case "getAdminLog":      return R(getAdminLog(d));
      // ── RECOVERY / MAINTENANCE
      case "fixBranch":        return R(fixBranch(d));     // fix one branch
      case "masterFix":        return R(masterFix(d));     // fix all branches at once
      // ── POLLING — staff app polls this to detect owner changes
      case "getLastUpdate":    return R(getLastUpdate(d));
      default: return E("Unknown action: " + d.action);
    }
  } catch (ex) {
    return E(ex.message); // catch any unhandled exception and return error JSON
  }
}

// ── HTTP ROUTER (GET) ─────────────────────────────────────────────
// Staff app uses GET requests (with ?action=&branchId= params) for
// lightweight reads. This avoids CORS preflight overhead on mobile.
function doGet(e) {
  try {
    const a   = e.parameter.action;    // action name from URL param
    const bid = e.parameter.branchId;  // branch ID from URL param
    switch (a) {
      case "getStaff":      return R(getStaff(bid));
      case "getServices":   return R(getServices(bid));
      case "getProducts":   return R(getProducts(bid));
      case "getBranches":   return R(getBranches());
      case "getLastUpdate": return R(getLastUpdate({ branchId: bid }));
      default: return E("Unknown action: " + a);
    }
  } catch (ex) {
    return E(ex.message);
  }
}

// ── RESPONSE HELPERS ─────────────────────────────────────────────
// R() wraps any data object into a standardised success JSON response.
// Spread operator merges {success:true} with the data object.
function R(d) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: true, ...d }))
    .setMimeType(ContentService.MimeType.JSON);
}

// E() wraps an error message into a standardised failure JSON response.
function E(m) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: false, error: m }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── SHEET HELPERS ─────────────────────────────────────────────────
// masterTab() — opens the master spreadsheet and gets (or creates) a tab by name.
// The master sheet holds: Branches, Settings, AdminLog.
function masterTab(name) {
  const ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

// branchSS() — opens a branch's spreadsheet.
// First tries the hardcoded BRANCH_SHEETS constant (fast path).
// Falls back to reading the Branches tab in master sheet (supports dynamically added branches).
function branchSS(branchId) {
  const sid = BRANCH_SHEETS[branchId];
  // If hardcoded ID exists and is not the placeholder, use it directly
  if (sid && !sid.includes("_SHEET_ID_HERE")) {
    return SpreadsheetApp.openById(sid);
  }
  // Fall back: look up the sheet ID from the Branches registry tab
  const rows = masterTab("Branches").getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === branchId && rows[i][4] !== false && rows[i][4] !== "FALSE") {
      return SpreadsheetApp.openById(rows[i][3]);
    }
  }
  throw new Error("Branch not found: " + branchId);
}

// branchTab() — gets (or creates) a specific tab in a branch spreadsheet.
function branchTab(branchId, tabName) {
  const ss = branchSS(branchId);
  return ss.getSheetByName(tabName) || ss.insertSheet(tabName);
}

// getExistingTab() — gets a tab only if it already exists (returns null if missing).
// Used for reads where we don't want to auto-create the tab.
function getExistingTab(branchId, tabName) {
  return branchSS(branchId).getSheetByName(tabName);
}

// ── DATE/TIME HELPERS ────────────────────────────────────────────
// All timestamps are in IST (India Standard Time, UTC+5:30).

// todayStr() — returns today's date as dd-MM-yyyy (the key used in all sheets)
function todayStr() {
  return Utilities.formatDate(new Date(), "Asia/Kolkata", "dd-MM-yyyy");
}

// nowIST() — returns current date+time as human-readable string for audit logs
function nowIST() {
  return Utilities.formatDate(new Date(), "Asia/Kolkata", "dd-MMM-yyyy HH:mm:ss");
}

// monthName() — returns e.g. "May 2026" — used as the tab name for monthly sheets
function monthName() {
  const ist = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][ist.getMonth()]
         + " " + ist.getFullYear();
}

// hdrStyle() — applies bold center-aligned formatting to a range (used for header rows)
function hdrStyle(rng, bg, fg) {
  rng.setBackground(bg).setFontColor(fg).setFontWeight("bold").setHorizontalAlignment("center");
}

// branchDisplayName() — reads the friendly name of a branch from the master registry
function branchDisplayName(branchId) {
  try {
    const rows = masterTab("Branches").getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === branchId) return rows[i][1];
    }
  } catch (ex) {}
  return "Green Salon"; // fallback if registry read fails
}

// ── LAST-UPDATE POLLING ───────────────────────────────────────────
// The staff app polls getLastUpdate() every 30 seconds.
// When the owner changes services/staff/products, touchLastUpdate() is called,
// which writes the current timestamp into a "_meta" tab on the branch sheet.
// If the staff app sees a new timestamp, it auto-reloads services/staff.

// touchLastUpdate() — writes current IST timestamp to the branch's _meta tab.
// Called whenever owner makes a change that should be visible to staff app.
function touchLastUpdate(branchId) {
  try {
    const sh  = branchTab(branchId, "_meta"); // auto-creates if missing
    const rows = sh.getLastRow() > 0 ? sh.getDataRange().getValues() : [];
    const ts  = nowIST();
    let found = false;
    // Update existing "lastUpdate" row if it exists
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === "lastUpdate") {
        sh.getRange(i + 1, 2).setValue(ts);
        found = true;
        break;
      }
    }
    // Otherwise append a new row
    if (!found) sh.appendRow(["lastUpdate", ts]);
  } catch (ex) {
    Logger.log("touchLastUpdate: " + ex.message);
  }
}

// getLastUpdate() — returns the timestamp string from the branch's _meta tab.
// Staff app sends { action:"getLastUpdate", branchId:"branch1" }
function getLastUpdate(d) {
  try {
    const sh = getExistingTab(d.branchId, "_meta");
    if (!sh) return { lastUpdate: "" }; // tab doesn't exist yet = no update
    const rows = sh.getDataRange().getValues();
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === "lastUpdate") return { lastUpdate: String(rows[i][1] || "") };
    }
  } catch (ex) {}
  return { lastUpdate: "" };
}

// ── FIRST TIME SETUP ──────────────────────────────────────────────
// Run this ONCE to create master tabs and initialize all branch sheets.
// Safe to run multiple times — it checks before inserting.
function firstTimeSetup() {
  // Create Branches registry tab with correct headers
  const bsh = masterTab("Branches");
  if (bsh.getLastRow() === 0) {
    bsh.appendRow(["BranchID","Name","Location","SheetID","Active","CreatedAt","DeletedAt"]);
    hdrStyle(bsh.getRange(1,1,1,7), C_RAW, C_WHITE);
  }

  // Create Settings tab (stores notification email addresses per branch)
  const set = masterTab("Settings");
  if (set.getLastRow() === 0) {
    set.appendRow(["BranchID","Email1","Email2","Email3","UpdatedAt"]);
    hdrStyle(set.getRange(1,1,1,5), C_RAW, C_WHITE);
  }

  // Create AdminLog tab (immutable audit trail of all admin actions)
  const al = masterTab("AdminLog");
  if (al.getLastRow() === 0) {
    al.appendRow(["Timestamp","AdminID","AdminName","BranchID","Action","Details"]);
    hdrStyle(al.getRange(1,1,1,6), C_RAW, C_WHITE);
  }

  // Define the 3 default branches
  const defs = [
    { id: "branch1", name: "JC Nagar",     loc: "JC Nagar"     },
    { id: "branch2", name: "Koramangala",   loc: "Koramangala"  },
    { id: "branch3", name: "Indiranagar",   loc: "Indiranagar"  },
  ];

  const existing = bsh.getDataRange().getValues().map(r => r[0]); // already-added IDs

  defs.forEach(b => {
    const sid = BRANCH_SHEETS[b.id];
    if (sid.includes("_SHEET_ID_HERE")) {
      Logger.log("⚠️  " + b.id + " — Sheet ID not set. Skip.");
      return; // skip branches whose sheet ID hasn't been configured yet
    }
    // Register branch in master sheet if not already there
    if (!existing.includes(b.id)) {
      bsh.appendRow([b.id, b.name, b.loc, sid, true, nowIST(), ""]);
    }
    // Initialize the branch's own spreadsheet with all required tabs
    try {
      initBranch(sid, b.name);
    } catch (ex) {
      Logger.log("❌ initBranch failed for " + b.name + ": " + ex.message);
    }
  });

  Logger.log("✅ firstTimeSetup complete. Now run setupTriggers(), then Deploy as Web App.");
}

// initBranch() — creates all required tabs inside a branch spreadsheet.
// Called by firstTimeSetup() for each branch, and also when a new branch is added.
function initBranch(sheetId, branchName) {
  const ss = SpreadsheetApp.openById(sheetId);

  // ── Staff tab: one row per staff member
  let st = ss.getSheetByName("Staff") || ss.insertSheet("Staff");
  if (st.getLastRow() === 0) {
    st.appendRow(["ID","Name","PIN","Commission%","HasCommission","PhotoURL","Active"]);
    hdrStyle(st.getRange(1,1,1,7), C_RAW, C_WHITE);
    // Seed 3 sample staff members so the app is usable immediately after setup
    st.appendRow(["S001","Staff 1","1111",40,true,"",true]);
    st.appendRow(["S002","Staff 2","2222",40,true,"",true]);
    st.appendRow(["S003","Staff 3","3333",35,true,"",true]);
  }

  // ── Services tab: services shown on staff app's service selection screen
  let sv = ss.getSheetByName("Services") || ss.insertSheet("Services");
  if (sv.getLastRow() === 0) {
    sv.appendRow(["ServiceName","Price","Active"]);
    hdrStyle(sv.getRange(1,1,1,3), C_RAW, C_WHITE);
    [["Haircut",150],["Shave",80],["Facial",300],["Hair Colour",500],
     ["Head Massage",100],["Beard Trim",60],["Threading",40],["Waxing",200]]
      .forEach(r => sv.appendRow([r[0], r[1], true]));
  }

  // ── Products tab: products shown on staff app's product sale screen
  let pd = ss.getSheetByName("Products") || ss.insertSheet("Products");
  if (pd.getLastRow() === 0) {
    pd.appendRow(["ProductName","Price","Active"]);
    hdrStyle(pd.getRange(1,1,1,3), C_RAW, C_WHITE);
    [["Shampoo",200],["Hair Oil",150],["Conditioner",180],["Hair Serum",250]]
      .forEach(r => pd.appendRow([r[0], r[1], true]));
  }

  // ── Entries tab: one row per service entry submitted by staff
  let en = ss.getSheetByName("Entries") || ss.insertSheet("Entries");
  if (en.getLastRow() === 0) {
    en.appendRow(["RowID","Timestamp","Date","StaffID","StaffName","Service",
                  "Amount","Tip","Payment","CommApplies","Flagged"]);
    hdrStyle(en.getRange(1,1,1,11), C_RAW, C_WHITE);
  }

  // ── ProductSales tab: one row per product sale
  let ps = ss.getSheetByName("ProductSales") || ss.insertSheet("ProductSales");
  if (ps.getLastRow() === 0) {
    ps.appendRow(["RowID","Timestamp","Date","StaffID","StaffName","Product",
                  "Amount","Payment","Flagged"]);
    hdrStyle(ps.getRange(1,1,1,9), C_RAW, C_WHITE);
  }

  // ── Expenses tab: one row per expense recorded
  let ex = ss.getSheetByName("Expenses") || ss.insertSheet("Expenses");
  if (ex.getLastRow() === 0) {
    ex.appendRow(["RowID","Timestamp","Date","StaffID","StaffName","Description",
                  "Amount","Payment","Flagged"]);
    hdrStyle(ex.getRange(1,1,1,9), C_RAW, C_WHITE);
  }

  // ── Reports tab: staff-submitted complaints about their own entries
  let rp = ss.getSheetByName("Reports") || ss.insertSheet("Reports");
  if (rp.getLastRow() === 0) {
    rp.appendRow(["ReportID","Timestamp","StaffID","StaffName","EntryRowID",
                  "EntryDetails","ReportType","Message","CorrectedValue",
                  "Status","ResolvedBy","ResolvedAt","ActionTaken"]);
    hdrStyle(rp.getRange(1,1,1,13), C_RAW, C_WHITE);
  }

  // ── Daily tab: intra-day working sheet — one column per staff, rows = entries
  buildDailyTab(ss, branchName);

  // ── Monthly tab: aggregated daily totals — tab name = "May 2026" etc.
  buildMonthlyTab(ss, branchName, monthName());

  Logger.log("✅ Branch initialized: " + branchName);
}

// ── AUTO-RECOVERY: fixBranch() ────────────────────────────────────
// Repairs a single branch's sheet structure.
// Adds missing tabs, fixes missing header rows, rebuilds Daily/Monthly if needed.
// Called from owner panel → Settings → "Fix This Branch"
function fixBranch(d) {
  const bid     = d.branchId;
  const ss      = branchSS(bid);
  const bn      = branchDisplayName(bid);
  const results = [];

  // Define all required tabs with their expected column headers
  const tabs = [
    { name: "Staff",        header: ["ID","Name","PIN","Commission%","HasCommission","PhotoURL","Active"] },
    { name: "Services",     header: ["ServiceName","Price","Active"] },
    { name: "Products",     header: ["ProductName","Price","Active"] },
    { name: "Entries",      header: ["RowID","Timestamp","Date","StaffID","StaffName","Service","Amount","Tip","Payment","CommApplies","Flagged"] },
    { name: "ProductSales", header: ["RowID","Timestamp","Date","StaffID","StaffName","Product","Amount","Payment","Flagged"] },
    { name: "Expenses",     header: ["RowID","Timestamp","Date","StaffID","StaffName","Description","Amount","Payment","Flagged"] },
    { name: "Reports",      header: ["ReportID","Timestamp","StaffID","StaffName","EntryRowID","EntryDetails","ReportType","Message","CorrectedValue","Status","ResolvedBy","ResolvedAt","ActionTaken"] },
  ];

  tabs.forEach(t => {
    let sh = ss.getSheetByName(t.name);
    if (!sh) {
      // Tab missing entirely — create it with headers
      sh = ss.insertSheet(t.name);
      sh.appendRow(t.header);
      hdrStyle(sh.getRange(1, 1, 1, t.header.length), C_RAW, C_WHITE);
      results.push("CREATED: " + t.name);
    } else if (sh.getLastRow() === 0) {
      // Tab exists but has no rows at all — add headers
      sh.appendRow(t.header);
      hdrStyle(sh.getRange(1, 1, 1, t.header.length), C_RAW, C_WHITE);
      results.push("HEADER ADDED: " + t.name);
    } else {
      // Tab exists and has data — check column count
      const ec = sh.getLastColumn();
      if (ec < t.header.length) {
        // Fewer columns than expected — add missing column headers
        for (let c = ec + 1; c <= t.header.length; c++) {
          sh.getRange(1, c).setValue(t.header[c - 1]);
        }
        hdrStyle(sh.getRange(1, 1, 1, t.header.length), C_RAW, C_WHITE);
        results.push("COLUMNS FIXED (" + ec + "→" + t.header.length + "): " + t.name);
      } else {
        results.push("OK: " + t.name);
      }
    }
  });

  // Fix or rebuild the Daily tab
  const staffNames = activeStaffNames(ss); // get current active staff list
  const daily = ss.getSheetByName("Daily");
  if (!daily || daily.getLastRow() === 0) {
    // Daily tab missing or empty — rebuild it from current staff list
    if (daily) ss.deleteSheet(daily); // delete the empty shell first
    buildDailyTab(ss, bn);
    results.push("REBUILT: Daily tab");
  } else {
    // Daily tab exists — check that all active staff have their columns
    const map     = dailyColMap(ss);
    const missing = staffNames.filter(n => !map[n] || !map[n].amt);
    if (missing.length) {
      missing.forEach(n => ensureStaffInDaily(ss, n));
      results.push("FIXED Daily: added columns for → " + missing.join(", "));
    } else {
      results.push("OK: Daily tab");
    }
  }

  // Fix or create Monthly tab for current month
  const tab = monthName();
  if (!ss.getSheetByName(tab)) {
    buildMonthlyTab(ss, bn, tab);
    results.push("CREATED: Monthly tab → " + tab);
  } else {
    results.push("OK: Monthly tab → " + tab);
  }

  touchLastUpdate(bid); // notify staff app that something changed
  return { fixed: true, details: results };
}

// masterFix() — runs fixBranch() on ALL active branches in one call.
// Called from owner panel → "Fix All Branches" button.
function masterFix(d) {
  const rows = masterTab("Branches").getDataRange().getValues();
  const allResults = {};
  rows.slice(1).forEach(row => {
    if (row[4] === false || row[4] === "FALSE") return; // skip deleted branches
    try {
      const r = fixBranch({ branchId: row[0] });
      allResults[String(row[1])] = r.details;
    } catch (ex) {
      allResults[String(row[1])] = ["ERROR: " + ex.message];
    }
  });
  return { fixed: true, results: allResults };
}

// ── DAILY TAB ─────────────────────────────────────────────────────
// The Daily tab is an intra-day working sheet.
// Structure: columns = [Staff1, Staff1 Tip, Staff1 Time, Staff2, ... Product, Product Time]
// Each row under the header = one entry (service or product)
// This tab is wiped at midnight by midnightReset() trigger.

// buildDailyTab() — creates a brand new Daily tab with staff columns + Product column
function buildDailyTab(ss, branchName) {
  let sh = ss.getSheetByName("Daily") || ss.insertSheet("Daily");
  if (sh.getLastRow() > 0) return sh; // already has data — don't overwrite

  const names   = activeStaffNames(ss); // read current staff from Staff tab
  const headers = [];
  // For each staff member, create 3 columns: Amount, Tip, Timestamp
  names.forEach(n => {
    headers.push(n);          // service revenue (suffixed C=Cash, P=Online)
    headers.push(n + " Tip"); // tip amount
    headers.push(n + " Time"); // timestamp of entry
  });
  headers.push("Product");      // product sale column
  headers.push("Product Time"); // timestamp of product sale

  sh.appendRow(headers);
  hdrStyle(sh.getRange(1, 1, 1, headers.length), C_DARK, C_WHITE);
  sh.setFrozenRows(1); // freeze header so it stays visible when scrolling

  // Set column widths: Time columns get wider, amount columns stay compact
  for (let c = 1; c <= headers.length; c++) {
    const h = String(sh.getRange(1, c).getValue());
    sh.setColumnWidth(c, h.endsWith(" Time") ? 190 : 70);
  }
  return sh;
}

// dailyColMap() — builds a map: staffName → { amt: colIndex, tip: colIndex, time: colIndex }
// Used to quickly find which column to write to when recording an entry.
function dailyColMap(ss) {
  const sh = ss.getSheetByName("Daily");
  if (!sh || sh.getLastRow() === 0) return {};
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const m = {};
  h.forEach((v, i) => {
    const s = String(v);
    if (!s) return;
    if (s.endsWith(" Time")) {
      const base = s.slice(0, -5); // e.g. "Staff 1 Time" → "Staff 1"
      if (!m[base]) m[base] = {};
      m[base].time = i + 1; // 1-based column index
    } else if (s.endsWith(" Tip")) {
      const base = s.slice(0, -4); // e.g. "Staff 1 Tip" → "Staff 1"
      if (!m[base]) m[base] = {};
      m[base].tip = i + 1;
    } else {
      if (!m[s]) m[s] = {};
      m[s].amt = i + 1; // main amount column
    }
  });
  return m;
}

// ensureStaffInDaily() — adds columns for a new staff member to Daily tab.
// Inserts BEFORE the Product column so layout stays consistent.
function ensureStaffInDaily(ss, name) {
  const sh = ss.getSheetByName("Daily");
  if (!sh) return;
  const map = dailyColMap(ss);
  if (map[name] && map[name].amt) return; // already exists

  const h  = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const pi = h.indexOf("Product"); // find the Product column position

  if (pi >= 0) {
    // Insert 3 new columns just before the Product column
    sh.insertColumnsBefore(pi + 1, 3);
    sh.getRange(1, pi + 1).setValue(name);
    sh.getRange(1, pi + 2).setValue(name + " Tip");
    sh.getRange(1, pi + 3).setValue(name + " Time");
    hdrStyle(sh.getRange(1, pi + 1, 1, 3), C_DARK, C_WHITE);
    sh.setColumnWidth(pi + 1, 70);
    sh.setColumnWidth(pi + 2, 70);
    sh.setColumnWidth(pi + 3, 190);
  } else {
    // Fallback: Product column not found, append at end
    const last = sh.getLastColumn();
    sh.getRange(1, last + 1).setValue(name);
    sh.getRange(1, last + 2).setValue(name + " Tip");
    sh.getRange(1, last + 3).setValue(name + " Time");
    hdrStyle(sh.getRange(1, last + 1, 1, 3), C_DARK, C_WHITE);
    sh.setColumnWidth(last + 1, 70);
    sh.setColumnWidth(last + 2, 70);
    sh.setColumnWidth(last + 3, 190);
  }
}

// writeDailyEntry() — writes one entry into the Daily tab.
// Finds the first empty cell in the staff's column and fills it.
// amtVal format: "150C" = ₹150 Cash, "300P" = ₹300 Online
function writeDailyEntry(ss, staffName, amount, tip, payment, isProduct) {
  const sh = ss.getSheetByName("Daily");
  if (!sh) { buildDailyTab(ss, ""); return; } // rebuild if somehow missing

  if (!isProduct) ensureStaffInDaily(ss, staffName); // add columns if new staff

  const map  = dailyColMap(ss);
  const key  = isProduct ? "Product" : staffName; // product entries go in Product col
  const info = map[key];
  if (!info || !info.amt) {
    Logger.log("writeDailyEntry: column missing for " + key);
    return;
  }

  // Encode payment mode into the value: C = Cash, P = Online/UPI
  const amtVal = amount + (payment === "Cash" ? "C" : "P");
  const ts     = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd-MMM-yyyy hh:mm:ss a");

  // Find the first empty row in this staff's amount column
  const lastRow = sh.getLastRow();
  let row = lastRow + 1; // default: append after last row
  if (lastRow > 1) {
    const colData = sh.getRange(2, info.amt, lastRow - 1, 1).getValues();
    for (let r = 0; r < colData.length; r++) {
      if (!colData[r][0]) { // empty cell found
        row = r + 2; // +2 because array is 0-based and sheet rows start at 1 (+ header row)
        break;
      }
    }
  }

  sh.getRange(row, info.amt).setValue(amtVal).setHorizontalAlignment("center");
  // Write tip only if non-zero and this is a service entry (not product)
  if (!isProduct && info.tip && tip > 0) {
    sh.getRange(row, info.tip).setValue(tip + (payment === "Cash" ? "C" : "P"))
      .setHorizontalAlignment("center");
  }
  if (info.time) sh.getRange(row, info.time).setValue(ts);
}

// ── MONTHLY TAB ───────────────────────────────────────────────────
// One tab per month, named "May 2026" etc.
// Structure: Row 1 = branch name (merged header), Row 2 = column headers,
// Rows 3+ = one row per day + a TOTAL row at the bottom.
// Columns: Date | Staff1 | Staff2 | ... | Extra(tips) | Total | Product | Expenses | Commission | Online | Cash | Difference

// buildMonthlyTab() — creates a new monthly tab (called when month rolls over)
function buildMonthlyTab(ss, branchName, tabName) {
  if (ss.getSheetByName(tabName)) return ss.getSheetByName(tabName); // already exists
  const sh      = ss.insertSheet(tabName);
  const names   = activeStaffNames(ss);
  const cols    = ["Date", ...names, "Extra", "Total", "Product", "Expenses",
                   "Commission", "Online", "Cash", "Difference"];
  const nc      = cols.length;

  // Row 1: branch name spanning all columns (decorative header)
  sh.getRange(1, 1, 1, nc).merge()
    .setValue(branchName)
    .setBackground(C_DARK).setFontColor(C_WHITE)
    .setFontWeight("bold").setFontSize(13)
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sh.setRowHeight(1, 36);

  // Row 2: column headers
  sh.getRange(2, 1, 1, nc).setValues([cols]);
  hdrStyle(sh.getRange(2, 1, 1, nc), C_MED, C_WHITE);
  sh.setRowHeight(2, 26);
  sh.setFrozenRows(2); // freeze both header rows

  // Column widths
  sh.setColumnWidth(1, 110);
  for (let c = 2; c <= nc; c++) sh.setColumnWidth(c, 90);

  return sh;
}

// monthColMap() — builds a map: columnName → 1-based column index for a monthly tab
function monthColMap(sh) {
  if (!sh || sh.getLastRow() < 2) return {};
  const h = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0]; // row 2 = headers
  const m = {};
  h.forEach((v, i) => { if (v) m[String(v)] = i + 1; });
  return m;
}

// ensureStaffInMonthly() — adds a column for a new staff member to a monthly tab.
// Inserted before the "Extra" column to keep the fixed columns at the right.
function ensureStaffInMonthly(sh, staffName, branchName) {
  const h = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  if (h.includes(staffName)) return; // already exists

  const ei = h.indexOf("Extra"); // insert before Extra column
  if (ei < 0) return; // safety: if Extra not found, skip

  sh.insertColumnBefore(ei + 1); // shift all columns right
  sh.getRange(2, ei + 1).setValue(staffName);
  hdrStyle(sh.getRange(2, ei + 1, 1, 1), C_MED, C_WHITE);
  sh.setColumnWidth(ei + 1, 90);

  // Re-merge the title row to cover the new column count
  const nc = sh.getLastColumn();
  sh.getRange(1, 1, 1, nc).merge()
    .setValue(branchName)
    .setBackground(C_DARK).setFontColor(C_WHITE)
    .setFontWeight("bold").setFontSize(13)
    .setHorizontalAlignment("center").setVerticalAlignment("middle");

  // Initialize the new column with 0 for all existing date rows
  for (let r = 3; r <= sh.getLastRow(); r++) {
    if (String(sh.getRange(r, 1).getValue()) !== "TOTAL") {
      sh.getRange(r, ei + 1).setValue(0);
    }
  }
}

// updateMonthly() — called after every entry submission to add values to today's row.
// Handles service, product, and expense entry types.
// Also calls recalcRow() and rebuildTotal() to keep totals accurate.
function updateMonthly(branchId, entryType, staffName, svcAmt, tipAmt, payment, prodAmt, expAmt) {
  const ss  = branchSS(branchId);
  const bn  = branchDisplayName(branchId);
  const tab = monthName();

  let sh = ss.getSheetByName(tab);
  if (!sh) sh = buildMonthlyTab(ss, bn, tab); // create this month's tab if missing

  // Ensure the staff member has a column in this monthly tab
  if (entryType === "service" && staffName && svcAmt > 0) {
    ensureStaffInMonthly(sh, staffName, bn);
  }

  const cm = monthColMap(sh); // column map for fast lookups
  const dt = todayStr();
  const nc = sh.getLastColumn();

  // Find today's row index (or create it)
  const allVals = sh.getLastRow() >= 3
    ? sh.getRange(3, 1, sh.getLastRow() - 2, 1).getValues()
    : [];
  let dr = -1; // today's data row index (-1 = not found yet)
  let tr = -1; // TOTAL row index (-1 = not found yet)
  allVals.forEach((row, idx) => {
    const v = String(row[0]).trim();
    const r = idx + 3; // actual sheet row number (1-based, offset for 2 header rows)
    if (v === dt) dr = r;
    if (v === "TOTAL") tr = r;
  });

  if (dr < 0) {
    // Today's row doesn't exist yet — create it
    const zeroRow = new Array(nc).fill(0);
    zeroRow[0] = dt; // set date in first column
    if (tr > 0) {
      // Insert BEFORE the TOTAL row to keep TOTAL last
      sh.insertRowBefore(tr);
      sh.getRange(tr, 1, 1, nc).setValues([zeroRow]);
      dr = tr; // today's row is now where TOTAL was (TOTAL shifted down)
    } else {
      sh.appendRow(zeroRow);
      dr = sh.getLastRow();
    }
    // Alternate row background color for readability
    const bg = dr % 2 === 0 ? "#ffffff" : C_ALT;
    sh.getRange(dr, 1, 1, nc).setBackground(bg).setHorizontalAlignment("center");
    sh.getRange(dr, 1).setHorizontalAlignment("left"); // date column left-aligned
  }

  // Helper: adds val to the cell at today's row for a given column key
  function addVal(colKey, val) {
    if (!colKey || !val || Number(val) <= 0) return;
    const col = cm[colKey];
    if (!col) return;
    const current = Number(sh.getRange(dr, col).getValue()) || 0;
    sh.getRange(dr, col).setValue(current + Number(val));
  }

  // Distribute the entry amounts to the correct columns
  if (entryType === "service") {
    if (svcAmt > 0) addVal(staffName, svcAmt);   // staff's revenue column
    if (tipAmt > 0) addVal("Extra", tipAmt);      // tips go to Extra column
    const money = (svcAmt || 0) + (tipAmt || 0);
    if (money > 0) addVal(payment === "Cash" ? "Cash" : "Online", money); // payment split
  } else if (entryType === "product") {
    if (prodAmt > 0) {
      addVal("Product", prodAmt);
      addVal(payment === "Cash" ? "Cash" : "Online", prodAmt);
    }
  } else if (entryType === "expense") {
    if (expAmt > 0) addVal("Expenses", expAmt);
  }

  recalcRow(sh, dr, cm, nc, branchId); // recompute Total, Commission, Difference
  rebuildTotal(sh, nc);                 // recompute the TOTAL row at bottom
}

// recalcRow() — recomputes the derived columns for a given row in the monthly tab.
// Derived columns: Total (sum of staff revenues), Commission (per-staff rates), Difference.
function recalcRow(sh, row, cm, nc, branchId) {
  // These column names are fixed/computed — not staff names
  const FIXED = new Set(["Date","Extra","Total","Product","Expenses",
                          "Commission","Online","Cash","Difference"]);
  const h = sh.getRange(2, 1, 1, nc).getValues()[0]; // column headers (row 2)

  // Build per-staff commission rate map from the Staff tab
  // This allows different commission % per staff member
  const commMap = {};
  if (branchId) {
    try {
      const ss    = branchSS(branchId);
      const sRows = ss.getSheetByName("Staff").getDataRange().getValues().slice(1);
      sRows.forEach(r => {
        if (r[6] !== false && r[6] !== "FALSE") { // only active staff
          commMap[String(r[1])] = {
            pct: Number(r[3]) || 0,             // commission percentage
            has: r[4] === true || r[4] === "TRUE" // whether commission applies
          };
        }
      });
    } catch (ex) {}
  }

  // Sum service revenue across all staff columns, and compute weighted commission
  let totalSvcRevenue = 0;
  let totalCommission = 0;
  h.forEach((v, i) => {
    if (!v || FIXED.has(String(v))) return; // skip fixed/computed columns
    const cellAmt  = Number(sh.getRange(row, i + 1).getValue()) || 0;
    totalSvcRevenue += cellAmt;
    const staffName = String(v);
    if (commMap[staffName]) {
      if (commMap[staffName].has) {
        totalCommission += cellAmt * (commMap[staffName].pct / 100); // e.g. 40% of ₹500
      }
      // else: fixed salary staff — no commission added
    } else {
      totalCommission += cellAmt * 0.40; // fallback: 40% if staff not in map
    }
  });

  if (cm["Total"])      sh.getRange(row, cm["Total"]).setValue(totalSvcRevenue);
  if (cm["Commission"]) sh.getRange(row, cm["Commission"]).setValue(Math.round(totalCommission));

  // Difference = Online + Cash - Total (should be 0 if payment modes balance)
  const onl = cm["Online"] ? (Number(sh.getRange(row, cm["Online"]).getValue()) || 0) : 0;
  const csh = cm["Cash"]   ? (Number(sh.getRange(row, cm["Cash"]).getValue())   || 0) : 0;
  if (cm["Difference"]) sh.getRange(row, cm["Difference"]).setValue(onl + csh - totalSvcRevenue);
}

// rebuildTotal() — recomputes the TOTAL row at the bottom of a monthly tab.
// Sums all data rows (everything above TOTAL that is not the headers).
function rebuildTotal(sh, nc) {
  const last = sh.getLastRow();
  let tr = -1;
  for (let r = 3; r <= last; r++) {
    if (String(sh.getRange(r, 1).getValue()) === "TOTAL") { tr = r; break; }
  }

  const sums  = new Array(nc).fill(0);
  const endR  = tr > 0 ? tr : last + 1; // sum rows 3 to (TOTAL row - 1)
  for (let r = 3; r < endR; r++) {
    const v = sh.getRange(r, 1, 1, nc).getValues()[0];
    for (let c = 1; c < nc; c++) sums[c] += Number(v[c]) || 0;
  }

  const totalRow = ["TOTAL", ...sums.slice(1)]; // col 0 = "TOTAL" label
  if (tr < 0) {
    sh.appendRow(totalRow); // append if TOTAL row doesn't exist
    tr = sh.getLastRow();
  } else {
    sh.getRange(tr, 1, 1, nc).setValues([totalRow]); // overwrite existing TOTAL row
  }
  hdrStyle(sh.getRange(tr, 1, 1, nc), C_DARK, C_WHITE);
  sh.getRange(tr, 1).setHorizontalAlignment("left");
}

// activeStaffNames() — returns array of names of all active (non-removed) staff
function activeStaffNames(ss) {
  const st = ss.getSheetByName("Staff");
  if (!st || st.getLastRow() < 2) return [];
  return st.getDataRange().getValues().slice(1)
    .filter(r => r[6] !== false && r[6] !== "FALSE") // filter out removed staff
    .map(r => String(r[1]));
}

// ── TIME-BASED TRIGGERS ───────────────────────────────────────────
// Run setupTriggers() ONCE after deployment to create 4 automatic daily jobs.

function setupTriggers() {
  // Remove any old triggers with the same handler names (prevents duplicates)
  ScriptApp.getProjectTriggers().forEach(t => {
    if (["midnightReset","checkMonthEnd","sendDailyReport","sendMonthlyReport"]
        .includes(t.getHandlerFunction())) {
      ScriptApp.deleteTrigger(t);
    }
  });

  // 11:55 PM IST — wipes the Daily tab (fresh start for next day)
  ScriptApp.newTrigger("midnightReset").timeBased().everyDays(1)
    .atHour(23).nearMinute(55).inTimezone("Asia/Kolkata").create();

  // 12:05 AM IST — creates next month's tab if month has just rolled over
  ScriptApp.newTrigger("checkMonthEnd").timeBased().everyDays(1)
    .atHour(0).nearMinute(5).inTimezone("Asia/Kolkata").create();

  // 11:00 PM IST — emails CSV report for today to saved email addresses
  ScriptApp.newTrigger("sendDailyReport").timeBased().everyDays(1)
    .atHour(23).nearMinute(0).inTimezone("Asia/Kolkata").create();

  // 10:55 PM IST — emails monthly CSV report on the last day of the month
  ScriptApp.newTrigger("sendMonthlyReport").timeBased().everyDays(1)
    .atHour(22).nearMinute(55).inTimezone("Asia/Kolkata").create();

  Logger.log("✅ 4 triggers set.");
}

// midnightReset() — deletes all data rows from every branch's Daily tab at end of day.
// Headers are preserved. Called automatically at 11:55 PM IST.
function midnightReset() {
  masterTab("Branches").getDataRange().getValues().slice(1).forEach(row => {
    if (row[4] === false || row[4] === "FALSE") return; // skip deleted branches
    try {
      const sh = SpreadsheetApp.openById(row[3]).getSheetByName("Daily");
      if (sh && sh.getLastRow() > 1) {
        sh.deleteRows(2, sh.getLastRow() - 1); // delete all rows except header row 1
      }
    } catch (ex) {
      Logger.log("midnightReset error for " + row[1] + ": " + ex.message);
    }
  });
}

// checkMonthEnd() — creates the next month's tab if it doesn't exist yet.
// Called at 12:05 AM on the 1st of each month (but safe to run any day).
function checkMonthEnd() {
  const tab = monthName();
  masterTab("Branches").getDataRange().getValues().slice(1).forEach(row => {
    if (row[4] === false || row[4] === "FALSE") return;
    try {
      const ss = SpreadsheetApp.openById(row[3]);
      if (!ss.getSheetByName(tab)) {
        buildMonthlyTab(ss, row[1], tab);
        Logger.log("✅ Monthly tab created: " + tab + " for " + row[1]);
      }
    } catch (ex) {
      Logger.log("checkMonthEnd error for " + row[1] + ": " + ex.message);
    }
  });
}

// ── AUTH ──────────────────────────────────────────────────────────

// ownerLogin() — simple password check for the primary owner account.
// Returns adminId and role on success.
function ownerLogin(d) {
  if (d.password !== OWNER_PASSWORD) throw new Error("Wrong password");
  return { ownerName: "Harsha", adminId: "admin1", role: "owner" };
}

// adminLogin() — multi-admin login. Matches name + password against ADMIN_ACCOUNTS.
function adminLogin(d) {
  const admin = ADMIN_ACCOUNTS.find(a => a.name === d.name && a.password === d.password);
  if (!admin) throw new Error("Invalid admin credentials");
  return { adminId: admin.id, adminName: admin.name, role: admin.role };
}

// ── ADMIN AUDIT LOG ───────────────────────────────────────────────
// Every admin action (adding staff, resolving reports, hard-deleting entries)
// is appended to the AdminLog tab in the master sheet. Immutable audit trail.

function logAdminAction(d) {
  masterTab("AdminLog").appendRow([
    nowIST(), d.adminId || "", d.adminName || "",
    d.branchId || "", d.action || "", d.details || ""
  ]);
  return { logged: true };
}

// getAdminLog() — returns full audit log as array of objects
function getAdminLog(d) {
  const rows    = masterTab("AdminLog").getDataRange().getValues();
  const headers = rows[0] || [];
  return { log: rows.slice(1).map(r => {
    const o = {};
    headers.forEach((k, i) => o[k] = r[i]);
    return o;
  })};
}

// ── BRANCHES ──────────────────────────────────────────────────────

// getBranches() — returns active and deleted branch lists
function getBranches() {
  const rows = masterTab("Branches").getDataRange().getValues();
  const all  = rows.slice(1).map(r => ({
    id:        r[0],
    name:      r[1],
    location:  r[2],
    sheetId:   r[3],
    active:    r[4] !== false && r[4] !== "FALSE",
    deletedAt: r[6] || ""
  }));
  return { branches: all.filter(b => b.active), deleted: all.filter(b => !b.active) };
}

// addBranch() — dynamically adds a new branch (paid feature, uncomment in UI)
function addBranch(d) {
  if (!d.name || !d.sheetId) throw new Error("Name and SheetID required");
  try { SpreadsheetApp.openById(d.sheetId); }
  catch (ex) { throw new Error("Cannot access Sheet — must be same Gmail account"); }
  const id = "branch" + Date.now();
  masterTab("Branches").appendRow([id, d.name, d.location || "", d.sheetId, true, nowIST(), ""]);
  initBranch(d.sheetId, d.name);
  return { branchId: id };
}

// removeBranch() — soft-delete (sets Active=false, records deletedAt timestamp)
function removeBranch(d) {
  const sh   = masterTab("Branches");
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === d.branchId) {
      sh.getRange(i + 1, 5).setValue(false);
      sh.getRange(i + 1, 7).setValue(nowIST());
      return {};
    }
  }
  throw new Error("Branch not found");
}

// recoverBranch() — restores a soft-deleted branch
function recoverBranch(d) {
  const sh   = masterTab("Branches");
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === d.branchId) {
      sh.getRange(i + 1, 5).setValue(true);
      sh.getRange(i + 1, 7).setValue("");
      return { name: rows[i][1] };
    }
  }
  throw new Error("Branch not found");
}

// renameBranch() — updates branch name in master registry + updates monthly tab header
function renameBranch(d) {
  if (!d.newName) throw new Error("New name required");
  const sh   = masterTab("Branches");
  const rows = sh.getDataRange().getValues();
  let oldName = "";
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === d.branchId) { oldName = rows[i][1]; sh.getRange(i + 1, 2).setValue(d.newName); break; }
  }
  // Also update the merged header in the monthly tab
  try {
    const ss  = branchSS(d.branchId);
    const msh = ss.getSheetByName(monthName());
    if (msh) {
      const nc = msh.getLastColumn();
      msh.getRange(1, 1, 1, nc).merge().setValue(d.newName)
        .setBackground(C_DARK).setFontColor(C_WHITE)
        .setFontWeight("bold").setFontSize(13)
        .setHorizontalAlignment("center").setVerticalAlignment("middle");
    }
  } catch (ex) { Logger.log("renameBranch header update: " + ex.message); }
  return { oldName, newName: d.newName };
}

// ── STAFF ─────────────────────────────────────────────────────────

// getStaff() — GET endpoint (used by staff app on load)
function getStaff(bid) { return { staff: _staffRows(bid) }; }

// getStaffAdmin() — POST endpoint (used by owner panel)
function getStaffAdmin(d) { return { staff: _staffRows(d.branchId) }; }

// _staffRows() — shared helper: reads active staff from Staff tab
function _staffRows(bid) {
  return branchTab(bid, "Staff").getDataRange().getValues().slice(1)
    .filter(r => r[6] !== false && r[6] !== "FALSE") // only active staff
    .map(r => ({
      id:            r[0],
      name:          r[1],
      pin:           r[2],
      photoUrl:      r[5] || "",
      hasCommission: r[4],
      commissionPct: Number(r[3]) || 0
    }));
}

// addStaff() — adds new staff member.
// Also adds columns in Daily + Monthly tabs immediately so data doesn't get lost.
// Returns full updated staff list so UI refreshes without extra fetch.
function addStaff(d) {
  const sh = branchTab(d.branchId, "Staff");
  const id = "S" + Date.now(); // unique ID based on timestamp
  sh.appendRow([id, d.name, d.pin || "0000", d.commissionPct || 0,
                d.hasCommission !== false, d.photoUrl || "", true]);

  const ss = branchSS(d.branchId);
  const bn = branchDisplayName(d.branchId);
  ensureStaffInDaily(ss, d.name);     // add columns in today's Daily tab
  const msh = ss.getSheetByName(monthName());
  if (msh) ensureStaffInMonthly(msh, d.name, bn); // add column in this month's tab

  touchLastUpdate(d.branchId); // notify staff app
  return { staffId: id, staff: _staffRows(d.branchId) }; // return updated list for instant UI
}

// removeStaff() — soft-delete staff (sets Active=false, data preserved)
function removeStaff(d) {
  const sh   = branchTab(d.branchId, "Staff");
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === d.staffId) {
      sh.getRange(i + 1, 7).setValue(false);
      touchLastUpdate(d.branchId);
      return { staff: _staffRows(d.branchId) };
    }
  }
  throw new Error("Staff not found");
}

// renameStaff() — renames a staff member.
// Also renames all their column headers in Daily and Monthly tabs.
// This prevents orphaned columns (v12 fix — v21 was missing this).
function renameStaff(d) {
  if (!d.newName) throw new Error("New name required");
  const sh   = branchTab(d.branchId, "Staff");
  const rows = sh.getDataRange().getValues();
  let oldName = "";

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === d.staffId) {
      oldName = rows[i][1];
      sh.getRange(i + 1, 2).setValue(d.newName);
      break;
    }
  }
  if (!oldName) throw new Error("Staff not found");

  const ss = branchSS(d.branchId);

  // Update column headers in Daily tab
  const daily = ss.getSheetByName("Daily");
  if (daily && daily.getLastRow() > 0) {
    const h = daily.getRange(1, 1, 1, daily.getLastColumn()).getValues()[0];
    h.forEach((v, i) => {
      const s = String(v);
      if (s === oldName)             daily.getRange(1, i + 1).setValue(d.newName);
      else if (s === oldName + " Tip")  daily.getRange(1, i + 1).setValue(d.newName + " Tip");
      else if (s === oldName + " Time") daily.getRange(1, i + 1).setValue(d.newName + " Time");
    });
  }

  // Update column header in Monthly tab
  const msh = ss.getSheetByName(monthName());
  if (msh && msh.getLastRow() > 1) {
    const h = msh.getRange(2, 1, 1, msh.getLastColumn()).getValues()[0];
    h.forEach((v, i) => {
      if (String(v) === oldName) msh.getRange(2, i + 1).setValue(d.newName);
    });
  }

  touchLastUpdate(d.branchId);
  return { oldName, newName: d.newName, staff: _staffRows(d.branchId) };
}

// updateStaffComm() — updates commission settings for a staff member
function updateStaffComm(d) {
  const sh   = branchTab(d.branchId, "Staff");
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === d.staffId) {
      sh.getRange(i + 1, 4).setValue(Number(d.commissionPct) || 0);
      sh.getRange(i + 1, 5).setValue(d.hasCommission === true || d.hasCommission === "true");
      return {};
    }
  }
  throw new Error("Staff not found");
}

// ── SERVICES & PRODUCTS ───────────────────────────────────────────

// getServices() — used by staff app to load service chips on entry screen
function getServices(bid) {
  return { services: branchTab(bid, "Services").getDataRange().getValues().slice(1)
    .filter(r => r[2] !== false && r[2] !== "FALSE")
    .map(r => ({ name: r[0], price: r[1] })) };
}

// updateServices() — replaces the entire service list (called from owner panel)
function updateServices(d) {
  const sh = branchTab(d.branchId, "Services");
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1); // clear existing
  if (d.services && d.services.length) {
    d.services.forEach(s => sh.appendRow([s.name, s.price, true]));
  }
  touchLastUpdate(d.branchId); // staff app will reload services on next poll
  return {};
}

// getProducts() — used by staff app to load product chips
function getProducts(bid) {
  return { products: branchTab(bid, "Products").getDataRange().getValues().slice(1)
    .filter(r => r[2] !== false && r[2] !== "FALSE")
    .map(r => ({ name: r[0], price: r[1] })) };
}

// updateProducts() — replaces the entire product list
function updateProducts(d) {
  const sh = branchTab(d.branchId, "Products");
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  if (d.products && d.products.length) {
    d.products.forEach(p => sh.appendRow([p.name, p.price, true]));
  }
  touchLastUpdate(d.branchId);
  return {};
}

// ── ENTRY SUBMISSION ──────────────────────────────────────────────
// All three submit functions follow the same pattern:
// 1. Validate required fields
// 2. Generate unique RowID with timestamp prefix (E/P/X + timestamp)
// 3. Append to the raw data tab (Entries / ProductSales / Expenses)
// 4. Write to Daily tab (for intraday view)
// 5. Update Monthly tab aggregates

// submitEntry() — records a service entry (staff → customer → amount)
function submitEntry(d) {
  const { branchId, staffId, staffName, service, amount, tip, paymentMethod } = d;
  if (!branchId || !staffName || !service || !paymentMethod) {
    throw new Error("Missing required fields: branchId, staffName, service, paymentMethod");
  }
  const amt  = Number(amount) || 0;
  const tip2 = Number(tip)    || 0;
  if (amt <= 0) throw new Error("Amount must be greater than 0");

  // Check if this staff member has commission enabled
  const sRows = branchTab(branchId, "Staff").getDataRange().getValues();
  let comm = true; // default: commission applies
  for (let i = 1; i < sRows.length; i++) {
    if (sRows[i][0] === staffId) { comm = sRows[i][4] === true || sRows[i][4] === "TRUE"; break; }
  }

  const rid = "E" + Date.now(); // unique entry ID, E prefix = service Entry
  const ts  = nowIST();
  const dt  = todayStr();

  // Write to Entries raw data tab
  branchTab(branchId, "Entries").appendRow([
    rid, ts, dt, String(staffId || ""), String(staffName),
    String(service), amt, tip2, String(paymentMethod), comm, false // Flagged=false
  ]);

  // Write to today's Daily tab
  writeDailyEntry(branchSS(branchId), staffName, amt, tip2, paymentMethod, false);

  // Update monthly aggregation
  updateMonthly(branchId, "service", staffName, amt, tip2, paymentMethod, 0, 0);

  return { rowId: rid, timestamp: ts };
}

// submitProduct() — records a product sale
function submitProduct(d) {
  const { branchId, staffId, staffName, product, amount, paymentMethod } = d;
  if (!branchId || !product || !paymentMethod) throw new Error("Missing required fields");
  const amt = Number(amount) || 0;
  if (amt <= 0) throw new Error("Amount must be greater than 0");

  const rid = "P" + Date.now(); // P prefix = Product sale
  const ts  = nowIST();
  const dt  = todayStr();

  branchTab(branchId, "ProductSales").appendRow([
    rid, ts, dt, String(staffId || "GLOBAL"), String(staffName || "Branch"),
    String(product), amt, String(paymentMethod), false
  ]);

  writeDailyEntry(branchSS(branchId), "Product", amt, 0, paymentMethod, true);
  updateMonthly(branchId, "product", "", 0, 0, paymentMethod, amt, 0);

  return { rowId: rid, timestamp: ts };
}

// submitExpense() — records a branch expense (e.g. supplies, electricity)
function submitExpense(d) {
  const { branchId, staffId, staffName, description, amount, paymentMethod } = d;
  if (!branchId || !description || !paymentMethod) throw new Error("Missing required fields");
  const amt = Number(amount) || 0;
  if (amt <= 0) throw new Error("Amount must be greater than 0");

  const rid = "X" + Date.now(); // X prefix = eXpense
  const ts  = nowIST();
  const dt  = todayStr();

  branchTab(branchId, "Expenses").appendRow([
    rid, ts, dt, String(staffId || "GLOBAL"), String(staffName || "Branch"),
    String(description), amt, String(paymentMethod), false
  ]);

  // Expenses don't go on the Daily tab but DO go to Monthly
  updateMonthly(branchId, "expense", "", 0, 0, paymentMethod, 0, amt);

  return { rowId: rid, timestamp: ts };
}

// ── GET ENTRIES ───────────────────────────────────────────────────

// getMyEntries() — returns today's entries for a specific staff member.
// Used by staff app's "My Log" screen to show what they've submitted today.
function getMyEntries(d) {
  const { branchId, staffId } = d;
  const dt    = todayStr();
  const eR    = branchTab(branchId, "Entries").getDataRange().getValues();
  const out   = [];
  let ta = 0, tt = 0;

  eR.slice(1).forEach(r => {
    // Match by staffId, today's date, not flagged (deleted)
    if (String(r[3]) === String(staffId) && String(r[2]) === dt
        && r[10] !== true && r[10] !== "TRUE") {
      out.push({ rowId: r[0], timestamp: r[1], service: r[5],
                 amount: r[6], tip: r[7], paymentMethod: r[8] });
      ta += Number(r[6]) || 0; // accumulate total amount
      tt += Number(r[7]) || 0; // accumulate total tips
    }
  });
  return { entries: out, totalAmount: ta, totalTip: tt };
}

// getBranchSummary() — returns quick totals for the branch summary card.
// Includes services + products in totalRevenue (v21 fix).
function getBranchSummary(d) {
  const bid = d.branchId;
  const dt  = todayStr();

  const eR = branchTab(bid, "Entries").getDataRange().getValues();
  let totalEntries = 0, totalRevenue = 0, totalTips = 0;
  eR.slice(1).forEach(r => {
    if (String(r[2]) === dt && r[10] !== true && r[10] !== "TRUE") {
      totalEntries++;
      totalRevenue += Number(r[6]) || 0;
      totalTips    += Number(r[7]) || 0;
    }
  });

  // Also count product sales in branch revenue
  const pR = branchTab(bid, "ProductSales").getDataRange().getValues();
  let totalProducts = 0;
  pR.slice(1).forEach(r => {
    if (String(r[2]) === dt && r[8] !== true && r[8] !== "TRUE") {
      totalProducts += Number(r[6]) || 0;
    }
  });
  totalRevenue += totalProducts; // products are part of total branch revenue

  return { totalEntries, totalRevenue, totalTips, totalProducts };
}

// getTodayAll() — returns all of today's entries, product sales, expenses, and staff totals.
// Used by owner panel's Today and Entries pages.
function getTodayAll(d) {
  const bid = d.branchId;
  const dt  = todayStr();

  // ── Service entries
  const eR      = branchTab(bid, "Entries").getDataRange().getValues();
  const entries = [];
  const sm      = {}; // staff totals map: staffName → aggregated stats

  eR.slice(1).forEach(r => {
    if (String(r[2]) !== dt) return; // filter for today only
    const fl = r[10] === true || r[10] === "TRUE"; // is entry flagged/deleted?
    entries.push({
      rowId: r[0], timestamp: r[1], staffId: r[3], staffName: r[4],
      service: r[5], amount: r[6], tip: r[7], paymentMethod: r[8],
      commissionApplies: r[9], flagged: fl
    });
    if (!fl) { // only count non-flagged entries in totals
      const sn = String(r[4]);
      if (!sm[sn]) sm[sn] = { name: sn, totalAmount: 0, totalTip: 0, entries: 0, products: 0 };
      sm[sn].totalAmount += Number(r[6]) || 0;
      sm[sn].totalTip    += Number(r[7]) || 0;
      sm[sn].entries++;
    }
  });

  // ── Product sales
  const pR = branchTab(bid, "ProductSales").getDataRange().getValues();
  const ps = [];
  let totalProductRevenue = 0;

  pR.slice(1).forEach(r => {
    if (String(r[2]) !== dt) return;
    const fl = r[8] === true || r[8] === "TRUE";
    ps.push({ rowId: r[0], timestamp: r[1], staffName: r[4],
              product: r[5], amount: r[6], paymentMethod: r[7], flagged: fl });
    if (!fl) {
      totalProductRevenue += Number(r[6]) || 0;
      const sn = String(r[4]);
      if (!sm[sn]) sm[sn] = { name: sn, totalAmount: 0, totalTip: 0, entries: 0, products: 0 };
      sm[sn].products += Number(r[6]) || 0;
    }
  });

  // ── Expenses
  const xR = branchTab(bid, "Expenses").getDataRange().getValues();
  const xs = [];
  let xe   = 0; // total expenses

  xR.slice(1).forEach(r => {
    if (String(r[2]) !== dt) return;
    const fl = r[8] === true || r[8] === "TRUE";
    xs.push({ rowId: r[0], timestamp: r[1], staffName: r[4],
              description: r[5], amount: r[6], paymentMethod: r[7], flagged: fl });
    if (!fl) xe += Number(r[6]) || 0;
  });

  return {
    entries, staffTotals: Object.values(sm),
    productSales: ps, expenses: xs, totalExp: xe, totalProductRevenue
  };
}

// getMonthSummary() — returns this month's aggregated rows for the Monthly page
function getMonthSummary(d) {
  const bid = d.branchId;
  const tab = monthName();
  const sh  = getExistingTab(bid, tab);
  if (!sh) return { summary: [], month: tab };
  const all = sh.getDataRange().getValues();
  if (all.length < 3) return { summary: [], month: tab };
  const headers = all[1]; // row 2 = column headers
  return {
    summary: all.slice(2).filter(r => r[0]).map(r => {
      const o = {};
      headers.forEach((k, i) => { o[String(k)] = r[i]; });
      return o;
    }),
    month: tab
  };
}

// ── DELETE ENTRIES (SOFT — FLAGGED) ──────────────────────────────
// Soft delete: sets the Flagged column to true.
// Data is preserved in the sheet but hidden from UI.

function deleteEntry(d) {
  const sh   = branchTab(d.branchId, "Entries");
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === d.rowId) { sh.getRange(i + 1, 11).setValue(true); return {}; }
  }
  throw new Error("Entry not found");
}

function deleteProduct(d) {
  const sh   = branchTab(d.branchId, "ProductSales");
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === d.rowId) { sh.getRange(i + 1, 9).setValue(true); return {}; }
  }
  throw new Error("Product sale not found");
}

function deleteExpense(d) {
  const sh   = branchTab(d.branchId, "Expenses");
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === d.rowId) { sh.getRange(i + 1, 9).setValue(true); return {}; }
  }
  throw new Error("Expense not found");
}

// hardDeleteEntry() — permanently deletes a row from Entries tab.
// ONLY for admin use. Logged to AdminLog for audit trail.
function hardDeleteEntry(d) {
  const { branchId, rowId, adminId, adminName, reason } = d;
  const sh   = branchTab(branchId, "Entries");
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === rowId) {
      const details = `Hard deleted: ${rows[i][5]} ₹${rows[i][6]} by ${rows[i][4]}. Reason: ${reason || "admin action"}`;
      sh.deleteRow(i + 1); // permanent physical row deletion
      masterTab("AdminLog").appendRow([nowIST(), adminId || "", adminName || "",
        branchId, "hardDeleteEntry", details]);
      return { deleted: true };
    }
  }
  throw new Error("Entry not found");
}

// ── REPORTS / COMPLAINTS ──────────────────────────────────────────
// Staff can file reports about their own entries directly from the staff app.
// Types: "duplicate" | "mis-click" | "custom"
// Owner sees these in the Reports page and can Resolve / Ignore them.

// submitReport() — called by staff app when staff taps "Report" on an entry
function submitReport(d) {
  const { branchId, staffId, staffName, entryRowId, entryDetails,
          reportType, message, correctedValue } = d;
  if (!branchId || !staffName || !reportType) throw new Error("Missing required fields");

  const rid = "R" + Date.now(); // R prefix = Report
  branchTab(branchId, "Reports").appendRow([
    rid, nowIST(), String(staffId || ""), String(staffName),
    String(entryRowId || ""), String(entryDetails || ""), String(reportType),
    String(message || ""), String(correctedValue || ""),
    "Pending", "", "", "" // Status=Pending, no resolver yet
  ]);
  return { reportId: rid, status: "Pending" };
}

// getReports() — returns reports, optionally filtered by status
function getReports(d) {
  const bid = d.branchId;
  const sh  = getExistingTab(bid, "Reports");
  if (!sh) return { reports: [] };
  const rows = sh.getDataRange().getValues();
  if (rows.length < 2) return { reports: [] };
  const headers = rows[0];

  let reports = rows.slice(1).filter(r => r[0]).map(r => {
    const o = {};
    headers.forEach((k, i) => { o[String(k)] = r[i]; });
    return o;
  });

  // Apply status filter if provided (handles "Resolved" prefix matching)
  const statusFilter = d.status && typeof d.status === "string" && d.status.trim();
  if (statusFilter) {
    if (statusFilter === "Resolved") {
      reports = reports.filter(r => String(r["Status"] || "").startsWith("Resolved"));
    } else {
      reports = reports.filter(r => r["Status"] === statusFilter);
    }
  }
  return { reports };
}

// resolveReport() — owner takes action on a report
// action: "delete_entry" | "mark_valid" | "corrected" | "ignored"
function resolveReport(d) {
  const { branchId, reportId, action, adminId, adminName, note } = d;
  if (!reportId || !action) throw new Error("reportId and action required");

  const sh   = branchTab(branchId, "Reports");
  const rows = sh.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === reportId) {
      const statusMap = {
        "delete_entry": "Resolved - Deleted",
        "mark_valid":   "Resolved - Valid",
        "corrected":    "Resolved - Corrected",
        "ignored":      "Ignored"
      };
      sh.getRange(i + 1, 10).setValue(statusMap[action] || "Resolved");  // Status
      sh.getRange(i + 1, 11).setValue(adminName || adminId || "Admin");   // ResolvedBy
      sh.getRange(i + 1, 12).setValue(nowIST());                          // ResolvedAt
      sh.getRange(i + 1, 13).setValue(note || action);                    // ActionTaken

      // If action = delete the entry, soft-flag it
      if (action === "delete_entry" && rows[i][4]) {
        try { deleteEntry({ branchId, rowId: rows[i][4] }); }
        catch (ex) { Logger.log("resolveReport delete_entry: " + ex.message); }
      }

      // Log resolution to AdminLog
      masterTab("AdminLog").appendRow([
        nowIST(), adminId || "", adminName || "", branchId,
        "resolveReport", `Report ${reportId} → ${action}: ${note || ""}`
      ]);
      return { resolved: true, action };
    }
  }
  throw new Error("Report not found");
}

// ── EMAIL SETTINGS ────────────────────────────────────────────────

// setReportEmails() — saves up to 3 email addresses for a branch
function setReportEmails(d) {
  const sh     = masterTab("Settings");
  const rows   = sh.getDataRange().getValues();
  const emails = d.emails || [];
  // Update existing row if branch already has settings
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === d.branchId) {
      sh.getRange(i + 1, 2).setValue(emails[0] || "");
      sh.getRange(i + 1, 3).setValue(emails[1] || "");
      sh.getRange(i + 1, 4).setValue(emails[2] || "");
      sh.getRange(i + 1, 5).setValue(nowIST());
      return {};
    }
  }
  // Insert new row for this branch
  sh.appendRow([d.branchId, emails[0] || "", emails[1] || "", emails[2] || "", nowIST()]);
  return {};
}

// getReportEmails() — reads saved email addresses for a branch
function getReportEmails(d) {
  const rows = masterTab("Settings").getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === d.branchId) {
      return { emails: [rows[i][1] || "", rows[i][2] || "", rows[i][3] || ""].filter(Boolean) };
    }
  }
  return { emails: [] };
}

// getBranchEmails() — internal helper used by report sending functions
function getBranchEmails(branchId) {
  const rows = masterTab("Settings").getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === branchId) return [rows[i][1], rows[i][2], rows[i][3]].filter(Boolean);
  }
  return [];
}

// ── EMAIL REPORTS ─────────────────────────────────────────────────

// getSheetAsCSV() — reads a tab and returns its content as CSV string.
// Used for email attachments.
function getSheetAsCSV(sheetId, sheetName) {
  try {
    const ss = SpreadsheetApp.openById(sheetId);
    const sh = ss.getSheetByName(sheetName);
    if (!sh || sh.getLastRow() < 1) return "";
    return sh.getDataRange().getValues().map(row =>
      row.map(cell => {
        const s = String(cell).replace(/"/g, '""'); // escape double-quotes
        return s.includes(",") || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
      }).join(",")
    ).join("\n");
  } catch (ex) { return ""; }
}

// sendDailyReport() — trigger handler: sends daily CSV reports to all branches with emails
function sendDailyReport() {
  masterTab("Branches").getDataRange().getValues().slice(1).forEach(row => {
    if (row[4] === false || row[4] === "FALSE") return;
    const emails = getBranchEmails(row[0]);
    if (!emails.length) return;
    try { _sendDailyCSV(row[0], row[1], row[3], emails); }
    catch (ex) { Logger.log("sendDailyReport error for " + row[1] + ": " + ex.message); }
  });
}

// _sendDailyCSV() — builds and sends the daily CSV email with 4 attachment tabs
function _sendDailyCSV(bid, bname, sheetId, emails) {
  const dt          = todayStr();
  const dtFile      = dt.replace(/-/g, ""); // filename-safe date
  const attachments = [];

  // Attach 4 CSVs: Entries, ProductSales, Expenses, Daily
  ["Entries", "ProductSales", "Expenses", "Daily"].forEach(tab => {
    const csv = getSheetAsCSV(sheetId, tab);
    if (csv) attachments.push(Utilities.newBlob(csv, "text/csv", tab + "_" + dtFile + ".csv"));
  });

  const body = `Hello,\n\nPlease find attached the daily report for ${bname}.\nDate: ${dt}\n\nRegards,\nGreen Salon Management System`;

  emails.forEach(email => {
    try {
      MailApp.sendEmail({
        to:          email,
        subject:     `Green Salon — ${bname} — Daily Report — ${dt}`,
        body,
        attachments
      });
    } catch (ex) { Logger.log("Email send error for " + email + ": " + ex.message); }
  });
}

// sendMonthlyReport() — trigger handler: sends monthly CSV on the last day of the month
function sendMonthlyReport() {
  const now     = new Date();
  const ist     = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const lastDay = new Date(ist.getFullYear(), ist.getMonth() + 1, 0).getDate();
  if (ist.getDate() !== lastDay) return; // only send on the actual last day

  masterTab("Branches").getDataRange().getValues().slice(1).forEach(row => {
    if (row[4] === false || row[4] === "FALSE") return;
    const emails = getBranchEmails(row[0]);
    if (!emails.length) return;
    try { _sendMonthlyCSV(row[0], row[1], row[3], emails); }
    catch (ex) { Logger.log("sendMonthlyReport error for " + row[1] + ": " + ex.message); }
  });
}

// _sendMonthlyCSV() — sends the current month's tab as a CSV email
function _sendMonthlyCSV(bid, bname, sheetId, emails) {
  const tab = monthName();
  const csv = getSheetAsCSV(sheetId, tab);
  if (!csv) return;
  const ist  = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const ym   = ist.getFullYear() + "-" + String(ist.getMonth() + 1).padStart(2, "0");
  const blob = Utilities.newBlob(csv, "text/csv", "Monthly_Report_" + ym + ".csv");
  const body = `Hello,\n\nMonthly report for ${bname}.\nMonth: ${tab}\n\nRegards,\nGreen Salon Management System`;

  emails.forEach(email => {
    try {
      MailApp.sendEmail({ to: email, subject: `Green Salon — ${bname} — Monthly Report — ${tab}`, body, attachments: [blob] });
    } catch (ex) { Logger.log("Monthly email error for " + email + ": " + ex.message); }
  });
}

// sendManualReport() — called from owner panel "Send Report Now" button
function sendManualReport(d) {
  const emails = getBranchEmails(d.branchId);
  if (!emails.length) throw new Error("No emails saved. Go to Settings → Emails.");

  const bname = branchDisplayName(d.branchId);
  const rows  = masterTab("Branches").getDataRange().getValues();
  let sheetId = "";
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === d.branchId) { sheetId = rows[i][3]; break; }
  }
  if (!sheetId) throw new Error("Branch sheet not found");

  if (d.type === "monthly") _sendMonthlyCSV(d.branchId, bname, sheetId, emails);
  else                      _sendDailyCSV(d.branchId, bname, sheetId, emails);

  return { sent: emails.length, recipients: emails };
}
