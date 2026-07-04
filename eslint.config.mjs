import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 開發用一次性腳本(seed / e2e 截圖),不是產品程式碼
    "_work/**",
  ]),
  {
    rules: {
      // react-hooks v6 的 React Compiler 規則。兩條降為 warn 的原因:
      // - purity: 對 async Server Component 誤報(server 端每 request 執行,
      //   Date.now() 是合法用法,規則假設的是 client render 純度)
      // - set-state-in-effect: 既有 15 處是運作中的行為(草稿還原、離線佇列
      //   flush 等),整批重構風險大於收益;新程式碼仍看得到 warning,別再增加
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
      // 「memoization 無法保留」= compiler 跳過最佳化,不是 bug;既有一處在
      // attendance-client,行為正確,降為 warn
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
]);

export default eslintConfig;
