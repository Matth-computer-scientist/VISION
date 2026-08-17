FROM rust:1.86 AS builder

WORKDIR /app

COPY backend/Cargo.toml backend/Cargo.toml
COPY backend/crates backend/crates

RUN cargo build --manifest-path backend/Cargo.toml -p vision-api --release

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY --from=builder /app/backend/target/release/vision-api /usr/local/bin/vision-api

ENV VISION_API_PORT=8080

EXPOSE 8080

CMD ["vision-api"]
