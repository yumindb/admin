export type UserRole =
  | "office_staff"
  | "site_supervisor"
  | "owner"
  | "field_assistant";

export type Profile = {
  id: string;
  full_name: string;
  role: UserRole;
  company: string;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
export type CaseStatus = "active" | "paused" | "closed";
export type WorkItemType =
  | "section"
  | "item"
  | "spec"
  | "manual"
  | "extra"     // 合約外項目(已簽約追加;有單價/複價)
  | "unsigned"; // 未簽約施工內容(待 office_staff 補報價、簽約後改為 extra)

/** 合約外/未簽約 的報價狀態。pending=待報價,quoted=已報價(有單價即視為已報價) */
export type QuoteStatus = "pending" | "quoted";
export type TenderImportStatus = "parsed" | "imported" | "failed";
export type LogStatus = "draft" | "submitted" | "approved" | "rejected";
export type ApprovalStage = "fill" | "review" | "audit" | "approve";
export type ApprovalDecision = "approved" | "rejected";
export type WeatherOption = "晴" | "多雲" | "陰" | "小雨" | "大雨" | "雨停";
export type DailyWeather = {
  am?: WeatherOption;
  pm?: WeatherOption;
};

export type DailyLogWorkItem = {
  work_item_id: string;     // FK 到 case_work_items.id
  qty: number;              // 永遠是「絕對量」(unit 的自然單位)。percent mode 也存 0-1 fraction。
  qty_mode?: "absolute" | "percent"; // UI 顯示模式;default absolute
  note?: string;
};

export type DailyLogSubcontractor = {
  trade: string;
  today?: number;
  accumulated?: number;
};

export type DailyLogMachine = {
  name: string;
  today?: number;
  accumulated?: number;
};

export type DailyLogManpower = {
  own?: number;             // 舊資料相容
  contract?: number;        // 舊資料相容
  today_total?: number;
  accumulated_total?: number;
  subcontractors?: DailyLogSubcontractor[];
  machines?: DailyLogMachine[];
};

export type DailyLogExtraItem = {
  name: string;             // 施工項目名稱
  unit?: string;
  qty?: number;
  headcount?: number;       // 人數
  location?: string;        // 位置
  requested_by?: string;    // 甲方交辦人員
  reason?: string;          // 事由
};

export type DailyLogUnsignedItem = {
  name: string;
  unit?: string;
  qty?: number;
  headcount?: number;       // 人數
  category?: "點工" | "變更追加";
  quote_amount?: number;    // 報價金額
  reason?: string;          // 尚未追加/報價事由
};

/**
 * 日誌照片(每張可附文字說明)。舊資料是純 string[](僅 path),
 * 新資料是 LogPhoto[];讀取時用 normalizeLogPhotos 統一處理。
 */
export type LogPhoto = {
  path: string;
  caption: string;
};

export type DailyLog = {
  id: string;
  case_id: string;
  supervisor_id: string | null;
  log_date: string;
  weather: string | null;   // JSON string: { am, pm }
  manpower: DailyLogManpower;
  work_items: DailyLogWorkItem[];
  extra_items: DailyLogExtraItem[];      // 非合約內
  unsigned_items: DailyLogUnsignedItem[]; // 未簽約
  photos: LogPhoto[];        // 舊資料 jsonb 可能是 string[],讀取時用 normalizeLogPhotos 處理
  vendor_notices: string | null;
  notes: string | null;
  status: LogStatus;
  current_stage: ApprovalStage | null;     // submitted 時表當前在哪關;其他狀態為 null
  submitted_at: string | null;
  pdf_path: string | null;                  // 核定通過後產生的 PDF 在 daily-log-pdfs bucket 的路徑
  pdf_status: PdfStatus;                    // PDF 產生狀態(migration-2.11 起)
  pdf_error: string | null;                 // 失敗原因(pdf_status='failed' 時填)
  // migration-2.22:首次送出時的 GPS 戳記。post-edit 不重寫,保留原始送出位置。
  submit_lat: number | null;
  submit_lng: number | null;
  submit_accuracy_m: number | null;
  submit_distance_m: number | null;
  submit_within_geofence: boolean | null;
  created_at: string;
  updated_at: string;
};

/** PDF 產生狀態,搭配 pdf_path 使用。migration-2.11 起。 */
export type PdfStatus = 'pending' | 'generating' | 'done' | 'failed';

/**
 * 施工日誌送出後的編輯軌跡。每次 post-submission edit 寫一筆,
 * 紀錄誰、何時、改了哪些欄位、編輯前的完整快照。approved 之後不再開放編輯。
 */
export type DailyLogRevision = {
  id: string;
  log_id: string;
  editor_id: string | null;
  editor_role: UserRole;
  edited_at: string;
  log_status_at_edit: LogStatus;
  snapshot: DailyLogSnapshot;
  changed_fields: DailyLogEditableField[];
  reason: string | null;
};

/** 可被 post-submission edit 改動的欄位 key */
export type DailyLogEditableField =
  | "log_date"
  | "weather"
  | "manpower"
  | "work_items"
  | "extra_items"
  | "unsigned_items"
  | "photos"
  | "vendor_notices"
  | "notes";

/** 編輯前可還原的 daily_log 快照(只含可改欄位) */
export type DailyLogSnapshot = {
  log_date: string;
  weather: string | null;
  manpower: DailyLogManpower;
  work_items: DailyLogWorkItem[];
  extra_items: DailyLogExtraItem[];
  unsigned_items: DailyLogUnsignedItem[];
  photos: LogPhoto[];
  vendor_notices: string | null;
  notes: string | null;
};

export type LogApproval = {
  id: string;
  log_id: string;
  stage: ApprovalStage;
  approver_id: string | null;
  decision: ApprovalDecision;
  comment: string | null;
  signature_url: string | null;
  created_at: string;
};

export type Case = {
  id: string;
  code: string | null;
  name: string;
  location: string | null;
  client: string | null;
  company: string;
  status: CaseStatus;
  started_at: string | null;
  expected_end: string | null;
  notes: string | null;
  // migration-2.20:打卡座標。lat/lng 必須同時 null 或同時有值;radius 預設 200 m。
  lat: number | null;
  lng: number | null;
  geofence_radius_m: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CaseWorkItem = {
  id: string;
  case_id: string;
  parent_id: string | null;
  sort_path: string;
  depth: number;
  item_type: WorkItemType;
  tender_code: string | null;
  name: string;
  unit: string | null;
  quantity: number | null;
  unit_price: number | null;
  total_price: number | null;
  brand_note: string | null;
  spec_text: string | null;
  skipped: boolean;
  modified_by_user: boolean;
  import_id: string | null;
  // 以下為 migration-2.13 新增欄位,僅 item_type IN ('extra','unsigned') 使用
  quote_status: QuoteStatus | null;        // 待報價/已報價;有單價即視為已報價
  contract_signed_at: string | null;       // 未簽約 → 合約外的時間戳(legacy:已搬到 extra_contracts.signed_at,但欄位保留)
  contract_note: string | null;            // 簽約備註(legacy:已搬到 extra_contracts.note)
  created_by: string | null;               // 誰建立(標單匯入為 null;手動新增帶 auth.uid)
  // migration-2.16 新增:item_type='extra' 必有,指向所屬「追加合約」
  extra_contract_id: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * 追加合約 — 把多筆「未簽約」工項一次包成一份報價單/合約(以合約為單位)。
 * bundle_price 為整份的優惠後總價;若 null 則回退用各品項 total_price 加總。
 */
export type ExtraContract = {
  id: string;
  case_id: string;
  name: string;
  bundle_price: number | null;
  note: string | null;
  signed_at: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FieldReportStatus = "pending" | "merged" | "archived";

export type FieldReportPhoto = {
  path: string;
  caption: string;
};

export type FieldReport = {
  id: string;
  case_id: string;
  author_id: string | null;
  note: string | null;
  photos: FieldReportPhoto[];
  status: FieldReportStatus;
  merged_into_log_id: string | null;
  merged_by: string | null;
  merged_at: string | null;
  // migration-2.22:建立時的 GPS 戳記。後續編輯不重寫。
  submit_lat: number | null;
  submit_lng: number | null;
  submit_accuracy_m: number | null;
  submit_distance_m: number | null;
  submit_within_geofence: boolean | null;
  created_at: string;
  updated_at: string;
};

/**
 * 打卡事件(migration-2.21)。
 * 上班 / 下班 各寫一筆 row,immutable(無 update / delete)。
 * case_id 為 null 表示「在公司 / 跨工地移動」,note 應在 UI 強制填。
 */
export type AttendanceEventType = "clock_in" | "clock_out";

export type AttendanceEvent = {
  id: string;
  user_id: string;
  case_id: string | null;
  event_type: AttendanceEventType;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  distance_m: number | null;
  within_geofence: boolean | null;
  source: "web" | "liff";
  user_agent: string | null;
  note: string | null;
  created_at: string;
};

/**
 * 請假(migration-2.23)。
 * 簽核鏈是上層遞推:applicant_role 決定 approval_chain。
 *   field_assistant  → [site_supervisor, office_staff, owner]
 *   site_supervisor  → [office_staff, owner]
 *   office_staff     → [owner]
 *   owner            → 不能送
 *
 * status / current_step 互動:
 *   pending  : current_step = chain[next]
 *   approved : current_step = null,resolved_at 有值
 *   rejected : current_step = null,resolved_at 有值
 *   cancelled: current_step = null,cancelled_at 有值
 */
export type LeaveType =
  | "personal"
  | "sick"
  | "official"
  | "annual"
  | "menstrual"
  | "bereavement"
  | "marriage"
  | "other";

export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";
export type LeaveDecision = "approved" | "rejected";

export type LeaveRequest = {
  id: string;
  applicant_id: string;
  applicant_role: UserRole;
  leave_type: LeaveType;
  start_at: string;
  end_at: string;
  total_hours: number;
  reason: string;
  attachment_path: string | null;
  status: LeaveStatus;
  current_step: UserRole | null;
  approval_chain: UserRole[];
  submitted_at: string;
  resolved_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LeaveApproval = {
  id: string;
  request_id: string;
  step_role: UserRole;
  approver_id: string | null;
  decision: LeaveDecision;
  comment: string | null;
  created_at: string;
};

export type TenderImport = {
  id: string;
  case_id: string;
  file_name: string;
  file_path: string | null;
  status: TenderImportStatus;
  parse_stats: Record<string, number>;
  warnings: { row: number; msg: string }[];
  imported_count: number;
  skipped_count: number;
  imported_by: string | null;
  created_at: string;
};
