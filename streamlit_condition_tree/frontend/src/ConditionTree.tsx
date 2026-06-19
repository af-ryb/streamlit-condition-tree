import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  type CSSProperties,
} from "react"
import _ from "lodash"

import type {
  BuilderProps,
  Config,
  ImmutableTree,
  JsonGroup,
  JsonTree,
} from "@react-awesome-query-builder/antd"
import {
  Builder,
  Query,
  Utils as QbUtils,
} from "@react-awesome-query-builder/antd"
import { ConfigProvider, theme as antdTheme } from "antd"
import "@react-awesome-query-builder/antd/css/styles.css"
import "./style.css"
import "@fontsource/source-sans-pro"
import { defaultConfig } from "./config"
import { deepMap } from "./utils"
import { pruneIncompleteRules } from "./prune"

interface ConditionTreeData {
  config: Record<string, any>
  return_type: string
  tree: any | null
  placeholder: string
  always_show_buttons: boolean
  emit_complete_only: boolean
}

interface Props {
  data: ConditionTreeData
  setStateValue: (name: string, value: any) => void
  // The component's instance wrapper element. Streamlit v2 exposes the theme as
  // `--st-*` custom properties that inherit down to it (see getStreamlitTheme).
  wrapperEl: HTMLElement
}

const defaultTree: JsonGroup = {
  type: "group",
  id: QbUtils.uuid(),
}

const exportFunctions: Record<string, Function> = {
  queryString: QbUtils.queryString,
  mongodb: QbUtils.mongodbFormat,
  sql: QbUtils.sqlFormat,
  spel: QbUtils.spelFormat,
  elasticSearch: QbUtils.elasticSearchFormat,
  jsonLogic: QbUtils.jsonLogicFormat,
}

const formatTree = (tree: any) => {
  tree.id = QbUtils.uuid()
  if (tree.children) {
    tree.children1 = tree.children
    delete tree.children
    tree.children1.forEach(formatTree)
  }
}

const unformatTree = (tree: any) => {
  delete tree.id
  if (tree.children1) {
    tree.children = tree.children1
    delete tree.children1
    tree.children.forEach(unformatTree)
  }
}

const parseJsCodeFromPython = (v: string) => {
  const JS_PLACEHOLDER = "::JSCODE::"

  let funcReg = new RegExp(
    `${JS_PLACEHOLDER}\\s*((function|class)\\s*.*)\\s*${JS_PLACEHOLDER}`
  )

  let match = funcReg.exec(v)

  if (match) {
    const funcStr = match[1]
    // eslint-disable-next-line
    return new Function("return " + funcStr)()
  } else {
    return v
  }
}

// Parse a CSS color (hex #rgb/#rrggbb or rgb()/rgba()) into RGB channels.
// Returns null when the value can't be parsed (e.g. named colors, empty).
const parseColor = (value: string): { r: number; g: number; b: number } | null => {
  const v = value.trim()
  if (!v) return null

  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    }
  }

  const rgb = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i)
  if (rgb) {
    return { r: +rgb[1], g: +rgb[2], b: +rgb[3] }
  }

  return null
}

// Perceived luminance on a 0-255 scale (Rec. 709 coefficients).
const luminance = ({ r, g, b }: { r: number; g: number; b: number }) =>
  0.2126 * r + 0.7152 * g + 0.0722 * b

// Blend two CSS colors; t=0 -> a, t=1 -> b. Returns an rgb() string.
const mix = (a: string, b: string, t: number): string => {
  const c1 = parseColor(a)
  const c2 = parseColor(b)
  if (!c1 || !c2) return a
  const ch = (x: number, y: number) => Math.round(x + (y - x) * t)
  return `rgb(${ch(c1.r, c2.r)}, ${ch(c1.g, c2.g)}, ${ch(c1.b, c2.b)})`
}

// Parse a CSS length (px/rem/em or unitless) to a px number for Ant Design
// tokens. rem/em are approximated at 16px. Falls back when unparseable.
const radiusToPx = (v: string, fallback = 8): number => {
  const m = (v || "").trim().match(/^([\d.]+)(px|rem|em)?$/)
  if (!m) return fallback
  const n = parseFloat(m[1])
  if (isNaN(n)) return fallback
  return m[2] === "rem" || m[2] === "em" ? n * 16 : n
}

