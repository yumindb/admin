/**
 * 施工日誌 PDF 元件 — 給 @react-pdf/renderer 用。
 *
 * 字型：Noto Sans CJK TC subset（自架在 Supabase Storage `fonts` public bucket，
 * 避免 jsdelivr 偶發不穩、避免 bundle 大檔到 Vercel function）。
 * 第一次產 PDF 時 react-pdf 會 fetch 字型並 cache 到 process memory，
 * 之後同 process 重用不會再下載。
 *
 * `-sub.woff2` 是裁剪過的字集（兩檔共 18.6MB，原版 OTF 33MB）：保留完整
 * URO+ExtA 漢字區、注音、假名、全形、CJK 符號單位（㎡℃①■→ 等），
 * 只砍掉韓文與 ExtB+ 罕字 — 台灣人名罕字（堃喆玥㨗…）都還在。
 * 再瘦身（如只留 Big5）會有人名缺字風險，不要做。
 * 產生方式見 bucket 內原版 OTF + fonttools pyftsubset（unicode ranges 記錄在
 * git log 此行的 commit message）。原版 OTF 仍留在 bucket 供 rollback。
 *
 * react-pdf 嵌入 PDF 時會自動只 embed 用到的 glyphs（PDF 標準 subset），
 * 所以最終 PDF 檔案不會塞完整字型。
 */
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import {
  buildReportNumber,
  formatWeatherSummary,
  getWeekdayLabel,
  isBackfilledLog,
} from "@/lib/daily-log";
import { formatTW } from "@/lib/datetime";
import type {
  DailyLog,
  DailyLogExtraItem,
  DailyLogUnsignedItem,
  LogApproval,
} from "@/lib/types";

// 字型只能 register 一次,重複呼叫會被 react-pdf ignore
let fontRegistered = false;
function ensureFont() {
  if (fontRegistered) return;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL not set — required for PDF font loading");
  }
  const fontBase = `${supabaseUrl}/storage/v1/object/public/fonts`;
  Font.register({
    family: "Noto Sans TC",
    fonts: [
      {
        src: `${fontBase}/NotoSansCJKtc-Regular-sub.woff2`,
        fontWeight: "normal",
      },
      {
        src: `${fontBase}/NotoSansCJKtc-Bold-sub.woff2`,
        fontWeight: "bold",
      },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]); // CJK 不要被當英文 hyphenate
  fontRegistered = true;
}

const COLORS = {
  primary: "#003153",
  text: "#5A5050",
  muted: "#8A8580",
  border: "#E0DCD6",
  accent: "#A07850",
  bgSoft: "#F5F1EC",
};

