from pathlib import Path

import streamlit as st

_BUILD_DIR = Path(__file__).parent / "frontend" / "build"

_condition_tree_component = st.components.v2.component(
    name="streamlit_condition_tree",
    js=(_BUILD_DIR / "index.js").read_text(),
    css=(_BUILD_DIR / "style.css").read_text(),
    html="<div></div>",
    isolate_styles=False,
)

type_mapper = {
    'b': 'boolean',
    'i': 'number',
    'u': 'number',
    'f': 'number',
    'c': '',
    'm': '',
    'M': 'date',
    'O': 'text',
    'S': 'text',
    'U': 'text',
    'V': ''
}


# stole from https://github.com/andfanilo/streamlit-echarts/blob/master/streamlit_echarts/frontend/src/utils.js
# Thanks andfanilo
class JsCode:
    def __init__(self, js_code: str):
        """Wrapper around a js function to be injected on config.
        Code is not checked at all.
        Code is rebuilt on client using new Function Syntax (https://javascript.info/new-function)

        Args:
            js_code (str): javascript function code as str
        """
        import re
        match_js_comment_expression = r"\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$"
        js_code = re.sub(re.compile(match_js_comment_expression, re.MULTILINE), r"\1", js_code)

        match_js_spaces = r"\s+(?=(?:[^\'\"]*[\'\"][^\'\"]*[\'\"])*[^\'\"]*$)"
        one_line_jscode = re.sub(match_js_spaces, " ", js_code, flags=re.MULTILINE)

        js_placeholder = "::JSCODE::"
        one_line_jscode = re.sub(r"\s+|\r\s*|\n+", " ", js_code, flags=re.MULTILINE)

        self.js_code = f"{js_placeholder}{one_line_jscode}{js_placeholder}"


# Stole from https://github.com/PablocFonseca/streamlit-aggrid/blob/main/st_aggrid/shared.py
# Thanks PablocFonseca
def walk_config(config, func):
    """Recursively walk config applying func at each leaf node

    Args:
        config (dict): config dictionary
        func (callable): a function to apply at leaf nodes
    """
    from collections.abc import Mapping

    if isinstance(config, (Mapping, list)):
        for i, k in enumerate(config):

            if isinstance(config[k], Mapping):
                walk_config(config[k], func)
            elif isinstance(config[k], list):
                for j in config[k]:
                    walk_config(j, func)
            else:
                config[k] = func(config[k])


def config_from_dataframe(dataframe, exclude_fields=None, max_select_values=200):
    """Return a configuration from dataframe columns.

    Parameters
    ----------
    dataframe : DataFrame
        Source dataframe to generate config from.
    exclude_fields : list of str, optional
        Column names to exclude from the config.
    max_select_values : int
        Text columns with this many or fewer unique values are auto-converted
        to select fields. Set to 0 to disable auto-conversion.
        Default: 200
    """
    fields = {}
    for col_name, col_dtype in zip(dataframe.columns, dataframe.dtypes):
        if exclude_fields and col_name in exclude_fields:
            continue

        col_type = 'select' if col_dtype == 'category' else type_mapper.get(col_dtype.kind, '')

        if not col_type:
            continue

        if col_type == 'text' and max_select_values > 0:
            try:
                unique_values = sorted(dataframe[col_name].dropna().unique())
                if len(unique_values) <= max_select_values:
                    fields[col_name] = {
                        'label': col_name,
                        'type': 'select',
                        'operators': ['select_any_in', 'select_not_any_in'],
                        'valueSources': ['value'],
                        'defaultOperator': 'select_any_in',
                        'fieldSettings': {
                            'listValues': [{'value': str(v), 'title': str(v)} for v in unique_values],
                            'showSearch': True,
                        },
                    }
                    continue
            except Exception:
                pass  # Fall through to text handling below

        if col_type == 'text':
            fields[col_name] = {
                'label': col_name,
                'type': 'text',
                'valueSources': ['value'],
            }
        elif col_type == 'number':
            fields[col_name] = {
                'label': col_name,
                'type': 'number',
                'operators': ['greater', 'greater_or_equal', 'less', 'less_or_equal',
                              'between', 'equal', 'not_equal'],
                'valueSources': ['value'],
                'defaultOperator': 'greater_or_equal',
            }
        elif col_type == 'date':
            fields[col_name] = {
                'label': col_name,
                'type': 'date',
                'operators': ['between', 'less', 'less_or_equal', 'greater', 'greater_or_equal',
                              'equal', 'not_equal'],
                'valueSources': ['value'],
                'defaultOperator': 'between',
            }
        elif col_type == 'boolean':
            fields[col_name] = {
                'label': col_name,
                'type': 'boolean',
                'operators': ['equal'],
                'valueSources': ['value'],
            }
        elif col_type == 'select':
            categories = dataframe[col_name].cat.categories
            fields[col_name] = {
                'label': col_name,
                'type': 'select',
                'operators': ['select_any_in', 'select_not_any_in'],
                'valueSources': ['value'],
                'fieldSettings': {
                    'listValues': [{'value': str(c), 'title': str(c)} for c in categories],
                    'showSearch': True,
                },
            }

    return {'fields': fields}


