# Build with a reviewed export of OCR_SOURCE as the context, never the PR checkout.
# Pin the resulting local image ID in CHANGEPLANE_REVIEW_IMAGE before model use.
FROM golang:1.25.5-bookworm AS build
WORKDIR /build
COPY . .
RUN CGO_ENABLED=0 go build -mod=readonly -trimpath -o /ocr ./cmd/opencodereview

FROM node:22.18.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /ocr /usr/local/bin/ocr
COPY --from=build /build/LICENSE /usr/local/share/opencode-review/LICENSE
LABEL org.changeplane.ocr-source="a003b9341a65130b024829101ea35494b56569e1"
ENTRYPOINT ["ocr"]