const styles = StyleSheet.create({
  page: {
    fontFamily: "Noto Sans TC",
    fontSize: 9,
    color: COLORS.text,
    paddingHorizontal: 32,
    paddingVertical: 28,
    lineHeight: 1.4,
  },
  header: {
    borderBottom: `1pt solid ${COLORS.primary}`,
    paddingBottom: 8,
    marginBottom: 12,
  },
  headerTitle: {
    color: COLORS.primary,
    fontSize: 16,
    fontWeight: "bold",
    // 標題字大,CJK 字型的實際字面會吃掉 line box 下緣 —
    // 明確留空,不然表報編號那行會貼到標題(2026-07 紙本回饋)
    marginBottom: 8,
  },
  headerMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    fontSize: 8,
    color: COLORS.muted,
  },
  headerMetaItem: {
    marginRight: 14,
  },
  sectionTitle: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: "bold",
    marginTop: 14,
    marginBottom: 6,
    paddingBottom: 3,
    borderBottom: `0.5pt solid ${COLORS.border}`,
  },
  twoCol: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 0,
  },
  cell: {
    width: "50%",
    paddingRight: 8,
    marginBottom: 4,
  },
  cellLabel: {
    fontSize: 8,
    color: COLORS.muted,
  },
  cellValue: {
    fontSize: 10,
    color: COLORS.text,
  },
  table: {
    borderTop: `0.5pt solid ${COLORS.border}`,
    borderLeft: `0.5pt solid ${COLORS.border}`,
  },
  tr: {
    flexDirection: "row",
    borderBottom: `0.5pt solid ${COLORS.border}`,
  },
  th: {
    backgroundColor: COLORS.bgSoft,
    color: COLORS.primary,
    fontWeight: "bold",
    fontSize: 8,
    padding: 4,
    borderRight: `0.5pt solid ${COLORS.border}`,
  },
  td: {
    fontSize: 9,
    padding: 4,
    borderRight: `0.5pt solid ${COLORS.border}`,
    color: COLORS.text,
  },
  paragraph: {
    fontSize: 10,
    color: COLORS.text,
    marginBottom: 4,
  },
  notesBox: {
    border: `0.5pt solid ${COLORS.border}`,
    backgroundColor: "#FAF7F2",
    padding: 8,
    borderRadius: 3,
    fontSize: 9,
    color: COLORS.text,
  },
  // 簽核區 — 傳統紙本表單的「簽章欄」:每關一格並排,意見另起整行(2026-07 重設計)
  sigGrid: {
    flexDirection: "row",
    gap: 6,
    marginTop: 2,
  },
  sigCell: {
    flex: 1,
    border: `0.5pt solid ${COLORS.border}`,
    paddingVertical: 6,
    paddingHorizontal: 4,
    alignItems: "center",
  },
  sigStage: {
    fontSize: 7.5,
    color: COLORS.muted,
  },
  sigName: {
    fontSize: 10,
    color: COLORS.text,
    marginTop: 2,
  },
  // 注意:直向欄裡的 Text 千萬不能放 flex:1 — 會 collapse 成 0 高疊在一起
  sigTime: {
    fontSize: 7,
    color: COLORS.muted,
    marginTop: 2,
  },
  sigNone: {
    fontSize: 8,
    color: COLORS.muted,
    marginVertical: 14,
  },
  sigNotes: {
    marginTop: 6,
    border: `0.5pt solid ${COLORS.border}`,
    backgroundColor: COLORS.bgSoft,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  sigNoteLine: {
    fontSize: 8.5,
    marginBottom: 2,
  },
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  photoCell: {
    width: "32%",
    border: `0.5pt solid ${COLORS.border}`,
    padding: 2,
    marginBottom: 6,
  },
  photoImg: {
    width: "100%",
    height: 110,
    objectFit: "cover",
  },
  photoCaption: {
    fontSize: 7,
    color: COLORS.muted,
    marginTop: 2,
  },
  footer: {
    position: "absolute",
    left: 32,
    right: 32,
    bottom: 14,
    fontSize: 7,
    color: COLORS.muted,
    textAlign: "center",
    borderTop: `0.5pt solid ${COLORS.border}`,
    paddingTop: 4,
  },
});

export type PdfWorkItem = {
  id: string;
  name: string;
  unit: string | null;
  tenderCode: string | null;
};

export type PdfPhoto = {
  /** data URL (data:image/jpeg;base64,...) — 由 generate.ts 把 storage object 抓下來轉成 base64 */
  dataUrl: string;
  caption?: string;
};

export type PdfApproval = LogApproval & {
  approverName: string | null;
  signatureDataUrl: string | null;
  /** 簽名圖原始長寬比(w/h)— 等比呈現用;讀不出來時 null(fallback 3:1) */
  signatureAspect?: number | null;
};

export type PdfWorkItemGroup = {
  /** 大項目名稱;null 表示該組只是 item 自己一筆,不畫 subheader */
  groupName: string | null;
  groupTenderCode: string | null;
  items: Array<{ wi: PdfWorkItem; qty: number; note?: string }>;
};

