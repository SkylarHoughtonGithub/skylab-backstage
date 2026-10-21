# Skylab Platform Rework — skylab-backstage

Oct 12, 2026 · @Skylar

> One slice of a five-repo rework. See the **Cross-repo map** below for siblings.

## North star

Skylab becomes four public platform repos on GitHub plus a tenant repo in Gitea, built in a fixed order, with one owner per layer. It runs as a homelab hub managing spoke clusters on AWS and GCP. The old argo-\*, backstage-\* and shoutsky-images repos are archived once their contents have a new home. There is no live infrastructure to migrate, so every repo is built clean.

Humans and agents only ever write to Git; Argo CD is the single path into the clusters, and AWS foundations come from Terraform CI.

### Layer ownership

| Layer | Tool | Owns | Never touches |
| --- | --- | --- | --- |
| Delivery | Argo CD | Applying Git state to clusters; deciding which cluster gets what | Resources rendered by KubeVela |
| Infrastructure API | Crossplane | Cloud resources: EKS, networking, buckets, databases | Helm releases and app workloads |
| Application API | KubeVela | App components, traits, delivery workflow, the resources it renders | Cluster placement |
| Front door | Backstage | Catalog, templates, MCP actions for AI clients | Direct writes to clusters |
| Investigation | HolmesGPT | Read-only root-cause analysis of alerts | Any change to the system |
| Remediation | tack-ai | Proposing fixes as pull requests, behind policy and approval | Direct cluster changes |

### Cross-repo map

| Repo | Host | Replaces | Purpose |
| --- | --- | --- | --- |
| skylab-gitops | GitHub | skylab-argo-root, skylab-argo-bootstrap, skylab-argo-workloads | Everything Argo CD syncs: platform charts, cluster config, workloads |
| skylab-terraform | GitHub | proxmox-qdevice from shoutsky-images | AWS and GCP foundations: OIDC, workload identity, buckets, IAM, qdevice |
| **skylab-backstage** (this repo) | GitHub | skylab-backstage-catalog, Backstage image from shoutsky-images | Backstage app, image, chart, templates, plugins |
| skylab-crossplane | GitHub | crossplane-xrd folder in skylab-argo-bootstrap | Cloud-agnostic XRDs with AWS and GCP compositions, as an OCI package |
| platform/tenants | Gitea | skylab-backstage-configs | Scaffolder output: KubeVela Applications and infra requests |
| tack-ai | GitHub (existing) | n/a | Governed remediation agent; integration work only |

### Build order

1. **skylab-gitops**, including Gitea, KubeVela and the observability stack. Everything else plugs into it.
2. **skylab-terraform**, moved up because Loki, Tempo and TechDocs need buckets and Roles Anywhere before they can store anything.
3. **skylab-backstage**, including the Gitea pull-request action and MCP actions.
4. **skylab-crossplane**, with EKS and GKE behind one cluster API, handing new clusters to Argo CD.
5. **Archive the old repos** once each piece has moved.
6. **Golden paths**: KubeVela definitions and the templates that use them.
7. **AI layer**: model gateway, HolmesGPT, tack-ai remediation, kagent.
8. **Portfolio finish**: profile README, pins, ADRs.

## Status (as of 2026-10-20)

Progress through the shared build order:

