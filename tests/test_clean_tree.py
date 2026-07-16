"""Tests for preselect-tree sanitization (`_clean_tree` / `_valid_field_paths`).

Two behaviours are in tension here and both are load-bearing:

* Grouped configs (`"type": "!group"` / `"!struct"` + `subfields`) address their
  leaves by dot path (`ads.ads_1`), so those rules must SURVIVE cleaning.
* Flat configs built from the columns of a live frame must still DROP rules that
  reference a column that has since disappeared — that is the whole reason rule
  cleaning exists (block filters, `return_type="jsonLogic"`).
"""

import pytest

from streamlit_condition_tree import _clean_tree, _valid_field_paths


def rule(field, operator="greater", value=None):
    return {
        "type": "rule",
        "properties": {
            "field": field,
            "operator": operator,
            "value": [10] if value is None else value,
            "valueSrc": ["value"],
            "valueType": ["number"],
        },
    }


def group(*children, children_key="children"):
    return {
        "type": "group",
        "id": "root",
        "properties": {"conjunction": "AND"},
        children_key: {f"rule{i}": c for i, c in enumerate(children)},
    }


def number_field():
    return {"type": "number", "valueSources": ["value"]}


# Mirrors web_app/web/dashboards/cohort/condition_filter.py in shape.
GROUPED_CONFIG = {
    "fields": {
        "ads": {
            "label": "Ads Revenue",
            "type": "!group",
            "subfields": {"ads_1": number_field(), "ads_7": number_field()},
        },
        "iap": {
            "label": "IAP Revenue",
            "type": "!group",
            "subfields": {"iap_total": number_field(), "iap_1": number_field()},
        },
    }
}

FLAT_CONFIG = {"fields": {"revenue": number_field(), "installs": number_field()}}


def field_names(tree, children_key="children"):
    """Fields of every surviving rule, depth-first."""
    if not isinstance(tree, dict):
        return []
    if tree.get("type") == "rule":
        return [tree["properties"]["field"]]
    key = "children1" if "children1" in tree else children_key
    children = tree.get(key) or {}
    values = children.values() if isinstance(children, dict) else children
    return [f for c in values for f in field_names(c, children_key)]


# --- the bug: grouped configs ------------------------------------------------


def test_grouped_config_keeps_rules_addressing_subfields():
    """Rules addressing group leaves by dot path must survive.

    This is the 5.4 regression: `valid_fields` was the set of top-level group
    names (`ads`, `iap`), which no rule field ever equals, so every rule was
    dropped and the preselect form opened empty.
    """
    tree = group(rule("ads.ads_1"), rule("iap.iap_total"))

    cleaned = _clean_tree(tree, GROUPED_CONFIG)

    assert field_names(cleaned) == ["ads.ads_1", "iap.iap_total"]


def test_grouped_config_drops_rule_referencing_missing_subfield():
    """Cleaning still applies inside groups — an unknown leaf goes."""
    tree = group(rule("ads.ads_1"), rule("ads.ads_999"))

    cleaned = _clean_tree(tree, GROUPED_CONFIG)

    assert field_names(cleaned) == ["ads.ads_1"]


def test_grouped_config_drops_rule_referencing_group_name_as_leaf():
    """A bare group name is not a leaf and cannot carry a predicate."""
    tree = group(rule("ads"))

    cleaned = _clean_tree(tree, GROUPED_CONFIG)

    assert field_names(cleaned) == []


# --- the constraint that must not break: flat configs ------------------------


def test_flat_config_drops_rule_with_vanished_column():
    """Block filters depend on this: a stored tree referencing a column that is
    no longer in the frame must be cleaned out."""
    tree = group(rule("revenue"), rule("deleted_column"))

    cleaned = _clean_tree(tree, FLAT_CONFIG)

    assert field_names(cleaned) == ["revenue"]


def test_flat_config_valid_paths_are_exactly_the_field_keys():
    """The doc's invariant: on a flat config the recursive walk returns the same
    set as the old `set(fields.keys())`, so nothing changes for block filters."""
    assert _valid_field_paths(FLAT_CONFIG["fields"]) == set(FLAT_CONFIG["fields"])


def test_flat_config_keeps_all_known_rules():
    tree = group(rule("revenue"), rule("installs"))

    cleaned = _clean_tree(tree, FLAT_CONFIG)

    assert field_names(cleaned) == ["revenue", "installs"]


