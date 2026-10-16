# ${{ values.name }}

${{ values.description }}

Scaffolded from the `go-service` golden-path template.

## Local dev

```sh
go run .
```

Service listens on `:8080`; healthcheck at `/healthz`.

## CI

Gitea Actions in `.gitea/workflows/ci.yaml` runs `go test`, builds a container,
Trivy-scans it, cosign-signs the digest, and pushes to the configured OCI
registry on pushes to `main`.

## Delivery

Argo CD syncs the KubeVela Application in `platform/tenants` to the dev
cluster. The scaffolder PR into `platform/tenants` is the source of truth for
image tag + replicas.

## Docs

TechDocs are generated from `docs/` via `mkdocs.yml` and surfaced on the
entity page in Backstage.
