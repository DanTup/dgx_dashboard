# Use a Dart container for compiling.
FROM dart:stable AS build

WORKDIR /app
COPY pubspec.* ./
RUN dart pub get

COPY . .
RUN dart compile exe bin/main.dart -o bin/dgx_dashboard

# Switch to a minimal Alpine container for runtime.
FROM alpine:latest

# Install Docker CLI and glibc compatibility.
# gcompat is required for the glibc-linked Dart binary/nvidia-smi.
RUN apk add --no-cache docker-cli gcompat

WORKDIR /app

# Copy the compiled binary and web assets
COPY --from=build /app/bin/dgx_dashboard ./dgx_dashboard
COPY --from=build /app/web ./web

EXPOSE 8080
ENTRYPOINT ["./dgx_dashboard"]