def _valid_field_paths(fields, separator='.'):
    """Return the leaf field paths addressable by a rule.

    Grouped fields ('!group' / '!struct') hold their leaves in `subfields`, and
    rules address those leaves by their full path ('ads.ads_1'), not by the
    group name — so the group names themselves are not valid rule fields. On a
    flat config this returns the same set as `fields.keys()`.
    """
    paths = set()
    for name, field_config in (fields or {}).items():
        subfields = field_config.get('subfields') if isinstance(field_config, dict) else None
        if isinstance(subfields, dict):
            paths |= {
                f'{name}{separator}{path}'
                for path in _valid_field_paths(subfields, separator)
            }
        else:
            paths.add(name)
    return paths


def _clean_tree(tree, config):
    """Remove rules referencing fields not defined in config."""
    separator = (config.get('settings') or {}).get('fieldSeparator', '.')
    valid_fields = _valid_field_paths(config.get('fields'), separator)
    return _prune_unknown_fields(tree, valid_fields)


def _prune_unknown_fields(tree, valid_fields):
    """Remove rules referencing fields not in valid_fields."""
    if not isinstance(tree, dict):
        return tree

    if tree.get('type') == 'rule':
        field = (tree.get('properties') or {}).get('field')
        if field is not None and field not in valid_fields:
            return None
        return tree

    # Group or rule_group — clean children
    children_key = 'children1' if 'children1' in tree else 'children'
    children = tree.get(children_key)
    if children is None:
        return tree

    if isinstance(children, list):
        tree[children_key] = [
            c for c in (_prune_unknown_fields(c, valid_fields) for c in children)
            if c is not None
        ]
    elif isinstance(children, dict):
        tree[children_key] = {
            k: v for k, v in (
                (k, _prune_unknown_fields(v, valid_fields))
                for k, v in children.items()
            ) if v is not None
        }

    return tree


def condition_tree(config: dict,
                   return_type: str = 'queryString',
                   tree: dict = None,
                   min_height: int = 400,
                   placeholder: str = '',
                   always_show_buttons: bool = True,
                   emit_complete_only: bool = False,
                   key: str = None,
                   ):
    """Create a new instance of condition_tree.

    Parameters
    ----------
    config: dict
        Configuration defining the value types, supported operators and how
        they are rendered, imported and exported.
    return_type: str or None
        Format in which output should be returned to streamlit.
        Possible values : queryString | mongodb | sql | spel |
        elasticSearch | jsonLogic.
        Default : queryString (compatible with DataFrame.query)
    tree: dict or None
        Input condition tree
        Default: None
    min_height: int
        Minimum height of the component frame (kept for API compatibility)
        Default: 400
    placeholder: str
        Text displayed when the condition tree is empty
        Default: empty
    always_show_buttons: boolean
        If false, buttons (add rule, etc.) will be shown only on hover
        Default: true
    emit_complete_only: boolean
        If true, only rules that contribute a predicate (a known field with a
        value filled in for its operator) are emitted back to Streamlit, and
        identical successive emits are suppressed. This avoids a visual rerun
        while a rule is half-built (field picked but no value yet). The widget
        still shows the in-progress rule; it just isn't sent until complete.
        Emits are also held while a value-selection dropdown is open and flushed
        once it closes, so scrolling/picking several options doesn't trigger a
        rerun on every toggle.
        Default: false
    key: str or None
        An optional key that uniquely identifies this component. If this is
        None, and the component's arguments are changed, the component will
        be re-mounted in the Streamlit frontend and lose its current state.
        Can also be used to access the condition tree through st.session_state.

    Returns
    -------
    dict or object
        The output conditions with the selected format

    """

    if return_type == 'queryString':
        # Add backticks to fields having spaces in their name
        fields = {}
        for field_name, field_config in config['fields'].items():
            if ' ' in field_name:
                field_name = f'`{field_name}`'
            fields[field_name] = field_config

        config['fields'] = fields

    if tree is not None:
        tree = _clean_tree(tree, config)

    walk_config(config, lambda v: v.js_code if isinstance(v, JsCode) else v)

    result = _condition_tree_component(
        data=dict(
            config=config,
            return_type=return_type,
            tree=tree,
            placeholder=placeholder,
            always_show_buttons=always_show_buttons,
            emit_complete_only=emit_complete_only,
        ),
        default={"output_tree": "", "value": ""},
        key='_' + key if key else None,
        on_output_tree_change=lambda: None,
        on_value_change=lambda: None,
    )

    output_tree = result.get("output_tree", "") if result else ""
    component_value = result.get("value", "") if result else ""

    if return_type == 'queryString' and not component_value:
        # Default string that applies no filter in DataFrame.query
        component_value = 'index in index'

    if key:
        st.session_state[key] = output_tree

    return component_value
