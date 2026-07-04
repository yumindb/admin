"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <html lang="zh-Hant">
      <body
        style={{
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', 'Microsoft JhengHei', sans-serif",
          background: "#F5F1EC",
          color: "#5A5050",
          minHeight: "100vh",
          margin: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
        }}
      >
        <div
          style={{
            maxWidth: "32rem",
            width: "100%",
            background: "white",
            border: "1px solid #E0DCD6",
            borderRadius: "6px",
            padding: "2rem",
          }}
        >
          <p
            style={{
              fontSize: "0.875rem",
              letterSpacing: "0.1em",
              color: "#A07850",
              margin: 0,
            }}
          >
            SYSTEM ERROR
          </p>
          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: 600,
              color: "#1A1A1A",
              margin: "0.5rem 0 0.75rem",
            }}
          >
            系統發生錯誤
          </h1>
          <p style={{ fontSize: "1rem", color: "#5A5050", margin: 0 }}>
            系統發生未預期錯誤，請重試一次。若持續發生，請把下方錯誤代碼回報給管理員。
          </p>
          {error?.digest ? (
            <div
              style={{
                marginTop: "1.25rem",
                padding: "0.75rem",
                background: "#F5F1EC",
                border: "1px solid #E0DCD6",
                borderRadius: "6px",
              }}
            >
              <p style={{ fontSize: "0.75rem", color: "#8A847C", margin: 0 }}>
                錯誤代碼
              </p>
              <p
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: "0.875rem",
                  color: "#5A5050",
                  margin: "0.25rem 0 0",
                  wordBreak: "break-all",
                }}
              >
                {error.digest}
              </p>
            </div>
          ) : null}
          <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button
              onClick={() => reset()}
              style={{
                background: "#003153",
                color: "white",
                border: "none",
                borderRadius: "6px",
                padding: "0.5rem 1rem",
                fontSize: "0.875rem",
                cursor: "pointer",
              }}
            >
              重試
            </button>
            {/* global-error 取代整個 root layout,App Router context 不存在,
                不能用 next/link — 這裡的原生 <a> 是官方建議寫法 */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                background: "white",
                color: "#003153",
                border: "1px solid #E0DCD6",
                borderRadius: "6px",
                padding: "0.5rem 1rem",
                fontSize: "0.875rem",
                textDecoration: "none",
              }}
            >
              回首頁
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
