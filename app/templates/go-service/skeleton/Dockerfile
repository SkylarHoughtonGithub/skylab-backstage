FROM golang:1.23 AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/${{ values.name }} .

FROM gcr.io/distroless/static:nonroot
COPY --from=build /out/${{ values.name }} /app/${{ values.name }}
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/app/${{ values.name }}"]