- [x] 1. **skylab-gitops** — bootstrap, skylab-apps renderer (now with `sourceType: directory` for raw-manifest workloads), CI pipeline, local k3d dev loop, Renovate, wrapper charts through wave 5 (skipping wave 2), plus the first wave-10 workload (`workloads/demo-service/`) that proves cert-manager (StepClusterIssuer) + Tempo (OTel traces) + Sloth (PrometheusServiceLevel) end-to-end in dev. Wave-0 wiring resources (StepClusterIssuer + ACME + trust-manager Bundle + ESO ClusterSecretStores + step-ca provisioner ExternalSecret) ship as values-gated opt-ins; homelab has trust-manager Bundle flipped on, the rest remain off pending real inputs.
- [x] 2. **skylab-terraform** — substantively complete. Seven stacks (bootstrap, identity, storage, roles-anywhere, crossplane, qdevice, gcp-identity) and five modules (aws-github-oidc, aws-object-storage, aws-roles-anywhere, aws-ecs-service, gcp-workload-identity) with fmt/validate/tflint/trivy CI. Modules consistently cloud-prefixed. Follow-ups below.
- [ ] 3. **skylab-backstage** — in progress. Backstage app scaffolded under `app/` (`@backstage/create-app` baseline, yarn Berry 4.x, Node 22/24). Image CI (`.github/workflows/image.yml`) runs the host build, builds the shipped `app/packages/backend/Dockerfile`, scans with Trivy (CRITICAL-only via `.trivyignore` since HIGH findings are upstream Backstage transitives), pushes to `ghcr.io/<owner>/skylab-backstage` on `main` with SBOM + max provenance, and cosign-signs each digest keyless. First custom plugin at `app/plugins/scaffolder-backend-module-gitea-pr/` is a backend-plugin-module exposing `gitea:pull-request` that clones via Backstage's `cloneRepo`/`createBranch`/`addFiles`/`commitAndPushBranch` helpers, pushes with Basic auth (Gitea PAT as the password per `GiteaIntegrationConfig`), and POSTs to `/api/v1/repos/<owner>/<repo>/pulls`. The example `app/examples/` scaffold is replaced with a real Skylab catalog at `app/catalog/` (one Group `platform`, one User `skylar`, four Domains — delivery/infrastructure/developer-experience/ai — and five Systems covering the sibling repos); root `catalog-info.yaml` becomes the Component for this repo. `app-config.yaml`'s `catalog.locations` points at the real files and widens `rules.allow` to Component/System/Domain/API/Resource/Location/Template/User/Group. A new `.github/workflows/catalog.yml` runs Roadie's `backstage-entity-validator` across each file in a matrix. Dockerfile now copies `catalog-info.yaml` + `catalog/` into the image so the backend can read them at `/app/catalog*`. Gitea entity-discovery (`@backstage/plugin-catalog-backend-module-gitea`) ingests `catalog-info.yaml` from every repo in the `platform` Gitea org on a 10-minute schedule, and the generic OIDC auth provider (`@backstage/plugin-auth-backend-module-oidc-provider`) is wired to use Gitea as the IdP (`preferredUsernameMatchingUserEntityName` resolver), parameterized on `GITEA_OIDC_METADATA_URL`/`GITEA_OIDC_CLIENT_ID`/`GITEA_OIDC_CLIENT_SECRET`. Frontend sign-in UI still defaults to guest until there's a live Gitea to point at. Kubernetes plugin (`@backstage/plugin-kubernetes`) is now registered in `packages/app/src/App.tsx`'s `features` array; backend module was already registered. `app-config.yaml` adds `kubernetes.clusterLocatorMethods` for a `homelab` cluster parameterized on `K8S_HOMELAB_URL` / `K8S_HOMELAB_SA_TOKEN` / `K8S_HOMELAB_CA_DATA`, plus a `customResources` list for KubeVela (`core.oam.dev/applications|componentdefinitions|traitdefinitions`) and Crossplane (`apiextensions.crossplane.io/compositeresourcedefinitions`, `pkg.crossplane.io/providers`). The repo's own Component annotation `backstage.io/kubernetes-id: skylab-backstage` wires its entity page to resolve against the cluster. Argo CD plugin lands via Roadie's packages (`@roadiehq/backstage-plugin-argo-cd` + `-backend`), registered in the backend index and in `packages/app/src/App.tsx` `features`. Config block `argocd.appLocatorMethods` names one `homelab` instance; auth defaults to `username`/`password` (`ARGOCD_USERNAME` / `ARGOCD_PASSWORD`) with per-instance `token` left commented. `skylab-backstage` Component gains an `argocd/app-selector: skylab.io/system=skylab-backstage` annotation so its entity page lists the Argo apps covering it. Grafana plugin (`@backstage-community/plugin-grafana`, frontend-only — talks to Grafana through a proxy endpoint) is registered in `App.tsx` `features`; `app-config.yaml` adds a `/grafana/api` proxy endpoint parameterized on `GRAFANA_URL` + `GRAFANA_TOKEN` and a top-level `grafana.domain` for browser-facing links, with `unifiedAlerting: true` to match Grafana 9+. The Component picks up its dashboards + alerts via `grafana/dashboard-selector` and `grafana/alert-label-selector` annotations. Frontend OIDC sign-in UI is on: `@backstage/plugin-auth` is registered in `App.tsx` `features`, and the `sign-in-page` extension in `app-config.yaml` lists `guest` + `oidc` (titled "Sign in with Gitea"); `app.title` + `organization.name` flipped to `Skylab`. Guest stays on so local dev works without Gitea; we flip it off once Gitea is live. First golden-path template lands at `app/templates/go-service/`: a Template entity with a service-identity + owner + Gitea-host form, a Go skeleton (OTel-wired `main.go`, distroless multi-stage `Dockerfile`, Gitea Actions CI running test + build + Trivy + cosign + SBOM, templated `catalog-info.yaml` with Kubernetes/Argo/Grafana annotations, and TechDocs `mkdocs.yml` + `docs/`), and a `tenants-pr/` payload with a one-line KubeVela Application using the Skylab `go-service` ComponentDefinition (shipped from `skylab-gitops/charts/kubevela-defs` at wave 3) which bakes in the OTel env, `skylab.io/system` labels, and `/healthz` probes. The workflow is `fetch:template` → `publish:gitea` (via `@backstage/plugin-scaffolder-backend-module-gitea`, newly registered) → `catalog:register` → `fetch:template` → `gitea:pull-request` (our custom action from #8). The template is registered as a `type: file` Location in `app-config.yaml`, included in the catalog-validator matrix, and copied into the image by the Dockerfile. Chart wrapper lives in `skylab-gitops/charts/backstage/` at wave 6 (with ClusterRole/ClusterRoleBinding for in-cluster Kubernetes auth). Custom MCP actions land as a second internal plugin workspace at `app/plugins/skylab-actions/` — a `backend-plugin-module` targeting `mcp-actions` that registers actions on the Backstage `actionsRegistryServiceRef` (from `@backstage/backend-plugin-api/alpha`). Backend index registers the module alongside `@backstage/plugin-mcp-actions-backend`. Two actions ship: `platform-ping` (read-only, idempotent — returns the module name + an ISO timestamp) as a round-trip liveness probe, and `argocd-recent-failures` (read-only, idempotent) which lists Argo CD Applications whose last sync op finished in `Failed`/`Error` within a look-back window, across one or all configured instances. The Argo action depends on the Roadie plugin's `argocdServiceRef` so it reuses the already-wired `argocd.appLocatorMethods` config + `getArgoToken` / `getArgoAppData` service calls — no new auth setup. Inputs are `instance?` / `withinHours?` (1-168, default 24) / `limit?` (1-100, default 20); output is a newest-first list with phase, message, sync + health status and revision, plus a `warnings` list so a single failing instance doesn't poison the whole response. Remaining real actions (SLO burn rate, KubeVela workflow status, environment requests) land as follow-up PRs. Second golden-path template lands at `app/templates/database/`: form takes a target service name + DB config, emits a sibling `applications/<service>-db.yaml` KubeVela Application in `platform/tenants` using the Skylab `postgres` ComponentDefinition (from `skylab-gitops/charts/kubevela-defs`, which emits the XPostgres XR + a compose Job that derives `DATABASE_URL` into the `db-url` Secret), and opens an auto-merged PR via an extended `gitea:pull-request` action — the action now takes `automerge?` / `mergeStrategy?` / `deleteBranchAfterMerge?` inputs and, when `automerge: true`, calls Gitea's `/merge` endpoint with retry on 405 after PR creation. Flat tenants layout: `applications/<service>.yaml` + `applications/<service>-db.yaml` sit as alphabetical siblings; service's own Application stays untouched. Dev adds one line to it afterwards — `envFrom: [{ secretRef: { name: db-url } }]` on the service component — to pick up `DATABASE_URL` and retire any interim Postgres block. Deferred: ESO-backed password instead of the dev-only inline Secret once ClusterSecretStores are wired.
- [ ] 4. **skylab-crossplane** — in progress. Configuration package `skylab-platform` published at `ghcr.io/skylarhoughtongithub/skylab-platform:v0.4.0`, pinned at that version in gitops wave 2. Four XRDs land: Bucket (v0.1.0), Network public-VPC (v0.2.0), KubernetesCluster (v0.3.0, EKS + GKE with Argo CD cluster-Secret handoff), and Postgres (v0.4.0, AWS RDS Instance + GCP CloudSQL DatabaseInstance/Database/User, both writing connection details via `writeConnectionSecretToRef`). Remaining XRDs (NAT + private subnets for Network, access/RBAC) are additive follow-ups. mechatracker Phase 2 lands on the gitops side — `workloads/mechatracker-db/` sibling Application via the `postgres` ComponentDefinition; dev k3d sits red because wave 1 (Crossplane) isn't flipped on with cloud credentials.

