"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { getCompanyShort } from "@/lib/companies";
import {
  Crown,
  ClipboardList,
  HardHat,
  UserCog,
  Plus,
  Pencil,
  KeyRound,
  Power,
  X,
  Check,
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  Rows3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NextStepHint } from "@/components/next-step-hint";
import type { UserRole } from "@/lib/types";
import {
  createStaffAction,
  updateStaffAction,
  resetPasswordAction,
  toggleActiveAction,
} from "./actions";
import type { StaffActionResult } from "./types";
import type { StaffRow } from "./page";

type RoleMeta = {
  key: UserRole;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  tint: string;       // 卡片邊框 + icon 底色
  permission: string; // 一句話寫權限
  level: number;      // 1 = 最高
};

const ROLES: RoleMeta[] = [
  {
    key: "owner",
    label: "老闆",
    shortLabel: "老闆",
    icon: Crown,
    tint: "#A07850",
    permission: "工作日誌填表、現場回報、最終核定、全公司可見、管理人員",
    level: 1,
  },
  {
    key: "office_staff",
    label: "辦公室助理",
    shortLabel: "助理",
    icon: ClipboardList,
    tint: "#0369A1",
    permission: "開案、匯入工項、審核工作日誌、管理人員",
    level: 2,
  },
  {
    key: "site_supervisor",
    label: "工地主任",
    shortLabel: "主任",
    icon: HardHat,
    tint: "#4A7C59",
    permission: "工作日誌填表、現場回報",
    level: 3,
  },
  {
    key: "field_assistant",
    label: "現場人員",
    shortLabel: "現場",
    icon: UserCog,
    tint: "#8A847C",
    permission: "僅能新增現場回報",
    level: 4,
  },
];

const ROLE_BY_KEY = new Map(ROLES.map((r) => [r.key, r]));

type ModalMode =
  | { kind: "create" }
  | { kind: "edit"; staff: StaffRow }
  | { kind: "reset"; staff: StaffRow }
  | null;

type ViewMode = "card" | "table";

