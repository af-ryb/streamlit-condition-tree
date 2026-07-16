import type { Config } from "@react-awesome-query-builder/antd"

// Per-rule completeness gate, mirroring dash_app's `_rule_contributes`
// (dash_app/src/semantic/tree_filter.py): a rule yields a predicate only when
// its field is known and its value is filled in for the operator's arity.
//
// Unlike `QbUtils.isValidTree` (a coarse whole-tree check that would block an
// already-complete rule while a sibling is mid-edit), this judges each rule on
// its own. The operator categories are driven off RAWB operator `cardinality`
// so every operator the config supports is covered — not just dash_app's subset:
//   cardinality 0  -> is_null / is_not_null / is_empty / is_not_empty (no value)
//   cardinality 2  -> between / not_between (both bounds required)
//   cardinality 1  -> scalar ops, and select/multiselect ops whose single value
//                     slot holds the array of choices.

// Mirrors `_scalar_value` / `_scalar_pair` / `_select_values` emptiness rules:
// null / undefined / "" are empty; an array is non-empty only if it holds at
// least one non-empty entry (so `[["", ""]]` and `[]` count as empty). Numeric
// 0 and boolean false are intentionally kept.
const nonEmpty = (v: any): boolean => {
  if (v === undefined || v === null || v === "") return false
  if (Array.isArray(v))
    return v.some((x) => x !== undefined && x !== null && x !== "")
  return true
}

// The leaf field paths a rule can address, mirroring `_valid_field_paths` in
// __init__.py. Grouped fields ('!group' / '!struct') keep their leaves in
// `subfields` and rules address them by full path ('ads.ads_1'), so the group
// names themselves are not valid rule fields. Flat configs yield their own keys.
const collectFieldPaths = (fields: any, separator: string): Set<string> => {
  const paths = new Set<string>()
  for (const [name, fieldConfig] of Object.entries(fields ?? {})) {
    const subfields = (fieldConfig as any)?.subfields
    if (subfields && typeof subfields === "object") {
      for (const path of collectFieldPaths(subfields, separator))
        paths.add(`${name}${separator}${path}`)
    } else {
      paths.add(name)
    }
  }
  return paths
}

export const ruleContributes = (
  field: any,
  operator: any,
  value: any,
  config: Config
): boolean => {
  if (!field) return false
  // Unmapped field (mirror of dash_app's `field not in col_by_field`).
  const separator = (config as any)?.settings?.fieldSeparator ?? "."
  if (config?.fields && !collectFieldPaths(config.fields, separator).has(field))
    return false

  const opDef = operator ? (config?.operators as any)?.[operator] : undefined
  // Unknown / unset operator -> no predicate.
  if (!opDef) return false

  const cardinality = opDef.cardinality ?? 1
  if (cardinality === 0) return true
  if (cardinality >= 2) return nonEmpty(value?.[0]) && nonEmpty(value?.[1])
  return nonEmpty(value?.[0])
}

// Walk a JsonTree (RAWB's internal `children1` shape, as returned by
// `QbUtils.getTree`), keeping only rules that contribute a predicate and
// dropping groups left empty. Surviving nodes keep their `id` / `properties` /
// children-container shape. Mirrors `_prune_node`. Returns null for an empty
// (non-root) node.
const pruneNode = (node: any, config: Config): any | null => {
  if (!node || typeof node !== "object") return null

  if (node.type === "rule") {
    const p = node.properties || {}
    return ruleContributes(p.field, p.operator, p.value, config) ? node : null
  }

  // group / rule_group / rule_group_ext
  const key = node.children1 !== undefined ? "children1" : "children"
  const children = node[key]

  if (Array.isArray(children)) {
    const kept = children
      .map((c) => pruneNode(c, config))
      .filter((c) => c != null)
    if (kept.length === 0) return null
    return { ...node, [key]: kept }
  }

  if (children && typeof children === "object") {
    const kept: Record<string, any> = {}
    for (const [cid, child] of Object.entries(children)) {
      const pruned = pruneNode(child, config)
      if (pruned != null) kept[cid] = pruned
    }
    if (Object.keys(kept).length === 0) return null
    return { ...node, [key]: kept }
  }

  // Group with no children -> empty.
  return null
}

// Prune incomplete rules from a tree. The root group is always preserved (an
// all-incomplete tree collapses to an empty root group, matching the
// no-conditions state) so the result is always a valid tree to emit.
export const pruneIncompleteRules = (tree: any, config: Config): any => {
  const pruned = pruneNode(tree, config)
  if (pruned != null) return pruned
  const { children1: _c1, children: _c, ...rest } = tree || {}
  return { ...rest, children1: [] }
}
