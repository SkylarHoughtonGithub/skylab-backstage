# ${{ values.name }}

${{ values.description }}

## Endpoints

| Path       | Purpose           |
| ---------- | ----------------- |
| `/healthz` | Liveness check    |
| `/`        | Hello placeholder |

## Telemetry

Traces export to the OTLP endpoint set by `OTEL_EXPORTER_OTLP_ENDPOINT`. In
dev that's the in-cluster Alloy; prod uses the hub's Tempo.