export function StaffManager({
  currentUserId,
  currentUserRole,
  staffByRole,
}: {
  currentUserId: string;
  currentUserRole: UserRole;
  staffByRole: Record<UserRole, StaffRow[]>;
}) {
  const [modal, setModal] = useState<ModalMode>(null);
  const [hierarchyOpen, setHierarchyOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  // 辦公室助理視角:三家公司加起來幾十人，沒搜尋只能滾。
  // 支援姓名 / 帳號 / 電話模糊搜尋。
  const [searchQuery, setSearchQuery] = useState<string>("");

  // 動態撈 distinct company（避免 hardcode）；保留出現順序
  const allStaffRaw = ROLES.flatMap((r) => staffByRole[r.key] ?? []);
  const companies = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of allStaffRaw) {
      const v = (s.company ?? "").trim();
      if (!v) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  })();

  // 套 company filter + 搜尋:重組 staffByRole 與 allStaff
  const q = searchQuery.trim().toLowerCase();
  const matchCompany = (s: StaffRow) =>
    companyFilter === "all" ? true : (s.company ?? "") === companyFilter;
  const matchSearch = (s: StaffRow) => {
    if (!q) return true;
    const hay = [s.full_name, s.username, s.email, s.phone]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  };
  const filteredStaffByRole = Object.fromEntries(
    (Object.entries(staffByRole) as [UserRole, StaffRow[]][]).map(
      ([k, list]) => [k, (list ?? []).filter((s) => matchCompany(s) && matchSearch(s))],
    ),
  ) as Record<UserRole, StaffRow[]>;

  const totalStaff = Object.values(filteredStaffByRole).reduce(
    (sum, list) => sum + (list?.length ?? 0),
    0,
  );
  const activeStaff = Object.values(filteredStaffByRole).reduce(
    (sum, list) => sum + (list?.filter((s) => s.is_active).length ?? 0),
    0,
  );

  // 攤平所有人員，依角色階層排序，給表格模式用
  const allStaff = ROLES.flatMap((r) => filteredStaffByRole[r.key] ?? []);

  const canManage =
    currentUserRole === "owner" || currentUserRole === "office_staff";

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary md:text-3xl">
            人員管理
          </h1>
          <p className="mt-1.5 text-base text-muted-foreground">
            建立帳號、指派角色、停用離職人員。共 {totalStaff} 個帳號（啟用中{" "}
            {activeStaff}）。
          </p>
        </div>
        <Button
          size="lg"
          onClick={() => setModal({ kind: "create" })}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" /> 新增帳號
        </Button>
      </div>

      <div className="mb-4">
        <NextStepHint tone="muted">
          停用後該員無法登入，歷史簽核記錄保留。改密碼後請當面／LINE 告知本人。
        </NextStepHint>
      </div>

      {/* 搜尋：姓名 / 帳號 / 電話 — 三家公司幾十人時用得到 */}
      <div className="mb-3 rounded-lg border border-[#E0DCD6] bg-card px-4 py-2.5">
        <label className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">搜尋</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="姓名、帳號或電話"
            className="h-10 flex-1 rounded-md border border-[#E0DCD6] bg-white px-3 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="rounded-md border border-[#E0DCD6] bg-white px-2.5 py-1 text-xs text-muted-foreground hover:border-accent hover:text-accent"
              aria-label="清除搜尋"
            >
              清除
            </button>
          )}
        </label>
        {q && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            搜尋「{searchQuery}」找到 {totalStaff} 人
          </p>
        )}
      </div>

      {/* 公司 tab（動態；空時隱藏） */}
      {companies.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-[#E0DCD6] bg-card px-4 py-3">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            公司
          </span>
          <CompanyTab
            label="全部"
            count={allStaffRaw.length}
            active={companyFilter === "all"}
            onClick={() => setCompanyFilter("all")}
          />
          {companies.map((co) => {
            const count = allStaffRaw.filter(
              (s) => (s.company ?? "") === co,
            ).length;
            return (
              <CompanyTab
                key={co}
                label={getCompanyShort(co)}
                count={count}
                active={companyFilter === co}
                onClick={() => setCompanyFilter(co)}
              />
            );
          })}
        </div>
      )}

      {/* 權限階層（可收合） */}
      <HierarchyOverview
        open={hierarchyOpen}
        onToggle={() => setHierarchyOpen((v) => !v)}
      />

      {/* 檢視模式切換 */}
      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-base font-semibold text-primary">人員名單</h2>
        <div className="inline-flex rounded-md border border-[#E0DCD6] bg-white p-0.5">
          <ViewModeButton
            active={viewMode === "table"}
            onClick={() => setViewMode("table")}
            icon={Rows3}
            label="表格"
          />
          <ViewModeButton
            active={viewMode === "card"}
            onClick={() => setViewMode("card")}
            icon={LayoutGrid}
            label="卡片"
          />
        </div>
      </div>

      {/* 名單 */}
      <div className="mt-3">
        {viewMode === "table" ? (
          <StaffTable
            staff={allStaff}
            currentUserId={currentUserId}
            canManage={canManage}
            onEdit={(s) => setModal({ kind: "edit", staff: s })}
            onReset={(s) => setModal({ kind: "reset", staff: s })}
          />
        ) : (
          <div className="space-y-6">
            {ROLES.map((role) => (
              <RoleSection
                key={role.key}
                role={role}
                staff={filteredStaffByRole[role.key] ?? []}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
                onEdit={(s) => setModal({ kind: "edit", staff: s })}
                onReset={(s) => setModal({ kind: "reset", staff: s })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {modal?.kind === "create" && (
        <CreateModal onClose={() => setModal(null)} />
      )}
      {modal?.kind === "edit" && (
        <EditModal staff={modal.staff} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "reset" && (
        <ResetModal staff={modal.staff} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function CompanyTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
        active
          ? "border-accent bg-[#F5F1EC] text-primary"
          : "border-[#E0DCD6] bg-white text-foreground hover:border-accent"
      }`}
    >
      <span>{label}</span>
      <span
        className={`tabular-nums ${
          active ? "text-primary/80" : "text-muted-foreground"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function ViewModeButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded px-3 py-1 text-sm transition-colors ${
        active
          ? "bg-[#F5F1EC] text-primary"
          : "text-muted-foreground hover:text-primary"
      }`}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* 階層概覽（金字塔）                                                  */
/* ------------------------------------------------------------------ */

function HierarchyOverview({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-lg border border-[#E0DCD6] bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[#F5F1EC]/40"
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
          <span className="text-sm font-semibold text-primary">權限階層</span>
          {/* 收合時顯示緊湊角色徽章 */}
          {!open && (
            <div className="ml-2 hidden items-center gap-1.5 sm:flex">
              {ROLES.map((r) => {
                const Icon = r.icon;
                return (
                  <span
                    key={r.key}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
                    style={{
                      backgroundColor: `${r.tint}1A`,
                      color: r.tint,
                    }}
                  >
                    <Icon className="size-3" />
                    L{r.level}．{r.shortLabel}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {open ? "點此收合" : "點此展開查看每個角色的權限"}
        </span>
      </button>

      {open && (
        <div className="border-t border-[#E0DCD6] px-6 py-5 md:px-8 md:py-6">
          <div className="space-y-3">
            {ROLES.map((role, idx) => {
              const Icon = role.icon;
              const indent = `${idx * 1.25}rem`;
              return (
                <div
                  key={role.key}
                  className="flex items-stretch gap-3"
                  style={{ paddingLeft: indent }}
                >
                  {idx > 0 && (
                    <div
                      className="flex shrink-0 flex-col items-center"
                      style={{ width: "1rem" }}
                    >
                      <div className="h-full w-px bg-[#E0DCD6]" />
                    </div>
                  )}
                  <div
                    className="flex flex-1 items-center gap-4 rounded-md border bg-white px-4 py-3"
                    style={{ borderColor: `${role.tint}33` }}
                  >
                    <div
                      className="flex size-10 shrink-0 items-center justify-center rounded-md text-white"
                      style={{ backgroundColor: role.tint }}
                    >
                      <Icon className="size-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-base font-semibold text-primary">
                          L{role.level}．{role.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          （{role.key}）
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {role.permission}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 rounded-md border border-dashed border-[#E0DCD6] bg-[#F5F1EC]/60 px-4 py-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">流程：</span>
            現場回報（現場人員／工地主任／老闆，前置）→ 工作日誌填表（工地主任／老闆）→ 審核（辦公室助理）→ 核定（老闆）
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 表格檢視                                                            */
/* ------------------------------------------------------------------ */

function StaffTable({
  staff,
  currentUserId,
  canManage,
  onEdit,
  onReset,
}: {
  staff: StaffRow[];
  currentUserId: string;
  canManage: boolean;
  onEdit: (s: StaffRow) => void;
  onReset: (s: StaffRow) => void;
}) {
  if (staff.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-10 text-center text-sm text-muted-foreground">
        還沒有任何帳號
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[#E0DCD6] bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#F5F1EC]/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">姓名</th>
              <th className="px-4 py-3 font-medium">帳號</th>
              <th className="px-4 py-3 font-medium">電話</th>
              <th className="px-4 py-3 font-medium">角色</th>
              <th className="px-4 py-3 font-medium">狀態</th>
              {canManage && (
                <th className="px-4 py-3 text-right font-medium">操作</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0EBE4]">
            {staff.map((s) => (
              <StaffTableRow
                key={s.id}
                staff={s}
                isSelf={s.id === currentUserId}
                canManage={canManage}
                onEdit={() => onEdit(s)}
                onReset={() => onReset(s)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StaffTableRow({
  staff,
  isSelf,
  canManage,
  onEdit,
  onReset,
}: {
  staff: StaffRow;
  isSelf: boolean;
  canManage: boolean;
  onEdit: () => void;
  onReset: () => void;
}) {
  const role = ROLE_BY_KEY.get(staff.role as UserRole);
  const Icon = role?.icon ?? UserCog;
  const [isPending, startTransition] = useTransition();
  const [confirmingToggle, setConfirmingToggle] = useState(false);

  function performToggle() {
    const next = !staff.is_active;
    setConfirmingToggle(false);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("user_id", staff.id);
      fd.set("next", String(next));
      const res = await toggleActiveAction(fd);
      if (!res.ok) toast.error(res.error ?? "操作失敗");
      else toast.success(next ? "已啟用" : "已停用");
    });
  }

  return (
    <tr
      className={`transition-colors hover:bg-[#F5F1EC]/40 ${
        staff.is_active ? "" : "opacity-60"
      }`}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-medium text-primary">{staff.full_name}</span>
          {isSelf && (
            <span className="rounded-full border border-[#A07850]/40 bg-[#F5F1EC] px-1.5 py-0 text-xs text-[#A07850]">
              您
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 font-mono text-muted-foreground">
        {staff.username ?? staff.email ?? "—"}
      </td>
      <td className="px-4 py-3 text-muted-foreground">{staff.phone || "—"}</td>
      <td className="px-4 py-3">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs"
          style={{
            backgroundColor: role ? `${role.tint}1A` : "#E0DCD6",
            color: role?.tint ?? "#5A5050",
          }}
        >
          <Icon className="size-3" />
          L{role?.level ?? "-"}．{role?.label ?? staff.role}
        </span>
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${
            staff.is_active
              ? "border-[#A7F3D0] bg-[#ECFDF5] text-[#4A7C59]"
              : "border-[#E5E7EB] bg-[#F3F4F6] text-[#6B7280]"
          }`}
        >
          {staff.is_active ? "啟用中" : "已停用"}
        </span>
      </td>
      {canManage && (
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={onEdit}
              title="編輯"
              className="inline-flex items-center gap-1 rounded-md border border-[#E0DCD6] bg-white px-2 py-1 text-xs text-foreground transition-colors hover:border-accent hover:text-accent"
            >
              <Pencil className="size-3" />
              編輯
            </button>
            <button
              type="button"
              onClick={onReset}
              title="改密碼"
              className="inline-flex items-center gap-1 rounded-md border border-[#E0DCD6] bg-white px-2 py-1 text-xs text-foreground transition-colors hover:border-accent hover:text-accent"
            >
              <KeyRound className="size-3" />
              改密碼
            </button>
            {!isSelf && (
              <button
                type="button"
                onClick={() => setConfirmingToggle(true)}
                disabled={isPending}
                title={staff.is_active ? "停用" : "啟用"}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50 ${
                  staff.is_active
                    ? "border-[#FCA5A5] bg-white text-[#B91C1C] hover:bg-[#FEF2F2]"
                    : "border-[#A7F3D0] bg-white text-[#4A7C59] hover:bg-[#ECFDF5]"
                }`}
              >
                <Power className="size-3" />
                {isPending ? "更新中…" : staff.is_active ? "停用" : "啟用"}
              </button>
            )}
          </div>
          {confirmingToggle && (
            <ConfirmDialog
              title={staff.is_active ? "停用帳號" : "啟用帳號"}
              message={
                staff.is_active
                  ? `要停用「${staff.full_name}」的帳號嗎？停用後將無法登入，但歷史簽核記錄會保留。`
                  : `要重新啟用「${staff.full_name}」的帳號嗎？啟用後可以重新登入。`
              }
              confirmText={staff.is_active ? "停用" : "啟用"}
              danger={staff.is_active}
              onConfirm={performToggle}
              onCancel={() => setConfirmingToggle(false)}
            />
          )}
        </td>
      )}
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* 角色名單區塊                                                        */
/* ------------------------------------------------------------------ */

function RoleSection({
  role,
  staff,
  currentUserId,
  currentUserRole,
  onEdit,
  onReset,
}: {
  role: RoleMeta;
  staff: StaffRow[];
  currentUserId: string;
  currentUserRole: UserRole;
  onEdit: (s: StaffRow) => void;
  onReset: (s: StaffRow) => void;
}) {
  const Icon = role.icon;
  const activeCount = staff.filter((s) => s.is_active).length;
  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <div
          className="flex size-8 items-center justify-center rounded-md text-white"
          style={{ backgroundColor: role.tint }}
        >
          <Icon className="size-4" />
        </div>
        <h3 className="text-base font-semibold text-primary">{role.label}</h3>
        <span className="text-sm text-muted-foreground">
          {activeCount} / {staff.length}
        </span>
      </div>

      {staff.length === 0 ? (
        <div className="rounded-md border border-dashed border-[#E0DCD6] bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          目前沒有「{role.label}」角色的帳號
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {staff.map((s) => (
            <StaffCard
              key={s.id}
              staff={s}
              role={role}
              isSelf={s.id === currentUserId}
              canManage={
                currentUserRole === "owner" || currentUserRole === "office_staff"
              }
              onEdit={() => onEdit(s)}
              onReset={() => onReset(s)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function StaffCard({
  staff,
  role,
  isSelf,
  canManage,
  onEdit,
  onReset,
}: {
  staff: StaffRow;
  role: RoleMeta;
  isSelf: boolean;
  canManage: boolean;
  onEdit: () => void;
  onReset: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [confirmingToggle, setConfirmingToggle] = useState(false);

  function performToggle() {
    const next = !staff.is_active;
    setConfirmingToggle(false);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("user_id", staff.id);
      fd.set("next", String(next));
      const res = await toggleActiveAction(fd);
      if (!res.ok) toast.error(res.error ?? "操作失敗");
      else toast.success(next ? "已啟用" : "已停用");
    });
  }

  return (
    <div
      className={`flex flex-col rounded-lg border bg-card p-4 transition-colors ${
        staff.is_active ? "border-[#E0DCD6]" : "border-[#E0DCD6] opacity-60"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-base font-semibold text-primary">
              {staff.full_name}
            </span>
            {isSelf && (
              <span className="shrink-0 rounded-full border border-[#A07850]/40 bg-[#F5F1EC] px-2 py-0.5 text-xs text-[#A07850]">
                您
              </span>
            )}
          </div>
          <div className="mt-1 truncate font-mono text-sm text-muted-foreground">
            {staff.username ?? staff.email ?? "（無帳號）"}
          </div>
          {staff.phone && (
            <div className="mt-0.5 text-sm text-muted-foreground">
              {staff.phone}
            </div>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${
            staff.is_active
              ? "border-[#A7F3D0] bg-[#ECFDF5] text-[#4A7C59]"
              : "border-[#E5E7EB] bg-[#F3F4F6] text-[#6B7280]"
          }`}
        >
          {staff.is_active ? "啟用中" : "已停用"}
        </span>
      </div>

      <div
        className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-xs"
        style={{
          backgroundColor: `${role.tint}1A`,
          color: role.tint,
        }}
      >
        L{role.level}．{role.label}
      </div>

      {canManage && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#F0EBE4] pt-3">
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1 rounded-md border border-[#E0DCD6] bg-white px-2.5 py-1 text-xs text-foreground transition-colors hover:border-accent hover:text-accent"
          >
            <Pencil className="size-3" /> 編輯
          </button>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 rounded-md border border-[#E0DCD6] bg-white px-2.5 py-1 text-xs text-foreground transition-colors hover:border-accent hover:text-accent"
          >
            <KeyRound className="size-3" /> 改密碼
          </button>
          {!isSelf && (
            <button
              type="button"
              onClick={() => setConfirmingToggle(true)}
              disabled={isPending}
              className={`ml-auto inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
                staff.is_active
                  ? "border-[#FCA5A5] bg-white text-[#B91C1C] hover:bg-[#FEF2F2]"
                  : "border-[#A7F3D0] bg-white text-[#4A7C59] hover:bg-[#ECFDF5]"
              }`}
            >
              <Power className="size-3" />
              {isPending ? "更新中…" : staff.is_active ? "停用" : "啟用"}
            </button>
          )}
        </div>
      )}
      {confirmingToggle && (
        <ConfirmDialog
          title={staff.is_active ? "停用帳號" : "啟用帳號"}
          message={
            staff.is_active
              ? `要停用「${staff.full_name}」的帳號嗎？停用後將無法登入，但歷史簽核記錄會保留。`
              : `要重新啟用「${staff.full_name}」的帳號嗎？啟用後可以重新登入。`
          }
          confirmText={staff.is_active ? "停用" : "啟用"}
          danger={staff.is_active}
          onConfirm={performToggle}
          onCancel={() => setConfirmingToggle(false)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Confirm dialog（取代 window.confirm）                                */
/* ------------------------------------------------------------------ */

function ConfirmDialog({
  title,
  message,
  confirmText,
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmText: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-lg border border-[#E0DCD6] bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[#E0DCD6] px-5 py-3">
          <h2 className="text-base font-semibold text-primary">{title}</h2>
        </div>
        <div className="px-5 py-4 text-sm leading-relaxed text-foreground">
          {message}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[#E0DCD6] px-5 py-3">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="border-[#E0DCD6]"
          >
            取消
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            className={
              danger
                ? "bg-[#B91C1C] text-white hover:bg-[#991B1B]"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            }
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal 共用                                                          */
/* ------------------------------------------------------------------ */

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-[#E0DCD6] bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#E0DCD6] px-5 py-3">
          <h2 className="text-base font-semibold text-primary">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-[#F5F1EC] hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="mt-1 text-xs text-[#B91C1C]">{msg}</p>;
}

function RoleSelector({
  value,
  onChange,
}: {
  value: UserRole;
  onChange: (r: UserRole) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {ROLES.map((r) => {
        const Icon = r.icon;
        const active = value === r.key;
        return (
          <button
            key={r.key}
            type="button"
            onClick={() => onChange(r.key)}
            className={`flex items-center gap-2 rounded-md border p-3 text-left transition-colors ${
              active
                ? "border-accent bg-[#F5F1EC]"
                : "border-[#E0DCD6] bg-white hover:border-accent/50"
            }`}
          >
            <div
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-white"
              style={{ backgroundColor: r.tint }}
            >
              <Icon className="size-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-foreground">
                  {r.label}
                </span>
                {active && <Check className="size-3.5 text-accent" />}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                L{r.level}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 新增帳號                                                            */
/* ------------------------------------------------------------------ */

function CreateModal({ onClose }: { onClose: () => void }) {
  const [role, setRole] = useState<UserRole>("site_supervisor");
  const [state, setState] = useState<StaffActionResult | undefined>(undefined);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (state?.error) toast.error(state.error);
  }, [state]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("role", role);
    startTransition(async () => {
      const res = await createStaffAction(undefined, fd);
      setState(res);
      if (res.ok) {
        toast.success("帳號已建立");
        onClose();
      }
    });
  }

  return (
    <ModalShell title="新增帳號" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="full_name">姓名</Label>
          <Input id="full_name" name="full_name" required maxLength={60} />
          <FieldError msg={state?.fieldErrors?.full_name?.[0]} />
        </div>
        <div>
          <Label htmlFor="username">帳號（用來登入）</Label>
          <Input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            minLength={2}
            maxLength={30}
            pattern="[a-z0-9]{2,30}"
            placeholder="小寫英文字母+數字，例：supervisor3"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            僅小寫英文字母與數字，2-30 字。建立後不可變更。
          </p>
          <FieldError msg={state?.fieldErrors?.username?.[0]} />
        </div>
        <div>
          <Label htmlFor="password">初始密碼（至少 6 碼）</Label>
          <Input
            id="password"
            name="password"
            type="text"
            required
            minLength={6}
            placeholder="例：yumin1234"
          />
          <FieldError msg={state?.fieldErrors?.password?.[0]} />
        </div>
        <div>
          <Label htmlFor="phone">電話（選填）</Label>
          <Input id="phone" name="phone" />
        </div>
        <div>
          <Label>角色</Label>
          <div className="mt-2">
            <RoleSelector value={role} onChange={setRole} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {ROLE_BY_KEY.get(role)?.permission}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "建立中…" : "建立帳號"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ */
/* 編輯（姓名／角色／電話）                                            */
/* ------------------------------------------------------------------ */

function EditModal({
  staff,
  onClose,
}: {
  staff: StaffRow;
  onClose: () => void;
}) {
  const [role, setRole] = useState<UserRole>(staff.role as UserRole);
  const [state, setState] = useState<StaffActionResult | undefined>(undefined);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (state?.error) toast.error(state.error);
  }, [state]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("user_id", staff.id);
    fd.set("role", role);
    startTransition(async () => {
      const res = await updateStaffAction(undefined, fd);
      setState(res);
      if (res.ok) {
        toast.success("已儲存");
        onClose();
      }
    });
  }

  return (
    <ModalShell title={`編輯：${staff.full_name}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="rounded-md border border-[#E0DCD6] bg-[#F5F1EC]/40 px-3 py-2 text-sm text-muted-foreground">
          帳號：<span className="font-mono">{staff.username ?? staff.email ?? "—"}</span>
        </div>
        <div>
          <Label htmlFor="full_name">姓名</Label>
          <Input
            id="full_name"
            name="full_name"
            defaultValue={staff.full_name}
            required
            maxLength={60}
          />
          <FieldError msg={state?.fieldErrors?.full_name?.[0]} />
        </div>
        <div>
          <Label htmlFor="phone">電話</Label>
          <Input id="phone" name="phone" defaultValue={staff.phone ?? ""} />
        </div>
        <div>
          <Label>角色</Label>
          <div className="mt-2">
            <RoleSelector value={role} onChange={setRole} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {ROLE_BY_KEY.get(role)?.permission}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "儲存中…" : "儲存"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ */
/* 改密碼                                                              */
/* ------------------------------------------------------------------ */

function ResetModal({
  staff,
  onClose,
}: {
  staff: StaffRow;
  onClose: () => void;
}) {
  const [state, setState] = useState<StaffActionResult | undefined>(undefined);
  const [isPending, startTransition] = useTransition();
  // 重設成功後在密碼欄旁邊 inline 顯示新密碼 + 複製按鈕(取代 alert())
  const [savedPassword, setSavedPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (state?.error) toast.error(state.error);
  }, [state]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("user_id", staff.id);
    const pw = String(fd.get("password") ?? "");
    startTransition(async () => {
      const res = await resetPasswordAction(undefined, fd);
      setState(res);
      if (res.ok) {
        toast.success("密碼已重設");
        setSavedPassword(pw);
        setCopied(false);
      }
    });
  }

  async function copyPassword() {
    if (!savedPassword) return;
    try {
      await navigator.clipboard.writeText(savedPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 老瀏覽器:做選取 fallback,不報錯
      setCopied(false);
    }
  }

  return (
    <ModalShell title={`重設密碼：${staff.full_name}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="rounded-md border border-[#E0DCD6] bg-[#F5F1EC]/40 px-3 py-2 text-sm text-muted-foreground">
          帳號：<span className="font-mono">{staff.username ?? staff.email ?? "—"}</span>
        </div>
        <div>
          <Label htmlFor="password">新密碼（至少 6 碼）</Label>
          <Input
            id="password"
            name="password"
            type="text"
            required
            minLength={6}
            disabled={!!savedPassword}
          />
          <FieldError msg={state?.fieldErrors?.password?.[0]} />
          {savedPassword && (
            <div className="mt-2 rounded-md border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-2.5 text-sm text-[#4A7C59]">
              <div className="mb-1 font-medium">
                已重設「{staff.full_name}」的密碼，請當面或透過 LINE 告知本人。
              </div>
              <div className="flex items-center justify-between gap-2">
                <code className="break-all rounded border border-[#A7F3D0] bg-white px-2 py-1 font-mono text-sm text-foreground">
                  {savedPassword}
                </code>
                <button
                  type="button"
                  onClick={copyPassword}
                  className="inline-flex shrink-0 items-center rounded-md border border-[#E0DCD6] bg-white px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-accent hover:text-accent"
                >
                  {copied ? "已複製" : "複製"}
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {savedPassword ? "關閉" : "取消"}
          </Button>
          {!savedPassword && (
            <Button type="submit" disabled={isPending}>
              {isPending ? "更新中…" : "重設密碼"}
            </Button>
          )}
        </div>
      </form>
    </ModalShell>
  );
}
