"use client";

import { useState, useTransition } from "react";
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
    permission: "最終核定簽核、全公司案件可見、可管理人員",
    level: 1,
  },
  {
    key: "office_staff",
    label: "辦公室助理",
    shortLabel: "助理",
    icon: ClipboardList,
    tint: "#0369A1",
    permission: "開案、匯入標單、第三關審核、可管理人員",
    level: 2,
  },
  {
    key: "site_supervisor",
    label: "工地主任",
    shortLabel: "主任",
    icon: HardHat,
    tint: "#4A7C59",
    permission: "填寫／送出施工日誌、第二關複核",
    level: 3,
  },
  {
    key: "field_assistant",
    label: "現場助理",
    shortLabel: "現場",
    icon: UserCog,
    tint: "#8A847C",
    permission: "僅能新增施工日誌（無審核權限）",
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
  const totalStaff = Object.values(staffByRole).reduce(
    (sum, list) => sum + (list?.length ?? 0),
    0,
  );
  const activeStaff = Object.values(staffByRole).reduce(
    (sum, list) => sum + (list?.filter((s) => s.is_active).length ?? 0),
    0,
  );

  // 攤平所有人員，依角色階層排序，給表格模式用
  const allStaff = ROLES.flatMap((r) => staffByRole[r.key] ?? []);

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
                staff={staffByRole[role.key] ?? []}
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
            <span className="font-medium text-foreground">簽核流程：</span>
            填表（現場助理／工地主任） → 複核（工地主任） → 審核（辦公室助理） → 核定（老闆）
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
              <th className="px-4 py-3 font-medium">Email</th>
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
  const [error, setError] = useState<string | null>(null);

  function onToggleActive() {
    const next = !staff.is_active;
    if (
      !confirm(
        next
          ? `要重新啟用「${staff.full_name}」的帳號嗎？啟用後可以重新登入。`
          : `要停用「${staff.full_name}」的帳號嗎？停用後將無法登入，但歷史簽核記錄會保留。`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("user_id", staff.id);
      fd.set("next", String(next));
      const res = await toggleActiveAction(fd);
      if (!res.ok) setError(res.error ?? "操作失敗");
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
              你
            </span>
          )}
        </div>
        {error && (
          <p className="mt-1 text-xs text-[#B91C1C]">{error}</p>
        )}
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {staff.email ?? "—"}
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
                onClick={onToggleActive}
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
  const [error, setError] = useState<string | null>(null);

  function onToggleActive() {
    const next = !staff.is_active;
    if (
      !confirm(
        next
          ? `要重新啟用「${staff.full_name}」的帳號嗎？啟用後可以重新登入。`
          : `要停用「${staff.full_name}」的帳號嗎？停用後將無法登入，但歷史簽核記錄會保留。`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("user_id", staff.id);
      fd.set("next", String(next));
      const res = await toggleActiveAction(fd);
      if (!res.ok) setError(res.error ?? "操作失敗");
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
                你
              </span>
            )}
          </div>
          <div className="mt-1 truncate text-sm text-muted-foreground">
            {staff.email ?? "（無 email）"}
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

      {error && (
        <p className="mt-2 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-2 py-1 text-xs text-[#B91C1C]">
          {error}
        </p>
      )}

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
              onClick={onToggleActive}
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

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("role", role);
    startTransition(async () => {
      const res = await createStaffAction(undefined, fd);
      setState(res);
      if (res.ok) onClose();
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
          <Label htmlFor="email">Email（用來登入）</Label>
          <Input id="email" name="email" type="email" required />
          <FieldError msg={state?.fieldErrors?.email?.[0]} />
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
        {state?.error && (
          <p className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
            {state.error}
          </p>
        )}
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

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("user_id", staff.id);
    fd.set("role", role);
    startTransition(async () => {
      const res = await updateStaffAction(undefined, fd);
      setState(res);
      if (res.ok) onClose();
    });
  }

  return (
    <ModalShell title={`編輯：${staff.full_name}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="rounded-md border border-[#E0DCD6] bg-[#F5F1EC]/40 px-3 py-2 text-sm text-muted-foreground">
          Email：{staff.email ?? "—"}
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
        {state?.error && (
          <p className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
            {state.error}
          </p>
        )}
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

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("user_id", staff.id);
    startTransition(async () => {
      const res = await resetPasswordAction(undefined, fd);
      setState(res);
      if (res.ok) {
        alert(`已重設「${staff.full_name}」的密碼，請告知本人。`);
        onClose();
      }
    });
  }

  return (
    <ModalShell title={`重設密碼：${staff.full_name}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="rounded-md border border-[#E0DCD6] bg-[#F5F1EC]/40 px-3 py-2 text-sm text-muted-foreground">
          Email：{staff.email ?? "—"}
        </div>
        <div>
          <Label htmlFor="password">新密碼（至少 6 碼）</Label>
          <Input
            id="password"
            name="password"
            type="text"
            required
            minLength={6}
          />
          <FieldError msg={state?.fieldErrors?.password?.[0]} />
        </div>
        {state?.error && (
          <p className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
            {state.error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "更新中…" : "重設密碼"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}
