import React from "react"
import { createRoot, Root } from "react-dom/client"
import type { FrontendRenderer } from "@streamlit/component-v2-lib"
import ConditionTree from "./ConditionTree"

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ConditionTree error:", error, info)
  }
  render() {
    if (this.state.hasError) {
      return <div style={{ color: "red", padding: "1em" }}>
        <strong>ConditionTree error:</strong> {this.state.error?.message}
      </div>
    }
    return this.props.children
  }
}

const rootMap = new Map<string, { root: Root; container: HTMLElement }>()

const render: FrontendRenderer = ({ data, key, setStateValue, parentElement }) => {
  let entry = rootMap.get(key)
  if (!entry) {
    const container = document.createElement("div")
    container.className = "st-condition-tree"
    parentElement.appendChild(container)
    const root = createRoot(container)
    entry = { root, container }
    rootMap.set(key, entry)
  } else if (!parentElement.contains(entry.container)) {
    parentElement.appendChild(entry.container)
  }

  entry.root.render(
    <ErrorBoundary>
      <ConditionTree data={data as any} setStateValue={setStateValue} />
    </ErrorBoundary>
  )

  return () => {
    entry!.root.unmount()
    entry!.container.remove()
    rootMap.delete(key)
  }
}

export default render