### Proof-point workload: mechatracker

`mechatracker` (sibling repo) is the first real workload matching the Go service template's shape. Status (as of 2026-10-20):

- Backend Clerk → Google OAuth rip done; API ships with OTel SDK, distroless base, `/healthz`, Gitea Actions CI–shaped GitHub Actions workflow, root `catalog-info.yaml` + `mkdocs.yml`, and session + middleware unit tests.
- Web frontend Clerk → Google (`@react-oauth/google`) done; `AuthProvider` + session cookie flow + `/sign-in` + `/onboarding` + `/accept-invite/:token` pages.
- Deployed to the dev cluster via `skylab-gitops/workloads/mechatracker/` (hand-written KubeVela Application matching what the `go-service` template will emit, plus an interim `k8s-objects` Postgres).
- Pending: a real `GOOGLE_CLIENT_ID` + `SESSION_SIGNING_KEY` in cluster values to light up end-to-end sign-in; database-template run to replace the interim Postgres with a Crossplane `postgres` XR; `infra/helm/mechatracker/` retirement.
- [ ] 5. Archive the old repos
- [ ] 6. Golden paths
- [ ] 7. AI layer (includes tack-ai)
- [ ] 8. Portfolio finish

### Deferred wiring in skylab-gitops (now unblocked)

