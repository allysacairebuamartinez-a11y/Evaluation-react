import { jsx } from "react/jsx-runtime";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./school-theme.css";
createRoot(document.getElementById("root")).render(/* @__PURE__ */ jsx(StrictMode, { children: /* @__PURE__ */ jsx(App, {}) }));
