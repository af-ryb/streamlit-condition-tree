import streamlit as st
import pandas as pd

from streamlit_condition_tree import condition_tree, config_from_dataframe

st.set_page_config(page_title="Condition Tree Demo", layout="wide")
st.title("Condition Tree Demo")

tab1, tab2 = st.tabs(["DataFrame Example", "JSON Example"])

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
    st.dataframe(df, use_container_width=True)

    st.subheader("Generated Query")
    st.code(query_string, language="python")

    st.subheader("Filtered Result")
    filtered = df.query(query_string)
    st.dataframe(filtered, use_container_width=True)
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
