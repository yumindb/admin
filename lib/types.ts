export type UserRole = "office_staff" | "site_supervisor" | "owner";
export type CaseStatus = "active" | "paused" | "closed";
export type WorkItemType = "section" | "item" | "spec" | "manual";
export type TenderImportStatus = "parsed" | "imported" | "failed";

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
  created_at: string;
  updated_at: string;
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
