/**
 * 監控頁上把「路由 / server action 名稱」翻成人看得懂的中文。
 *
 * 新增頁面或 server action 時要順手在這裡加一行 —
 * lib/__tests__/monitor-labels.test.ts 會掃 app/ 底下所有 page.tsx 與 'use server' 檔,
 * 漏加就測試失敗(不會影響紀錄本身,只是監控頁會顯示原始名稱)。
 */

export const ROUTE_LABELS: Record<string, string> = {
  "/": "首頁（自動導向）",
  "/dashboard": "儀表板",
  "/cases": "案件總覽",
  "/cases/new": "新增案件",
  "/cases/[id]": "案件詳情",
  "/cases/[id]/edit": "編輯案件",
  "/cases/[id]/import": "匯入標單",
  "/logs": "日誌列表",
  "/logs/new": "寫施工日誌",
  "/logs/[id]": "日誌詳情",
  "/logs/[id]/edit": "修改日誌",
  "/approvals": "待簽核清單",
  "/approvals/[id]": "簽核頁",
  "/approvals/history": "我簽過的",
  "/attendance": "打卡",
  "/field-reports": "現場回報列表",
  "/field-reports/new": "新增現場回報",
  "/field-reports/[id]": "現場回報詳情",
  "/leaves": "請假",
  "/leaves/new": "申請請假",
  "/leaves/[id]": "假單詳情",
  "/messages": "消息",
  "/my-cases": "我的案場",
  "/account": "我的帳號",
  "/staff": "人員管理",
  "/reports": "報表首頁",
  "/reports/attendance": "出勤明細報表",
  "/reports/today-attendance": "今日打卡儀表板",
  "/reports/cases-overview": "案件進度總覽",
  "/reports/work-items": "工項累計報表",
  "/reports/unsigned": "超工／未簽約報表",
  "/reports/sign-delays": "簽核延遲分析",
  "/reports/logins": "登入紀錄",
  "/reports/audit": "操作紀錄（資料異動）",
  "/reports/regen-pdfs": "PDF 批次重產",
  "/system": "系統監控",
  "/system/usage": "常用操作",
  "/system/slow": "慢請求",
  "/system/errors": "錯誤紀錄",
  "/payroll": "薪資",
  "/payroll/settings": "薪資規則設定",
  "/payroll/holidays": "假日行事曆",
  "/schedule": "排班表",
  "/schedule/templates": "班別範本",
  "/reports/work-hours": "工時對帳",
};