export type PdfData = {
  log: DailyLog;
  case: {
    name: string;
    code: string | null;
    company: string;
    location: string | null;
    expectedEnd: string | null;
  };
  daySeq: number;
  supervisorName: string;
  workItemGroups: PdfWorkItemGroup[];
  extraItems: DailyLogExtraItem[];
  unsignedItems: DailyLogUnsignedItem[];
  photos: PdfPhoto[];
  approvals: PdfApproval[];
};

export function DailyLogPdf({ data }: { data: PdfData }) {
  ensureFont();
  const { log, case: caseData, daySeq, supervisorName } = data;
  const reportNumber = buildReportNumber({
    caseCode: caseData.code,
    logDate: log.log_date,
    daySeq,
  });
  const dateLabel = `${log.log_date} ${getWeekdayLabel(log.log_date)}`;
  const isBackfill = isBackfilledLog(log);

  return (
    <Document
      title={`施工日誌 ${reportNumber}`}
      author="裕民工務"
      creator="Yu Min Admin"
      producer="Yu Min Admin"
    >
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>裕民工務 — 施工日誌</Text>
          <View style={styles.headerMeta}>
            <Text style={styles.headerMetaItem}>表報編號：{reportNumber}</Text>
            <Text style={styles.headerMetaItem}>{dateLabel}</Text>
            <Text style={styles.headerMetaItem}>
              天氣:{formatWeatherSummary(log.weather)}
            </Text>
            {isBackfill && (
              <Text style={styles.headerMetaItem}>（補件）</Text>
            )}
          </View>
        </View>

        {/* 表頭資料 */}
        <Text style={styles.sectionTitle}>表頭資料</Text>
        <View style={styles.twoCol}>
          <Cell label="工程名稱" value={caseData.name} />
          <Cell label="承攬廠商名稱" value={caseData.company} />
          <Cell label="施工地點" value={caseData.location ?? "—"} />
          <Cell label="預定完工日期" value={caseData.expectedEnd ?? "—"} />
          <Cell label="工地主任" value={supervisorName} />
          <Cell
            label="本日／累計出工"
            value={`${log.manpower?.today_total ?? "—"} 人 / ${
              log.manpower?.accumulated_total ?? "—"
            } 人次`}
          />
        </View>

        {/* 包商人力 */}
        {log.manpower?.subcontractors && log.manpower.subcontractors.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>包商人力</Text>
            <SimpleTable
              cols={[
                { label: "工種", w: 0.55 },
                { label: "本日", w: 0.225 },
                { label: "累計", w: 0.225 },
              ]}
              rows={log.manpower.subcontractors.map((s) => [
                s.trade,
                String(s.today ?? "—"),
                String(s.accumulated ?? "—"),
              ])}
            />
          </>
        )}

        {/* 機具 */}
        {log.manpower?.machines && log.manpower.machines.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>機具</Text>
            <SimpleTable
              cols={[
                { label: "機具名稱", w: 0.55 },
                { label: "本日", w: 0.225 },
                { label: "累計", w: 0.225 },
              ]}
              rows={log.manpower.machines.map((m) => [
                m.name,
                String(m.today ?? "—"),
                String(m.accumulated ?? "—"),
              ])}
            />
          </>
        )}

        {/* 已勾選的合約工項（依大項分組） */}
        {data.workItemGroups.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>本日施作工項（合約內）</Text>
            <GroupedItemsTable groups={data.workItemGroups} />
          </>
        )}

        {/* 額外施作（合約外） */}
        {data.extraItems.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>合約外額外施作</Text>
            <SimpleTable
              cols={[
                { label: "項目", w: 0.36 },
                { label: "單位/數量/人數", w: 0.2 },
                { label: "位置", w: 0.18 },
                { label: "甲方交辦", w: 0.13 },
                { label: "事由", w: 0.13 },
              ]}
              rows={data.extraItems.map((e) => [
                e.name,
                `${e.unit ?? "—"} / ${e.qty ?? "—"} / ${e.headcount ?? "—"}`,
                e.location ?? "—",
                e.requested_by ?? "—",
                e.reason ?? "—",
              ])}
            />
          </>
        )}

        {/* 未簽約 / 點工 */}
        {data.unsignedItems.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>尚未簽約／報價（點工或變更追加）</Text>
            <SimpleTable
              cols={[
                { label: "項目", w: 0.32 },
                { label: "類別", w: 0.13 },
                { label: "單位/數量/人數", w: 0.22 },
                { label: "報價金額", w: 0.13 },
                { label: "事由", w: 0.2 },
              ]}
              rows={data.unsignedItems.map((u) => [
                u.name,
                u.category ?? "—",
                `${u.unit ?? "—"} / ${u.qty ?? "—"} / ${u.headcount ?? "—"}`,
                u.quote_amount ? `NT$ ${u.quote_amount.toLocaleString()}` : "—",
                u.reason ?? "—",
              ])}
            />
          </>
        )}

        {/* 廠商通知 */}
        {log.vendor_notices && log.vendor_notices.trim() && (
          <>
            <Text style={styles.sectionTitle}>廠商通知</Text>
            <View style={styles.notesBox}>
              <Text>{log.vendor_notices}</Text>
            </View>
          </>
        )}

        {/* 備註 */}
        {log.notes && log.notes.trim() && (
          <>
            <Text style={styles.sectionTitle}>備註</Text>
            <View style={styles.notesBox}>
              <Text>{log.notes}</Text>
            </View>
          </>
        )}

        {/* 簽核紀錄 — 紙本表單式簽章欄:每關最後一次「通過」一格並排;
            意見 / 退回歷程另起整行寬(核定備註是選填,有寫才出現,多長都放得下) */}
        {data.approvals.length > 0 && (() => {
          const latestByStage = new Map<string, PdfApproval>();
          for (const ap of data.approvals) {
            // approvals 依時間升冪 — 後面的自然蓋掉前面(退回重送會重簽)
            if (ap.decision === "approved") latestByStage.set(ap.stage, ap);
          }
          const cells = STAGE_ORDER.filter((s) => latestByStage.has(s)).map(
            (s) => latestByStage.get(s)!,
          );
          const notes = data.approvals.filter(
            (ap) => ap.comment || ap.decision === "rejected",
          );
          return (
            <>
              <Text style={styles.sectionTitle}>簽核紀錄</Text>
              <View style={styles.sigGrid}>
                {cells.map((ap) => (
                  <View key={ap.id} style={styles.sigCell}>
                    <Text style={styles.sigStage}>{STAGE_LABEL[ap.stage]}</Text>
                    <Text style={styles.sigName}>{ap.approverName ?? "—"}</Text>
                    {ap.signatureDataUrl ? (
                      // 寬高都要明給:react-pdf 只給單邊會拉滿容器(非等比)。
                      // 格寬約 120pt,簽名以高 30pt 等比、寬上限 104pt
                      (() => {
                        const aspect = ap.signatureAspect ?? 3;
                        const width = Math.min(104, 30 * aspect);
                        const height = width / aspect;
                        return (
                          <Image
                            src={ap.signatureDataUrl}
                            style={{ width, height, marginVertical: 4 }}
                          />
                        );
                      })()
                    ) : (
                      <Text style={styles.sigNone}>（無簽名）</Text>
                    )}
                    <Text style={styles.sigTime}>{formatTW(ap.created_at)}</Text>
                  </View>
                ))}
              </View>
              {notes.length > 0 && (
                <View style={styles.sigNotes}>
                  {notes.map((ap) => (
                    <Text key={`note-${ap.id}`} style={styles.sigNoteLine}>
                      {formatTW(ap.created_at)}｜{STAGE_LABEL[ap.stage]}
                      {ap.decision === "rejected" ? "退回原因" : "意見"}：
                      {ap.comment || "（未填）"}
                    </Text>
                  ))}
                </View>
              )}
            </>
          );
        })()}

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `${reportNumber}  ·  第 ${pageNumber} / ${totalPages} 頁  ·  本檔由系統自動產生於核定通過時`
          }
          fixed
        />
      </Page>

      {/* 照片頁 — 9 宮格 */}
      {data.photos.length > 0 && (
        <Page size="A4" style={styles.page}>
          <Text style={styles.sectionTitle}>工地照片（{data.photos.length} 張）</Text>
          <View style={styles.photoGrid}>
            {data.photos.map((p, i) => (
              <View key={i} style={styles.photoCell}>
                <Image src={p.dataUrl} style={styles.photoImg} />
                {p.caption && (
                  <Text style={styles.photoCaption}>{p.caption}</Text>
                )}
              </View>
            ))}
          </View>
          <Text
            style={styles.footer}
            render={({ pageNumber, totalPages }) =>
              `${reportNumber}  ·  第 ${pageNumber} / ${totalPages} 頁`
            }
            fixed
          />
        </Page>
      )}
    </Document>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      <Text style={styles.cellValue}>{value || "—"}</Text>
    </View>
  );
}

