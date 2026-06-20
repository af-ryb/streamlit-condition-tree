import streamlit as st
import pandas as pd

from streamlit_condition_tree import condition_tree, config_from_dataframe

st.set_page_config(page_title="Condition Tree Demo", layout="wide")
st.title("Condition Tree Demo")

tab1, tab2, tab3 = st.tabs(
    ["DataFrame Example", "JSON Example", "Cross-filter (dynamic options)"]
)

# ---------------------------------------------------------------------------
# Tab 1 — DataFrame filtering with queryString
# ---------------------------------------------------------------------------


with tab1:
    st.header("DataFrame Filtering")

    df = pd.DataFrame({
        "Name": ["Alice", "Bob", "Charlie", "Diana", "Eve"],
        "Age": [28, 35, 42, 31, 26],
        "Score": [88.5, 72.0, 95.3, 63.8, 91.2],
        "Department": pd.Categorical(
            ["Engineering", "Sales", "Engineering", "Marketing", "Sales"],
            categories=["Engineering", "Sales", "Marketing"],
        ),
        "Active": [True, True, False, True, False],
    })

    config = config_from_dataframe(df)

    query_string = condition_tree(
        config,
        return_type="queryString",
        key="df_tree",
    )

    st.subheader("Original Data")
    st.dataframe(df)

    st.subheader("Generated Query")
    st.code(query_string, language="python")

    st.subheader("Filtered Result")
    filtered = df.query(query_string)
    st.dataframe(filtered)
    st.caption(f"{len(filtered)} of {len(df)} rows")

# ---------------------------------------------------------------------------
# Tab 2 — Manual JSON config with jsonLogic output
# ---------------------------------------------------------------------------
with tab2:
    st.header("JSON Config — jsonLogic Output")

    json_config = {
        "fields": {
            "name": {
                "label": "Product Name",
                "type": "text",
            },
            "category": {
                "label": "Category",
                "type": "select",
                "fieldSettings": {
                    "listValues": [
                        {"value": "electronics", "title": "Electronics"},
                        {"value": "clothing", "title": "Clothing"},
                        {"value": "food", "title": "Food"},
                        {"value": "books", "title": "Books"},
                    ],
                },
            },
            "price": {
                "label": "Price",
                "type": "number",
                "fieldSettings": {
                    "min": 0,
                },
            },
            "in_stock": {
                "label": "In Stock",
                "type": "boolean",
            },
            "rating": {
                "label": "Rating",
                "type": "number",
                "fieldSettings": {
                    "min": 0,
                    "max": 5,
                },
            },
        },
    }

    json_logic = condition_tree(
        json_config,
        return_type="jsonLogic",
        key="json_tree",
    )

    st.subheader("jsonLogic Output")
    st.json(json_logic if json_logic else {})

# ---------------------------------------------------------------------------
# Tab 3 — Cross-filter: a field's listValues change at runtime
# ---------------------------------------------------------------------------
with tab3:
    st.header("Cross-filter — dynamic options")
    st.caption(
        "Pick a media source: the `campaign` field's options are narrowed to that "
        "source. The widget picks up the new options **live, without remounting**, "
        "so rules on other fields are preserved. (Mirrors a host app that "
        "cross-filters one field's choices based on another's value.)"
    )

    campaigns_by_source = {
        "google": ["g_brand", "g_generic", "g_retargeting"],
        "meta": ["m_prospecting", "m_lookalike", "m_retargeting"],
        "tiktok": ["tt_awareness", "tt_conversion"],
    }

    source = st.selectbox(
        "Media source (drives the campaign options below)",
        list(campaigns_by_source),
    )
    campaigns = campaigns_by_source[source]

    cf_config = {
        "fields": {
            "media_source": {
                "label": "Media source",
                "type": "select",
                "operators": ["select_any_in", "select_not_any_in"],
                "fieldSettings": {
                    "listValues": [
                        {"value": s, "title": s} for s in campaigns_by_source
                    ],
                },
            },
            "campaign": {
                "label": "Campaign",
                "type": "select",
                "operators": ["select_any_in", "select_not_any_in"],
                "fieldSettings": {
                    "listValues": [{"value": c, "title": c} for c in campaigns],
                },
            },
            "clicks": {
                "label": "Clicks",
                "type": "number",
                "operators": ["greater", "less", "between", "equal"],
            },
        },
    }

    cf_result = condition_tree(
        cf_config,
        return_type="jsonLogic",
        emit_complete_only=True,
        key="cf_tree",
    )

    st.write(f"`campaign` options for **{source}**: `{campaigns}`")
    st.caption(
        "Try: add a `clicks > 5` rule, then switch the media source. The clicks "
        "rule stays (no tree wipe) and the campaign dropdown shows the new options."
    )
    st.json(cf_result if cf_result else {})
