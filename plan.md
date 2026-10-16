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

## Status (as of 2026-10-15)

Progress through the shared build order:

- [x] 1. **skylab-gitops** — bootstrap, skylab-apps renderer (now with `sourceType: directory` for raw-manifest workloads), CI pipeline, local k3d dev loop, Renovate, wrapper charts through wave 5 (skipping wave 2), plus the first wave-10 workload (`workloads/demo-service/`) that proves cert-manager (StepClusterIssuer) + Tempo (OTel traces) + Sloth (PrometheusServiceLevel) end-to-end in dev. Wave-0 wiring resources (StepClusterIssuer + ACME + trust-manager Bundle + ESO ClusterSecretStores + step-ca provisioner ExternalSecret) ship as values-gated opt-ins; homelab has trust-manager Bundle flipped on, the rest remain off pending real inputs.
- [x] 2. **skylab-terraform** — substantively complete. Seven stacks (bootstrap, identity, storage, roles-anywhere, crossplane, qdevice, gcp-identity) and five modules (aws-github-oidc, aws-object-storage, aws-roles-anywhere, aws-ecs-service, gcp-workload-identity) with fmt/validate/tflint/trivy CI. Modules consistently cloud-prefixed. Follow-ups below.
- [ ] 3. **skylab-backstage** — in progress. Backstage app scaffolded under `app/` (`@backstage/create-app` baseline, yarn Berry 4.x, Node 22/24). Image CI (`.github/workflows/image.yml`) runs the host build, builds the shipped `app/packages/backend/Dockerfile`, scans with Trivy (CRITICAL-only via `.trivyignore` since HIGH findings are upstream Backstage transitives), pushes to `ghcr.io/<owner>/skylab-backstage` on `main` with SBOM + max provenance, and cosign-signs each digest keyless. First custom plugin at `app/plugins/scaffolder-backend-module-gitea-pr/` is a backend-plugin-module exposing `gitea:pull-request` that clones via Backstage's `cloneRepo`/`createBranch`/`addFiles`/`commitAndPushBranch` helpers, pushes with Basic auth (Gitea PAT as the password per `GiteaIntegrationConfig`), and POSTs to `/api/v1/repos/<owner>/<repo>/pulls`. The example `app/examples/` scaffold is replaced with a real Skylab catalog at `app/catalog/` (one Group `platform`, one User `skylar`, four Domains — delivery/infrastructure/developer-experience/ai — and five Systems covering the sibling repos); root `catalog-info.yaml` becomes the Component for this repo. `app-config.yaml`'s `catalog.locations` points at the real files and widens `rules.allow` to Component/System/Domain/API/Resource/Location/Template/User/Group. A new `.github/workflows/catalog.yml` runs Roadie's `backstage-entity-validator` across each file in a matrix. Dockerfile now copies `catalog-info.yaml` + `catalog/` into the image so the backend can read them at `/app/catalog*`. No chart wrapper, templates, or MCP wiring yet. Next: Gitea entity-discovery provider + OIDC login, or the first golden-path template.
- [ ] 4. **skylab-crossplane** — not started. The gitops wave 2 Application will pin an OCI package built from this repo.
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

1. Build the Go service template first and migrate book-api-golang through it.
2. Add the database template on top of book-api.
3. Add the cluster template once skylab-crossplane ships its handoff.
4. Add the AI agent template last, with tack-ai as its reference workload.

### Done when

- [ ] book-api-golang runs from the Go service template with traces, a dashboard and an SLO in Grafana
- [ ] A new service goes from template to running in under 15 minutes with no manual steps

---

## Upstream dependencies

- **skylab-terraform** TechDocs bucket for published docs; Gitea OIDC values; step-ca bundle for TLS trust.
- **skylab-gitops** wave 6 ships the Backstage chart; `charts/kubevela-defs` provides the component/trait vocabulary templates use.
- **skylab-crossplane** `KubernetesCluster`, `postgres`, `bucket` XRDs are what the cluster/database templates reference.
