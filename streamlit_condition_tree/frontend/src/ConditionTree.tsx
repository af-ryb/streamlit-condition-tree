import { useState, useEffect, useMemo, useCallback, useRef } from "react"
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

interface ConditionTreeData {
  config: Record<string, any>
  return_type: string
  tree: any | null
  placeholder: string
  always_show_buttons: boolean
}

interface Props {
  data: ConditionTreeData
  setStateValue: (name: string, value: any) => void
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

const getStreamlitTheme = () => {
  const s = getComputedStyle(document.documentElement)
  const primaryColor = s.getPropertyValue("--primary-color").trim()
  const font = s.getPropertyValue("--font").trim()

  // Detect dark mode via Streamlit's data attribute or color scheme
  const isDark =
    document.documentElement.getAttribute("data-theme") === "dark" ||
    document.body.classList.contains("dark") ||
    s.getPropertyValue("color-scheme").trim().includes("dark") ||
    window.matchMedia("(prefers-color-scheme: dark)").matches

  return {
    primaryColor: primaryColor || "#ff4b4b",
    font: font || "Source Sans Pro, sans-serif",
    base: isDark ? "dark" : "light",
  }
}

function ConditionTree({ data, setStateValue }: Props) {
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

      // Send sanitized values to Python
      const exportFunc = exportFunctions[returnTypeRef.current]
      const exportValue = exportFunc ? exportFunc(checkedTree, newConfig) : ""
      let outputTree: JsonTree = QbUtils.getTree(checkedTree)
      unformatTree(outputTree)
      setStateValue("output_tree", outputTree)
      setStateValue("value", exportValue)
    }
  })

  // Debounced function to send value to Streamlit
  const sendValue = useCallback(
    (immutableTree: ImmutableTree) => {
      const exportFunc = exportFunctions[returnTypeRef.current]
      const exportValue = exportFunc
        ? exportFunc(immutableTree, config)
        : ""

      let outputTree: JsonTree = QbUtils.getTree(immutableTree)
      unformatTree(outputTree)
      setStateValue("output_tree", outputTree)
      setStateValue("value", exportValue)
    },
    [config, setStateValue]
  )

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

  // Read theme from Streamlit CSS variables
  const theme = useMemo(getStreamlitTheme, [])

  const onChange = useCallback(
    (immutableTree: ImmutableTree) => {
      setTree(immutableTree)
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

  return (
    <div>
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: theme.primaryColor,
            fontFamily: theme.font,
            fontSize: 16,
            controlHeight: 38,
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