const TRANSPARENT = new Set(["transparent", "rgba(0, 0, 0, 0)", ""])

// First opaque, parseable background-color walking the app's root chain.
// Streamlit doesn't expose its palette as CSS variables in every version, but
// it does paint the page background — that's our reliable theme signal.
const firstOpaqueBackground = (): string => {
  const candidates: (Element | null)[] = [
    document.body,
    document.querySelector(".stApp"),
    document.documentElement,
  ]
  for (const el of candidates) {
    if (!el) continue
    const c = getComputedStyle(el).backgroundColor
    if (!TRANSPARENT.has(c) && parseColor(c)) return c
  }
  return ""
}

interface StreamlitTheme {
  primaryColor: string
  font: string
  base: "dark" | "light"
  textColor: string
  backgroundColor: string
  secondaryBackgroundColor: string
  borderColor: string
  baseRadius: string
}

// Read an `--st-*` theme custom property from `scope`, falling back to the
// legacy bare-named variable, then to "".
const readVar = (
  scope: CSSStyleDeclaration,
  stName: string,
  bareName?: string
): string => {
  const v = scope.getPropertyValue(stName).trim()
  if (v) return v
  return bareName ? scope.getPropertyValue(bareName).trim() : ""
}

const getStreamlitTheme = (el: HTMLElement): StreamlitTheme => {
  // Streamlit Components v2 exposes the active theme as `--st-*` custom
  // properties on the component's instance wrapper; they inherit down to `el`.
  // Older Streamlit versions used bare names (or no vars at all) — hence the
  // bare-name + page-background fallbacks below.
  const scope = getComputedStyle(el)
  const body = getComputedStyle(document.body)

  let backgroundColor =
    readVar(scope, "--st-background-color", "--background-color") ||
    firstOpaqueBackground()

  // Decide dark/light from the resolved background color — works regardless of
  // how the theme was selected (in-app settings, config.toml or OS). Fall back
  // to the older heuristics only when no background color can be parsed.
  const bg = parseColor(backgroundColor)
  const isDark =
    bg != null
      ? luminance(bg) < 128
      : document.documentElement.getAttribute("data-theme") === "dark" ||
        document.body.classList.contains("dark") ||
        getComputedStyle(document.documentElement)
          .getPropertyValue("color-scheme")
          .trim()
          .includes("dark") ||
        window.matchMedia("(prefers-color-scheme: dark)").matches

  if (!backgroundColor) backgroundColor = isDark ? "#0e1117" : "#ffffff"

  let textColor = readVar(scope, "--st-text-color", "--text-color") || body.color
  if (!textColor || TRANSPARENT.has(textColor))
    textColor = isDark ? "#fafafa" : "#31333f"

  // Secondary surface: Streamlit's var if present, else a subtle elevation of
  // the background toward the text color (approximates Streamlit's own
  // secondary background and adapts to custom themes).
  const secondaryBackgroundColor =
    readVar(
      scope,
      "--st-secondary-background-color",
      "--secondary-background-color"
    ) || mix(backgroundColor, textColor, isDark ? 0.1 : 0.045)

  // Border: prefer Streamlit's border color, else a subtle text-derived line.
  let borderColor = readVar(scope, "--st-border-color")
  if (!borderColor) {
    const c = parseColor(textColor)
    borderColor = c
      ? `rgba(${c.r}, ${c.g}, ${c.b}, 0.18)`
      : "rgba(128, 128, 128, 0.25)"
  }

  return {
    primaryColor:
      readVar(scope, "--st-primary-color", "--primary-color") || "#ff4b4b",
    font:
      readVar(scope, "--st-font", "--font") ||
      body.fontFamily ||
      "Source Sans Pro, sans-serif",
    base: isDark ? "dark" : "light",
    textColor,
    backgroundColor,
    secondaryBackgroundColor,
    borderColor,
    baseRadius: readVar(scope, "--st-base-radius") || "8px",
  }
}

