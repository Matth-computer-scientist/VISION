FROM rust:1.86 AS builder

WORKDIR /app

COPY backend/Cargo.toml backend/Cargo.toml
COPY backend/crates backend/crates

RUN cargo build --manifest-path backend/Cargo.toml -p vision-api --release

FROM debian:bookworm-slim

WORKDIR /app

COPY --from=builder /app/target/release/vision-api /usr/local/bin/vision-api

ENV VISION_API_PORT=8080

EXPOSE 8080

CMD ["vision-api"]