# --- path derivation ---------------------------------------------------------


def test_valid_field_paths_of_grouped_config():
    assert _valid_field_paths(GROUPED_CONFIG["fields"]) == {
        "ads.ads_1",
        "ads.ads_7",
        "iap.iap_total",
        "iap.iap_1",
    }


def test_valid_field_paths_nested_structs():
    """`!struct` nests arbitrarily deep; paths join at every level."""
    fields = {
        "a": {
            "type": "!struct",
            "subfields": {
                "b": {"type": "!struct", "subfields": {"c": number_field()}},
                "d": number_field(),
            },
        }
    }

    assert _valid_field_paths(fields) == {"a.b.c", "a.d"}


def test_valid_field_paths_mixed_flat_and_grouped():
    fields = {
        "plain": number_field(),
        "grp": {"type": "!group", "subfields": {"leaf": number_field()}},
    }

    assert _valid_field_paths(fields) == {"plain", "grp.leaf"}


def test_valid_field_paths_honours_custom_separator():
    """RAWB's `settings.fieldSeparator` defaults to '.' but is configurable;
    dot-joining a config that uses another separator would clean everything."""
    assert _valid_field_paths(GROUPED_CONFIG["fields"], separator="/") == {
        "ads/ads_1",
        "ads/ads_7",
        "iap/iap_total",
        "iap/iap_1",
    }


def test_clean_tree_honours_custom_separator_from_config():
    config = dict(GROUPED_CONFIG, settings={"fieldSeparator": "/"})
    tree = group(rule("ads/ads_1"))

    cleaned = _clean_tree(tree, config)

    assert field_names(cleaned) == ["ads/ads_1"]


@pytest.mark.parametrize("empty", [{}, None])
def test_valid_field_paths_empty_fields(empty):
    assert _valid_field_paths(empty) == set()


def test_group_with_empty_subfields_contributes_no_paths():
    assert _valid_field_paths({"grp": {"type": "!group", "subfields": {}}}) == set()


# --- tree shapes -------------------------------------------------------------


def test_children1_key_is_supported():
    """RAWB's internal shape uses `children1`."""
    tree = group(rule("ads.ads_1"), rule("nope.nope"), children_key="children1")

    cleaned = _clean_tree(tree, GROUPED_CONFIG)

    assert field_names(cleaned) == ["ads.ads_1"]


def test_list_children_are_supported():
    tree = {
        "type": "group",
        "children": [rule("ads.ads_1"), rule("gone.gone")],
    }

    cleaned = _clean_tree(tree, GROUPED_CONFIG)

    assert field_names(cleaned) == ["ads.ads_1"]


def test_rule_group_children_are_cleaned_not_the_group_itself():
    """`rule_group` nodes carry the group path in `properties.field`; only their
    child rules are field-checked."""
    tree = {
        "type": "group",
        "children": {
            "rg": {
                "type": "rule_group",
                "properties": {"field": "ads", "conjunction": "AND"},
                "children": {"r1": rule("ads.ads_1"), "r2": rule("ads.ads_999")},
            }
        },
    }

    cleaned = _clean_tree(tree, GROUPED_CONFIG)

    assert cleaned["children"]["rg"]["type"] == "rule_group"
    assert field_names(cleaned) == ["ads.ads_1"]


def test_nested_groups_are_cleaned_recursively():
    tree = {
        "type": "group",
        "children": {
            "sub": {
                "type": "group",
                "properties": {"conjunction": "OR"},
                "children": {"r1": rule("ads.ads_1"), "r2": rule("gone.gone")},
            }
        },
    }

    cleaned = _clean_tree(tree, GROUPED_CONFIG)

    assert field_names(cleaned) == ["ads.ads_1"]


def test_rule_without_field_is_kept():
    """A half-built rule (no field picked yet) is not a stale reference."""
    tree = group({"type": "rule", "properties": {"operator": None, "value": []}})

    cleaned = _clean_tree(tree, GROUPED_CONFIG)

    assert cleaned["children"]["rule0"]["type"] == "rule"


def test_non_dict_tree_is_returned_unchanged():
    assert _clean_tree(None, GROUPED_CONFIG) is None