function GroupedItemsTable({ groups }: { groups: PdfWorkItemGroup[] }) {
  const cols = [
    { label: "項次", w: 0.18 },
    { label: "工項名稱", w: 0.5 },
    { label: "單位", w: 0.1 },
    { label: "本日完成量", w: 0.22 },
  ];
  return (
    <View style={styles.table}>
      <View style={styles.tr}>
        {cols.map((c, i) => (
          <Text key={i} style={[styles.th, { width: `${c.w * 100}%` }]}>
            {c.label}
          </Text>
        ))}
      </View>
      {groups.map((g, gi) => (
        <View key={gi}>
          {g.groupName && (
            <View style={styles.tr}>
              <Text
                style={[
                  styles.td,
                  {
                    width: "100%",
                    backgroundColor: COLORS.bgSoft,
                    color: COLORS.primary,
                    fontWeight: "bold",
                  },
                ]}
              >
                大項：
                {g.groupTenderCode ? `${g.groupTenderCode}  ` : ""}
                {g.groupName}
              </Text>
            </View>
          )}
          {g.items.map(({ wi, qty, note }, ri) => (
            <View key={ri} style={styles.tr}>
              <Text style={[styles.td, { width: `${cols[0].w * 100}%` }]}>
                {wi.tenderCode ?? "—"}
              </Text>
              <Text style={[styles.td, { width: `${cols[1].w * 100}%` }]}>
                {note ? `${wi.name}\n附註： ${note}` : wi.name}
              </Text>
              <Text style={[styles.td, { width: `${cols[2].w * 100}%` }]}>
                {wi.unit ?? "—"}
              </Text>
              <Text style={[styles.td, { width: `${cols[3].w * 100}%` }]}>
                {String(qty)}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function SimpleTable({
  cols,
  rows,
}: {
  cols: { label: string; w: number }[];
  rows: string[][];
}) {
  return (
    <View style={styles.table}>
      <View style={styles.tr}>
        {cols.map((c, i) => (
          <Text key={i} style={[styles.th, { width: `${c.w * 100}%` }]}>
            {c.label}
          </Text>
        ))}
      </View>
      {rows.map((row, i) => (
        <View key={i} style={styles.tr}>
          {row.map((cell, j) => (
            <Text key={j} style={[styles.td, { width: `${(cols[j]?.w ?? 0.25) * 100}%` }]}>
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

const STAGE_LABEL: Record<string, string> = {
  fill: "填表（工地主任）",
  review: "複核（工地主任）",
  audit: "審核（辦公室助理）",
  approve: "核定（老闆）",
};
/** 簽章欄固定順序(有該關紀錄才出格) */
const STAGE_ORDER = ["fill", "review", "audit", "approve"] as const;