function ConditionTree({ data, setStateValue, wrapperEl }: Props) {
  // Initialize config once from first render's data
  const [config, setConfig] = useState<Config>(() => {
    let userConfig = deepMap(data.config, parseJsCodeFromPython)
    return _.merge({}, defaultConfig, userConfig)
  })

  // Initialize tree once
  const [tree, setTree] = useState<ImmutableTree>(() => {
    let initialTree = QbUtils.loadTree(defaultTree)
    if (data.tree != null) {
      try {
        let inputTree = data.tree
        formatTree(inputTree)
        initialTree = QbUtils.checkTree(
          QbUtils.loadTree(inputTree),
          config
        )
      } catch (error) {
        console.error(error)
      }
    }
    return initialTree
  })

  // Track return_type via ref so debounced function always sees latest
  const returnTypeRef = useRef(data.return_type)
  returnTypeRef.current = data.return_type

  // When emit_complete_only is on, only rules that contribute a predicate are
  // emitted, and identical successive emits are suppressed — so picking a field
  // without a value yet doesn't trigger a Streamlit rerun/flicker.
  const emitCompleteOnly = !!data.emit_complete_only
  const lastEmittedRef = useRef<string | null>(null)

  // While a value-selection dropdown is open, hold emits and remember the latest
  // tree; flush once on close (see the popup observer effect below). Stops a
  // rerun firing on every option toggle while the user is still picking.
  const popupOpenRef = useRef(false)
  const pendingTreeRef = useRef<ImmutableTree | null>(null)

  // Send the (optionally pruned) tree + exported value back to Python. `cfg`
  // lets callers that just rebuilt the config (the field-keys effect) pass the
  // fresh config instead of the stale closed-over one.
  const sendValue = useCallback(
    (immutableTree: ImmutableTree, cfg?: Config) => {
      if (emitCompleteOnly && popupOpenRef.current) {
        // A selection popup is open — defer until it closes (flushed there).
        pendingTreeRef.current = immutableTree
        return
      }
      pendingTreeRef.current = null
      const c = cfg || config
      const exportFunc = exportFunctions[returnTypeRef.current]
      const exportValue = exportFunc ? exportFunc(immutableTree, c) : ""

      let outputTree: any = QbUtils.getTree(immutableTree)
      if (emitCompleteOnly) outputTree = pruneIncompleteRules(outputTree, c)
      unformatTree(outputTree)

      if (emitCompleteOnly) {
        // Suppress the round-trip (hence the rerun) when nothing that yields a
        // predicate actually changed.
        const sig = JSON.stringify(outputTree) + " " + exportValue
        if (sig === lastEmittedRef.current) return
        lastEmittedRef.current = sig
      }

      setStateValue("output_tree", outputTree)
      setStateValue("value", exportValue)
    },
    [config, setStateValue, emitCompleteOnly]
  )

  // Track previous field keys to detect config changes
  const prevFieldKeysRef = useRef(
    Object.keys(data.config?.fields || {}).sort().join('\0')
  )

  useEffect(() => {
    const currentFieldKeys = Object.keys(data.config?.fields || {}).sort().join('\0')
    if (currentFieldKeys !== prevFieldKeysRef.current) {
      prevFieldKeysRef.current = currentFieldKeys

      const userConfig = deepMap(data.config, parseJsCodeFromPython)
      const newConfig = _.merge({}, defaultConfig, userConfig)
      setConfig(newConfig)

      const checkedTree = QbUtils.checkTree(tree, newConfig)
      setTree(checkedTree)

      // Send sanitized values to Python with the freshly-built config.
      sendValue(checkedTree, newConfig)
    }
  })

  const debouncedSendValue = useMemo(
    () => _.debounce(sendValue, 300),
    [sendValue]
  )

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => debouncedSendValue.cancel()
  }, [debouncedSendValue])

  // Send initial value on mount
  useEffect(() => {
    sendValue(tree)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply CSS class for single-child rule groups (after each render)
  useEffect(() => {
    document
      .querySelectorAll(
        ".rule_group>.group--children:has(> :nth-child(1):last-child)"
      )
      .forEach((x) => x.classList.add("single-child"))
  })

  // Read theme from Streamlit CSS variables, and keep it in sync when the
  // user toggles Streamlit's theme (no remount needed).
  const [theme, setTheme] = useState<StreamlitTheme>(() =>
    getStreamlitTheme(wrapperEl)
  )

  useEffect(() => {
    const refresh = () =>
      setTheme((prev) => {
        const next = getStreamlitTheme(wrapperEl)
        const changed =
          next.base !== prev.base ||
          next.primaryColor !== prev.primaryColor ||
          next.font !== prev.font ||
          next.textColor !== prev.textColor ||
          next.backgroundColor !== prev.backgroundColor ||
          next.secondaryBackgroundColor !== prev.secondaryBackgroundColor ||
          next.borderColor !== prev.borderColor ||
          next.baseRadius !== prev.baseRadius
        return changed ? next : prev
      })

    // Streamlit updates CSS variables / classes on the root, body, the .stApp
    // container and the component's own wrapper when the active theme changes.
    const observer = new MutationObserver(refresh)
    const attributeFilter = ["style", "class", "data-theme"]
    const targets = [
      document.documentElement,
      document.body,
      document.querySelector(".stApp"),
      wrapperEl,
      wrapperEl.parentElement,
    ]
    targets.forEach(
      (el) => el && observer.observe(el, { attributes: true, attributeFilter })
    )

    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    mq.addEventListener("change", refresh)

    return () => {
      observer.disconnect()
      mq.removeEventListener("change", refresh)
    }
  }, [wrapperEl])

  // While a value-selection dropdown (antd Select) is open inside the widget,
  // hold emits and flush once when it closes — so scrolling / picking several
  // options in a multi-select popup doesn't fire a Streamlit rerun on every
  // toggle. Only active under emit_complete_only. Keyed off `.ant-select-open`
  // on the in-tree trigger (the dropdown panel itself is portaled out of our
  // subtree, so we can't observe it directly).
  useEffect(() => {
    if (!emitCompleteOnly) return
    const handle = () => {
      const open = !!wrapperEl.querySelector(".ant-select-open")
      if (open === popupOpenRef.current) return
      popupOpenRef.current = open
      if (!open && pendingTreeRef.current) {
        const pending = pendingTreeRef.current
        pendingTreeRef.current = null
        debouncedSendValue.cancel()
        sendValue(pending)
      }
    }
    const observer = new MutationObserver(handle)
    observer.observe(wrapperEl, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    })
    return () => observer.disconnect()
  }, [wrapperEl, emitCompleteOnly, sendValue, debouncedSendValue])

  const onChange = useCallback(
    (immutableTree: ImmutableTree) => {
      setTree(immutableTree)
      // Remember the latest tree so a popup-close flush has it even before the
      // debounce fires.
      pendingTreeRef.current = immutableTree
      debouncedSendValue(immutableTree)
    },
    [debouncedSendValue]
  )

  const renderBuilder = useCallback(
    (props: BuilderProps) => (
      <div className="query-builder-container">
        <div
          className={
            "query-builder " +
            (data.always_show_buttons ? "" : "qb-lite")
          }
        >
          <Builder {...props} />
        </div>
      </div>
    ),
    [data.always_show_buttons]
  )

  const treeData = QbUtils.getTree(tree)
  const empty = !treeData.children1 || !treeData.children1.length

  // Expose the resolved theme colors as CSS variables so the rules in
  // style.css (group/rule backgrounds, borders) resolve even on Streamlit
  // versions that don't define these variables themselves.
  const cssVars = {
    "--primary-color": theme.primaryColor,
    "--text-color": theme.textColor,
    "--background-color": theme.backgroundColor,
    "--secondary-background-color": theme.secondaryBackgroundColor,
    "--font": theme.font,
  } as CSSProperties

  return (
    <div style={cssVars}>
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: theme.primaryColor,
            fontFamily: theme.font,
            fontSize: 16,
            controlHeight: 38,
            borderRadius: radiusToPx(theme.baseRadius),
            // Match Streamlit's own colors so controls feel native rather
            // than using Ant Design's generic grey palette.
            colorText: theme.textColor,
            colorBgContainer: theme.secondaryBackgroundColor,
            colorBgElevated: theme.secondaryBackgroundColor,
            colorBorder: theme.borderColor,
          },
          algorithm:
            theme.base === "dark"
              ? antdTheme.darkAlgorithm
              : antdTheme.defaultAlgorithm,
        }}
      >
        <Query
          {...config}
          value={tree}
          onChange={onChange}
          renderBuilder={renderBuilder}
        />
        <p>{empty && data.placeholder}</p>
      </ConfigProvider>
    </div>
  )
}

export default ConditionTree