/** server action export 名稱 → 中文。名稱來自 Next 的 server-reference manifest(exportedName)。 */
export const ACTION_LABELS: Record<string, string> = {
  // 帳號
  loginAction: "登入",
  logoutAction: "登出",
  changePasswordAction: "修改自己的密碼",
  generateLineBindingCodeAction: "產生 LINE 綁定碼",
  setLineNotificationsAction: "設定自己的 LINE 通知",
  unbindLineAction: "解除 LINE 綁定",
  // 施工日誌
  saveLogAction: "儲存／送出施工日誌",
  deleteLogAction: "刪除日誌",
  loadCaseFormDataAction: "日誌表單切換案場",
  uploadPhotoAction: "上傳照片",
  deletePhotoAction: "刪除照片",
  refreshPhotoUrlsAction: "更新照片連結",
  uploadSignatureAction: "上傳手寫簽名",
  stampSignatureAction: "用圖章簽名",
  uploadSignatureStampAction: "上傳簽名圖章",
  deleteSignatureStampAction: "刪除簽名圖章",
  getPdfDownloadUrlAction: "下載日誌 PDF",
  regeneratePdfAction: "重新產生日誌 PDF",
  bulkDownloadPdfsAction: "批次下載日誌 PDF",
  // 簽核
  approveStageAction: "簽核通過",
  rejectStageAction: "簽核退回",
  batchApproveAction: "批次簽核",
  endorseLogAction: "審閱加簽",
  revokeApprovalAction: "撤回核定",
  forceRejectStuckLogAction: "強制退回卡住的日誌",
  forceDeleteStuckLogAction: "強制刪除卡住的日誌",
  nextPendingRedirect: "前往下一份待簽",
  getPendingCount: "查詢剩餘待簽數",
  // 打卡 / 回報 / 請假
  clockAction: "打卡",
  backfillAttendanceAction: "補登打卡",
  exportAttendanceXlsx: "下載出勤 Excel",
  createFieldReportAction: "送出現場回報",
  updateFieldReportAction: "修改現場回報",
  deleteFieldReportAction: "刪除現場回報",
  archiveFieldReportAction: "封存現場回報",
  submitLeaveAction: "送出請假",
  approveLeaveAction: "核准請假",
  rejectLeaveAction: "退回請假",
  cancelLeaveAction: "取消請假",
  updateLeaveProxyAction: "更換請假代理人",
  // 案件 / 工項 / 合約
  createCaseAction: "新增案件",
  updateCaseAction: "修改案件資料",
  deleteCaseAction: "刪除案件",
  setCaseStatusAction: "變更案件狀態",
  getCloseChecklistAction: "結案前檢查",
  confirmImportAction: "確認匯入標單",
  redirectAfterImport: "匯入完成後回到案件頁",
  undoImportAction: "撤銷標單匯入",
  createWorkItemAction: "新增工項",
  updateWorkItemAction: "修改工項",
  deleteWorkItemAction: "刪除工項",
  createExtraOrUnsignedAction: "新增合約外／未簽約項目",
  markUnsignedAsSignedAction: "未簽約項目標記已簽約",
  createExtraContractAction: "新增追加合約",
  updateExtraContractAction: "修改追加合約",
  unbundleExtraContractAction: "拆開追加合約",
  getCaseWorkItemsXlsxAction: "下載案件工項 Excel",
  getCaseMonthlyReportXlsxAction: "下載案件月報 Excel",
  getCrossCaseSummaryXlsxAction: "下載跨案彙總 Excel",
  // 儀表板 / 消息
  dismissDashboardAlertAction: "儀表板警示「先不理」",
  restoreDashboardAlertsAction: "恢復儀表板警示",
  markMessageReadAction: "消息標為已讀",
  markAllMessagesReadAction: "消息全部標為已讀",
  // 人員 / 維運
  createStaffAction: "新增人員帳號",
  updateStaffAction: "修改人員資料",
  resetPasswordAction: "重設人員密碼",
  toggleActiveAction: "停用／啟用帳號",
  setNotificationPrefsAction: "設定人員通知",
  listRegenTargetsAction: "列出待重產的 PDF",
  regenerateOnePdfAction: "重產單份 PDF",
  // 人事 / 薪資(Phase A)
  savePayrollSettingAction: "儲存薪資規則",
  savePayProfileAction: "設定人員薪制",
  setPayrollAccessAction: "授權助理處理薪資",
  saveHolidayAction: "新增／修改假日",
  deleteHolidayAction: "移除假日",
  // 排班(Phase B)
  saveShiftTemplateAction: "新增／修改班別",
  setShiftTemplateActiveAction: "停用／啟用班別",
  setDayScheduleAction: "排某人某天的班",
  fillWeekScheduleAction: "快速排班(整週)",
  copyWeekScheduleAction: "複製上週班表",
  toggleDayOffAction: "標／取消排休",
  exportWorkHoursXlsxAction: "下載工時對帳 Excel",
};

/**
 * 使用者沒有「主動按」的背景動作 — 常用操作排行預設不列(會把真正的操作擠下去),
 * 慢請求與錯誤紀錄照常列入。
 */
export const BACKGROUND_ACTIONS = new Set<string>([
  "refreshPhotoUrlsAction",
  "getPendingCount",
  "nextPendingRedirect",
  "loadCaseFormDataAction",
  "listRegenTargetsAction",
  "redirectAfterImport",
]);

export function routeLabel(route: string | null | undefined): string {
  if (!route) return "（未知頁面）";
  return ROUTE_LABELS[route] ?? route;
}

export function actionLabel(name: string | null | undefined): string {
  if (!name) return "（未知操作）";
  return ACTION_LABELS[name] ?? name;
}

export const ROLE_LABEL: Record<string, string> = {
  owner: "老闆",
  reviewer: "審閱人",
  office_staff: "辦公室助理",
  site_supervisor: "工地主任",
  field_assistant: "現場人員",
};
