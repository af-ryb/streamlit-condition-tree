import { describe, expect, it } from "vitest"

import { pruneIncompleteRules, ruleContributes } from "./prune"

// `ruleContributes` only reads `fields` / `operators` / `settings` off the
// config, so a minimal literal stands in for a built RAWB Config.
const numberField = () => ({ type: "number", valueSources: ["value"] })

const operators = {
  greater: { cardinality: 1 },
  between: { cardinality: 2 },
  is_null: { cardinality: 0 },
}

// Mirrors web_app/web/dashboards/cohort/condition_filter.py in shape.
const GROUPED_CONFIG: any = {
  fields: {
    ads: {
      type: "!group",
      subfields: { ads_1: numberField(), ads_7: numberField() },
    },
    iap: { type: "!group", subfields: { iap_total: numberField() } },
  },
  operators,
}

const FLAT_CONFIG: any = {
  fields: { revenue: numberField(), installs: numberField() },
  operators,
}

const rule = (field: string, operator = "greater", value: any = [10]) => ({
  type: "rule",
  properties: { field, operator, value },
})

const fieldsOf = (node: any): string[] => {
  if (!node || typeof node !== "object") return []
  if (node.type === "rule") return [node.properties.field]
  const key = node.children1 !== undefined ? "children1" : "children"
  const children = node[key]
  const list = Array.isArray(children) ? children : Object.values(children ?? {})
  return list.flatMap(fieldsOf)
}

describe("ruleContributes — grouped configs", () => {
  it("accepts a rule addressing a group leaf by dot path", () => {
    // The `!(field in config.fields)` check judged `ads.ads_1` unknown, so a
    // fully-built rule was pruned as "incomplete" and never reached Streamlit.
    expect(ruleContributes("ads.ads_1", "greater", [10], GROUPED_CONFIG)).toBe(true)
    expect(ruleContributes("iap.iap_total", "greater", [10], GROUPED_CONFIG)).toBe(true)
  })

  it("rejects a rule addressing an unknown leaf", () => {
    expect(ruleContributes("ads.ads_999", "greater", [10], GROUPED_CONFIG)).toBe(false)
  })

  it("rejects a bare group name, which carries no predicate", () => {
    expect(ruleContributes("ads", "greater", [10], GROUPED_CONFIG)).toBe(false)
  })

  it("still applies the value-completeness rules inside groups", () => {
    expect(ruleContributes("ads.ads_1", "greater", [], GROUPED_CONFIG)).toBe(false)
    expect(ruleContributes("ads.ads_1", "greater", [null], GROUPED_CONFIG)).toBe(false)
    expect(ruleContributes("ads.ads_1", "is_null", [], GROUPED_CONFIG)).toBe(true)
    expect(ruleContributes("ads.ads_1", "between", [1], GROUPED_CONFIG)).toBe(false)
    expect(ruleContributes("ads.ads_1", "between", [1, 5], GROUPED_CONFIG)).toBe(true)
  })

  it("honours a custom fieldSeparator", () => {
    const config = { ...GROUPED_CONFIG, settings: { fieldSeparator: "/" } }
    expect(ruleContributes("ads/ads_1", "greater", [10], config)).toBe(true)
    expect(ruleContributes("ads.ads_1", "greater", [10], config)).toBe(false)
  })
})

describe("ruleContributes — flat configs (must not regress)", () => {
  it("accepts a known column", () => {
    expect(ruleContributes("revenue", "greater", [10], FLAT_CONFIG)).toBe(true)
  })

  it("rejects a column that is no longer in the frame", () => {
    expect(ruleContributes("legacy_col", "greater", [10], FLAT_CONFIG)).toBe(false)
  })

  it("rejects an empty field, unknown operator, or empty value", () => {
    expect(ruleContributes("", "greater", [10], FLAT_CONFIG)).toBe(false)
    expect(ruleContributes("revenue", "nope", [10], FLAT_CONFIG)).toBe(false)
    expect(ruleContributes("revenue", "greater", [""], FLAT_CONFIG)).toBe(false)
  })

  it("keeps falsy-but-real values", () => {
    expect(ruleContributes("revenue", "greater", [0], FLAT_CONFIG)).toBe(true)
    expect(ruleContributes("revenue", "greater", [false], FLAT_CONFIG)).toBe(true)
  })
})

describe("pruneIncompleteRules", () => {
  it("keeps complete grouped rules and drops incomplete ones", () => {
    const tree = {
      type: "group",
      children1: [rule("ads.ads_1"), rule("iap.iap_total", "greater", [])],
    }

    expect(fieldsOf(pruneIncompleteRules(tree, GROUPED_CONFIG))).toEqual(["ads.ads_1"])
  })

  it("drops rules referencing a vanished flat column", () => {
    const tree = { type: "group", children1: [rule("revenue"), rule("legacy_col")] }

    expect(fieldsOf(pruneIncompleteRules(tree, FLAT_CONFIG))).toEqual(["revenue"])
  })

  it("collapses an all-incomplete tree to an empty root group", () => {
    const tree = { type: "group", children1: [rule("ads.ads_999")] }

    expect(pruneIncompleteRules(tree, GROUPED_CONFIG)).toEqual({
      type: "group",
      children1: [],
    })
  })
})