Terraform's `stacks/roles-anywhere` is live, so these can land next:

- cert-manager ClusterIssuers (`StepClusterIssuer` + ACME Let's Encrypt)
- trust-manager Bundle distributing the step-ca root
- external-secrets ClusterSecretStores (AWS Secrets Manager, GCP Secret Manager)
- step-ca provisioner secrets via ExternalSecret

### Deferred follow-ups in skylab-terraform

- Tighten scaffold policies: ESO `SecretsManagerReadWrite`, `terraform-ci` role `AdministratorAccess`, GCP SAs on `roles/owner`/`roles/editor`.
- Port the actual qdevice container logic from `shoutsky-images/images/proxmox-qdevice`.
- qdevice image build+push CI.
- Retire `terraform/development/` legacy content once nothing references it.

### Deferred CI work in skylab-gitops

- OCI push to GHCR on main
- Rendered-diff PR comment on PRs

---

## This repo

One repo holds the Backstage app, its image, its chart, its templates and its custom plugins. Nothing in the catalog is registered by hand: discovery finds repos, and one generated Location file finds templates.

```
skylab-backstage/
├── app/          # Backstage source, new backend system
├── plugins/
│   ├── scaffolder-backend-module-gitea-pr/  # gitea:pull-request action
│   └── skylab-actions/                     # platform MCP actions
├── chart/        # wrapper chart, published to OCI
├── catalog/      # org.yaml, systems, domains
├── templates/    # one folder per template
└── catalog-info.yaml  # root Location, generated by CI
```

### Gitea integration

- **Publishing:** the official `publish:gitea` action creates new repos for scaffolded apps.
- **Pull requests:** there is no official Gitea pull-request action, so write `gitea:pull-request` as a backend module. Templates use it to open PRs against `platform/tenants`. This is a candidate upstream contribution.
- **Discovery:** the Gitea entity provider ingests `catalog-info.yaml` from the root of every Gitea repo. The GitHub provider does the same for the skylab repos.
- **Login:** Gitea as the OIDC provider for Backstage, through the generic OIDC auth provider. Argo CD and Grafana use the same login.
- **TLS:** Gitea's certificate comes from step-ca, so set `NODE_EXTRA_CA_CERTS` to the trust-manager bundle in the Backstage pod.

### No manual registration

- One static `catalog.locations` entry points at the root `catalog-info.yaml`, a Location whose targets list every template.
- CI regenerates that file from the `templates/` tree and fails the build if it drifts, so adding a template means adding a folder.
- CI validates every entity with Roadie's backstage-entity-validator.
- Templates skip `catalog:register`; discovery picks up new repos on a short schedule, which avoids duplicate-location conflicts.
- `catalog.rules` allows the Template kind.

### Plugins and integrations

- **Kubernetes plugin**, configured for KubeVela and Crossplane custom resources.
- **Argo CD plugin** for sync and health on each entity page.
- **Grafana plugin** for each component's dashboards and alerts.
- **TechDocs** built in CI and published to the object storage bucket from skylab-terraform.
- **Org data** from a static `org.yaml`, since there is no Gitea org provider. A small custom provider is a stretch goal.

### MCP for AI clients

- Install `@backstage/plugin-mcp-actions-backend` and split it into catalog and scaffolder endpoints.
- Register custom actions in `skylab-actions`: KubeVela workflow status, recent Argo sync failures, an entity's SLO burn rate from Prometheus, and environment requests through templates.
- The Actions Registry does not enforce permissions, so each action checks Backstage permissions itself.
- Model AI assets in the catalog: MCP servers as API entities, models and the gateway as Resources, kagent agents and tack-ai as Components, each with an owner.

### Image CI

- Build, scan with Trivy, sign with cosign, attach an SBOM and push to GHCR.
- Path filters, so catalog and template changes do not rebuild the image.

### Release strategy

**Live:** release-please + Conventional Commits (`release-type: simple`, single package at repo root). Config in `release-please-config.json`, state in `.release-please-manifest.json`, workflow at `.github/workflows/release-please.yaml`. Decided fleet-wide (see `skylab-gitops/plan.md`); applied here first because this repo was the trial run. PR titles use `feat:`, `fix:`, `chore:` etc; merging opens a release PR that bumps the manifest version and cuts a tag which the image build picks up.

The action runs under `RELEASE_PLEASE_PAT` (fine-grained PAT with `contents:write` + `pull-requests:write` on this repo) rather than the default `GITHUB_TOKEN`, so tags it pushes trigger the downstream `image.yml` workflow — GitHub blocks `GITHUB_TOKEN`-authored events from firing other workflows, which otherwise silently prevents tagged image builds. First release PR is still open at `v1.0.0`; merging it is what proves the end-to-end chain.

### Done when

- [ ] A template run opens a PR in `platform/tenants`, the PR merges, and Argo syncs it
- [ ] The new repo appears in the catalog with no manual step
- [ ] The entity page shows live Argo, KubeVela and Grafana status
- [ ] Claude Code can query the catalog and run a template through MCP

---

## Golden paths — templates

A developer picks a template, fills a short form and gets a running, observable, owned service, without seeing Argo CD, Crossplane or Helm. The KubeVela definitions these templates instantiate live in `skylab-gitops/plan.md` under `charts/kubevela-defs`.

### Templates (in `templates/`)

| Template | Creates | Proves |
| --- | --- | --- |
| Go service | Gitea repo with Gitea Actions CI (test, build, Trivy, cosign, SBOM), OpenTelemetry instrumentation, catalog entry, TechDocs; PR adding a KubeVela Application to `platform/tenants` | The full golden path, end to end |
| Database for an app | PR adding a `postgres` dependency to an existing Application | Developers get infra without touching Crossplane |
| Kubernetes cluster | PR adding a KubernetesCluster XR with a cloud choice (AWS or GCP), pinned to a skylab-crossplane version | Self-service clusters on either cloud that Argo CD adopts |
| AI agent | kagent Agent or a Go service with the `ai-agent` component, gateway access and observability | Governed, observable agents by default |

### Order

1. Build the Go service template first and migrate **mechatracker** through it (see `mechatracker/plan.md` — includes a Phase 0 Clerk → Google OAuth rework that gates deployment). book-api-golang and chirpy are not used: book-api is being retired, and chirpy was dropped because its Boot.dev-tutorial fingerprint would dilute the portfolio story.
2. Add the database template on top of **mechatracker** — it already needs Postgres, so one workload proves both #1 and #2.
3. Add the cluster template once skylab-crossplane ships its handoff.
4. Add the AI agent template last, with tack-ai as its reference workload.

### Done when

- [ ] mechatracker runs from the Go service template with traces, a dashboard and an SLO in Grafana
- [ ] A new service goes from template to running in under 15 minutes with no manual steps

---

## Upstream dependencies

- **skylab-terraform** TechDocs bucket for published docs; Gitea OIDC values; step-ca bundle for TLS trust.
- **skylab-gitops** wave 6 ships the Backstage chart; `charts/kubevela-defs` provides the component/trait vocabulary templates use.
- **skylab-crossplane** `KubernetesCluster`, `postgres`, `bucket` XRDs are what the cluster/database templates reference.
