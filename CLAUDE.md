# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Streamlit custom component for building condition trees (query builders) backed by [react-awesome-query-builder](https://github.com/ukrbublik/react-awesome-query-builder) with Ant Design theme. Users construct filter conditions visually, and the component returns queries in configurable formats (queryString, mongodb, sql, spel, elasticSearch, jsonLogic).

## Development Setup

The component uses Streamlit Components v2 API (no iframe). Development workflow:

```bash
# Install dependencies
cd streamlit_condition_tree/frontend && npm install

# Build frontend (required before running the app)
npm run build

# Install Python package with dev dependencies
uv venv
uv pip install -e ".[devel]"

# Run the Streamlit app
streamlit run streamlit_condition_tree/example.py
```

For iterative frontend development, use Vite's watch mode in one terminal and re-run the Streamlit app to pick up changes:
```bash
cd streamlit_condition_tree/frontend && npm run build -- --watch
```

## Build Commands

```bash
# Frontend build (production)
cd streamlit_condition_tree/frontend && npm run build

# Frontend dev server (for standalone React testing)
cd streamlit_condition_tree/frontend && npm run dev

# Install with dev dependencies
uv pip install -e ".[devel]"

# Run tests (playwright-based snapshot tests)
pytest
```

## Architecture

**Python module** (`streamlit_condition_tree/__init__.py`): Single-file module containing all public API.
- `condition_tree()` — main component function; uses `st.components.v2.component` with inline JS/CSS content
- `config_from_dataframe()` — auto-generates field config from DataFrame column dtypes using `type_mapper`
- `JsCode` — wraps JavaScript strings for injection into config (uses `::JSCODE::` sentinel)
- `walk_config()` — recursively processes config dicts, converting `JsCode` instances at leaf nodes

**React frontend** (`streamlit_condition_tree/frontend/src/`):
- `index.tsx` — v2 `FrontendRenderer` entry point; manages React root lifecycle per component instance
- `ConditionTree.tsx` — functional component with hooks; handles query builder state, debounced updates (300ms), theme integration via CSS variables, and export in 6 formats
- `config.ts` — default query builder config with custom operator formatting for pandas-compatible queryString output (e.g., `field == value`, `field.isnull()`, `(1 <= field <= 10)`)
- `utils.js` — `deepMap` and `mapObject` helpers for reconstructing `JsCode` functions from serialized config

**Build system:** Vite with library mode (`build.lib`), outputs `build/index.js` (ES module) and `build/style.css`.

## Key Design Details

- Default `return_type` is `"queryString"`, designed for direct use with `DataFrame.query()`. When no conditions are set, returns `"index in index"` as a no-op filter.
- Field names with spaces are auto-wrapped in backticks for queryString compatibility.
- The component uses v2 `setStateValue` to send `output_tree` and `value` back to Python. The tree is stored in `st.session_state[key]` for round-tripping.
- Frontend reads Streamlit theming (dark/light mode, accent colors, fonts) from CSS custom variables (`--primary-color`, `--text-color`, `--font`).
- CSS is scoped under `.st-condition-tree` wrapper class to prevent style leakage with `isolate_styles=False`.
- `cssMinify: false` in Vite config ensures CSS has newlines (required for Streamlit's inline content detection heuristic).
- Package metadata is in `pyproject.toml`. Component manifest declared under `[tool.streamlit.component]`.
