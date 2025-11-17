# DGX Spark Dashboard

A simple dashboard for the DGX Spark with some slight differences to the built-in dashboard:

- Binds to `0.0.0.0` so it can be accessed over the network without an SSH tunnel
- Uses `MemTotal` and `MemAvailable` for accurate memory stats
- Includes GPU power draw
- Includes CPU usage
- Includes GPU and system temperatures
- Includes stats in browser tab title

Metrics update every 5s and are only collected while there is a connected client.

## Running on DGX Spark

### Run latest from ghcr.io

```
docker run -d --gpus all -p 8080:8080 --pull=always --restart=unless-stopped --name dashboard ghcr.io/dantup/dgx_dashboard:latest
```

### Clone and run locally

```
git clone https://github.com/DanTup/dgx_dashboard
cd dgx_dashboard
docker build -t dgx_dashboard .
docker run -d --gpus all -p 8080:8080 --restart=unless-stopped --name dashboard dgx_dashboard
``` 

![A screenshot of the dashboard](screenshot.png)
