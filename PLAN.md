# Configurable Dashboard Platform Plan

## Problem and proposed approach

Build a greenfield, Dockerized dashboard application whose layouts and content are assembled from validated JSON definitions. The frontend should do most read/query work for a fast, simple, modern experience, while a small backend owns dashboard persistence, validation, import/export, and controlled serving of saved configurations. Dashboard sections should support native widgets plus explicitly sandboxed internal or external HTML embeds. A separate dashboard mode should provide a customizable search-engine-style front page without coupling it to the main analytics layout.

Proposed baseline:

- **Frontend:** React + TypeScript + Vite, with a small component system and CSS variables for themes, density, grid sizing, and responsive behavior.
- **Read mode performance:** Serve a pre-rendered HTML snapshot for published dashboards, backed by a versioned JSON data payload. Keep the editor as a separate lazy-loaded bundle; read-only pages should not download editor controls or editing dependencies.
- **Backend:** Node.js + TypeScript API (Fastify or equivalent) with JSON Schema validation, versioned REST endpoints, and a repository abstraction so storage can start on SQLite and remain replaceable.
- **Shared contract:** JSON Schema/types for dashboard documents, sections, widgets, embeds, themes, and search-home configuration. Validate on both client and server; the server is authoritative on saves.
- **Deployment:** Multi-stage Docker images and Docker Compose for frontend, API, and persistent data volume, with environment-driven origin/storage configuration.
- **Security boundary:** Treat HTML embeds as untrusted. Prefer iframe embeds with restrictive sandbox/CSP controls, allowlist external origins, sanitize any internal HTML, and never execute arbitrary dashboard JSON as code.
- **Prometheus compatibility:** Support Prometheus-compatible metric data sources and PromQL-based panels, with configurable Prometheus endpoints, query time ranges, step intervals, refresh policies, and graceful handling of unavailable or partial metric data. Keep credentials and endpoint configuration outside persisted dashboard JSON where possible.
- **Weather dashboard:** Provide a full-screen weather mode with live Open-Meteo data, configurable coordinates and units, location search, weather-specific typography, and a complete icon mapping for WMO conditions.
- **Wide-screen density:** Let dashboard grids use the available viewport, keep outer padding compact, and avoid decorative gradients that lower contrast or make large displays feel sparse.
- **Documentation:** A polished README covering the product concept, screenshots/placeholders, quick start, JSON examples, customization, API, storage, security, and production deployment.

## Todos

1. Establish the monorepo/package structure, TypeScript tooling, shared lint/test/build conventions, and Docker development workflow.
2. Define and validate the shared JSON dashboard contract, including versioning, native sections/widgets, internal and external embeds, theme customization, and search-home configuration.
3. Implement the backend persistence API with dashboard CRUD, validation, revisions/updated metadata, import/export, and durable Docker-backed storage.
4. Implement the frontend shell with routing, dashboard loading/saving, responsive grid composition, theme customization, and accessible empty/loading/error states.
5. Implement native dashboard sections/widgets and the safe internal/external HTML embed experience.
6. Implement the separate search-engine-style front-page dashboard option with configurable search provider, shortcuts, bookmarks, and visual settings.
7. Add Prometheus compatibility for metric panels, including PromQL queries, datasource configuration, time-range/step handling, refresh behavior, and tests against representative Prometheus API responses.
8. Add focused unit/API/component tests plus an end-to-end smoke path for create, save, reload, embed, Prometheus metrics, and search-home behavior.
9. Add production-oriented Docker configuration and a stylish README with JSON examples, customization guidance, security notes, Prometheus setup, and operations instructions.
10. Add a live weather mode with location search, resilient loading/error states, and compact desktop/mobile layouts.

## Dependencies

- The shared JSON contract must precede backend persistence and frontend composition.
- The package/container foundation must precede all application implementation and testing.
- Backend persistence and the shared contract must precede frontend save/load flows.
- Frontend shell must precede native widgets, embeds, and the search-home mode.
- All implementation work must precede the final integrated test pass and documentation polish.

## Implementation status

Completed in the current MVP:

- React/Vite workspace, shared validation contract, Docker packaging, and persistent backend-owned saves.
- Dashboard CRUD plus JSON import/export, revision metadata, native widgets, safe HTML, origin-controlled embeds, search home, and live weather mode.
- Compact responsive layout and on-demand server-rendered HTML for published dashboard, search, and weather views.
- Contract and weather rendering tests, production dependency audit, and Docker image verification.

Still planned:

- Prometheus datasource configuration, proxying, refresh controls, and metric-response tests.
- A SQLite repository implementation and migrations; the MVP currently uses an atomically replaced JSON file on the Docker volume.
- Pre-generated published artifacts and explicit cache invalidation; published HTML is currently rendered on demand and cached for 60 seconds.
- Authentication, ownership, and multi-user permissions for deployments outside a trusted private network.

## Notes and considerations

- No existing code, framework, schema, deployment setup, or product constraints were found in the repository; decisions above are proposed defaults rather than inferred requirements.
- The first implementation should keep the persisted model declarative and portable, with schema versioning and migrations from the start.
- “Most requests from the frontend” should mean read-heavy client rendering and direct API reads, not bypassing server authorization or persistence guarantees.
- Search front page behavior should be configurable and provider-agnostic; avoid hard-coding a third-party search API or storing secrets in dashboard JSON.
- Prometheus integrations should use a server-side proxy or equivalent boundary when needed for CORS, authentication, and network access; redact datasource credentials from exports, logs, and client-visible dashboard definitions.
- HTML embeds need an explicit trust model and visible failure states because browser policies, network access, and third-party framing restrictions can block them.
- The plan intentionally leaves authentication, multi-user permissions, collaborative editing, and hosted search indexing as follow-on decisions unless requirements establish them.
- A saved/published dashboard should trigger regeneration of its read artifact: HTML shell/content for immediately visible static sections, cached JSON for live sections, and optional client hydration only where interaction or live refresh is needed. This gives fast first paint without pretending all external embeds or real-time widgets can be compiled permanently into HTML.
