# Use a Dart container for compiling.
FROM dart:stable AS build

WORKDIR /app
COPY pubspec.* ./
RUN dart pub get

COPY . .
RUN dart compile exe bin/main.dart -o bin/dgx_dashboard



# Switch to a slim container for runtime.
FROM debian:stable-slim

# Install Docker CLI so we can monitor containers.
RUN apt-get update && \
    apt-get install -y docker.io && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the compiled binary and web assets
COPY --from=build /app/bin/dgx_dashboard ./dgx_dashboard
COPY --from=build /app/web ./web

EXPOSE 8080
ENTRYPOINT ["./dgx_dashboard"]
