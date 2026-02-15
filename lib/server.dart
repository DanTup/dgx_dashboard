import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:async/async.dart';
import 'package:mime/mime.dart';
import 'package:path/path.dart' as path;

import 'constants.dart';
import 'cpu.dart';
import 'docker.dart';
import 'gpu.dart';
import 'memory.dart';
import 'temps.dart';
import 'utils.dart';

/// A HTTP server that handles serving the dashboard.
class Server {
  final GpuMonitor _gpuMonitor;
  final CpuMonitor _cpuMonitor;
  final MemoryMonitor _memoryMonitor;
  final TemperatureMonitor _temperatureMonitor;
  final DockerMonitor _dockerMonitor;

  /// A stream of all metrics.
  ///
  /// The GPU Monitor from `nvidia-smi` already polls on an interval so we just
  /// collect other metrics each time it emits.
  late final metricsStream = _gpuMonitor.metrics.map((gpu) {
    final cpu = _cpuMonitor.readMetrics();
    final temperature = _temperatureMonitor.readMetrics();
    final memory = _memoryMonitor.readMetrics();
    return (gpu: gpu, cpu: cpu, temperature: temperature, memory: memory);
  });

  var _latestDockerContainers = <DockerContainer>[];
  Future<void>? _dockerPollInFlight;
  Timer? _dockerPollTimer;

  /// A buffer of the last 10 events so that when a new client connects
  /// we can provide some immediate history.
  ///
  /// A `null` value means the nvidia-smi process has crashed and will not be
  /// restarted.
  final _clientMetricsBuffer = <Map<String, Object?>>[];

  final Set<WebSocket> _connectedClients = {};

  StreamSubscription<void>? _metricsSubscription;

  /// A timer that pauses metrics gathering and clears the data buffer a few
  /// seconds after the last client disconnects. This allows us to keep tracking
  /// and resend recent data to a client that might just be refreshing, but
  /// won't use resources or send stale data for a client that comes back after
  /// a longer period.
  late final _suspendTimer = RestartableTimer(
    Duration(seconds: 15),
    _pauseStreamIfNoClients,
  );

  /// Creates a server to serve the dashboard.
  Server(
    this._gpuMonitor,
    this._cpuMonitor,
    this._memoryMonitor,
    this._temperatureMonitor,
    this._dockerMonitor,
  );

  /// Starts the server listening on [address]:[port].
  Future<void> start(InternetAddress address, int port) async {
    final server = await HttpServer.bind(address, port);
    final clickableHost = address == InternetAddress.anyIPv4
        ? 'localhost'
        : address.host;
    info('Server listening on http://$clickableHost:$port');

    await server.map(_handleRequest).toList();
  }

  void _fetchDockerContainers(bool wasTriggedByCommand) {
    if (_connectedClients.isEmpty) {
      _stopDockerPolling();
      return;
    }

    fine(
      'Docker poll requested (${wasTriggedByCommand ? 'manual command' : 'scheduled'})',
    );

    if (!wasTriggedByCommand && _dockerPollInFlight != null) {
      fine('Scheduled Docker poll skipped because an update is in flight');
      return;
    }

    Future<void> poll() async {
      final stopwatch = Stopwatch()..start();
      try {
        _latestDockerContainers = await _dockerMonitor.getContainers();
        _latestDockerContainers.sort((c1, c2) => c1.names.compareTo(c2.names));

        final elapsedMs = stopwatch.elapsedMilliseconds;
        if (elapsedMs > 5000) {
          warning('Docker poll took ${elapsedMs}ms');
        }
      } catch (e) {
        final elapsedMs = stopwatch.elapsedMilliseconds;
        error('Docker polling failed after ${elapsedMs}ms: $e');
      } finally {
        stopwatch.stop();
        _dockerPollInFlight = null;
      }
    }

    _dockerPollInFlight = poll();
  }

  Future<void> _handleRequest(HttpRequest request) async {
    fine('HTTP ${request.method} ${request.uri.path}');
    final response = request.response;
    if (request.uri.path == '/ws') {
      if (WebSocketTransformer.isUpgradeRequest(request)) {
        await _handleWebSocket(request);
      } else {
        response
          ..statusCode = HttpStatus.badRequest
          ..write('WebSocket upgrade required');
        await response.close();
      }
    } else {
      await _serveStaticFile(request);
    }
  }

  Future<void> _handleWebSocket(HttpRequest request) async {
    if (request.headers.value('Origin') != request.requestedUri.origin) {
      request.response
        ..statusCode = HttpStatus.forbidden
        ..write('Cross-origin connection not allowed');
      await request.response.close();
      return;
    }

    final ws = await WebSocketTransformer.upgrade(request);

    // We need the ping otherwise onDone will never fire and we'll never detect
    // disconnections.
    ws.pingInterval = const Duration(seconds: 5);

    _connectedClients.add(ws);
    fine('WebSocket client connected (count: ${_connectedClients.length})');

    // Immediately transmit the recent history.
    for (final message in _clientMetricsBuffer) {
      ws.add(jsonEncode(message));
    }

    // Ensure we're running when a client connects.
    _startMetricsStream();

    ws.listen(
      (data) async {
        try {
          final message = jsonDecode(data as String);
          if (message case {'command': 'docker-start', 'id': final String id}) {
            await _dockerMonitor.startContainer(id);
            _fetchDockerContainers(true);
          } else if (message case {
            'command': 'docker-stop',
            'id': final String id,
          }) {
            await _dockerMonitor.stopContainer(id);
            _fetchDockerContainers(true);
          } else if (message case {
            'command': 'docker-restart',
            'id': final String id,
          }) {
            await _dockerMonitor.restartContainer(id);
            _fetchDockerContainers(true);
          }
        } catch (e) {
          warning('Error handling message:\n$data:\n$e');
        }
      },
      onDone: () {
        if (_connectedClients.remove(ws)) {
          fine(
            'WebSocket client disconnected (count: ${_connectedClients.length})',
          );
          _suspendTimer.reset();
        }
      },
    );
  }

  void _pauseStreamIfNoClients() {
    if (_connectedClients.isNotEmpty) return;

    _stopDockerPolling();

    if (_metricsSubscription case final sub? when !sub.isPaused) {
      _metricsSubscription?.pause();
      _clientMetricsBuffer.clear();
      info('Paused metrics stream and cleared data buffer');
    }
  }

  void _resumeStreamIfClients() {
    if (_connectedClients.isEmpty) return;

    _startDockerPolling();

    if (_metricsSubscription case final sub? when sub.isPaused) {
      _metricsSubscription?.resume();
      info('Resumed metrics stream');

      _suspendTimer.cancel();
    }
  }

  Future<void> _serveStaticFile(HttpRequest request) async {
    final response = request.response;

    var requestPath = request.uri.path;
    if (requestPath == '/') {
      requestPath = '/index.html';
    }

    final webDir = Directory('web').absolute;
    final filePath = path.posix.normalize('web/${requestPath.substring(1)}');
    final file = File(filePath).absolute;

    if (!path.isWithin(webDir.path, file.path)) {
      response
        ..statusCode = HttpStatus.forbidden
        ..write('Forbidden');
      await response.close();
      return;
    }

    if (await file.exists()) {
      final contentType = lookupMimeType(file.path) ?? 'text/html';
      response.headers.contentType = ContentType.parse(contentType);

      await response.addStream(file.openRead());
      await response.close();
    } else {
      response
        ..statusCode = HttpStatus.notFound
        ..write('Not found');
      await response.close();
    }
  }

  void _startDockerPolling() {
    if (_connectedClients.isEmpty || _dockerPollTimer != null) return;

    info('Starting docker polling loop');
    _fetchDockerContainers(false);
    _dockerPollTimer?.cancel();
    _dockerPollTimer = Timer.periodic(
      Duration(seconds: dockerPollSeconds),
      (_) => _fetchDockerContainers(false),
    );
  }

  void _startMetricsStream() {
    _startDockerPolling();

    if (_metricsSubscription != null) {
      _resumeStreamIfClients();
      return;
    }

    info('Starting metrics stream');
    _metricsSubscription = metricsStream.listen((ev) async {
      fine('Processing metrics event');
      final message = {
        if (ev.gpu case final gpu?)
          'gpu': {
            'usagePercent': gpu.usagePercent,
            'powerW': gpu.powerW,
            'temperatureC': gpu.temperatureC,
          },
        'cpu': {'usagePercent': ev.cpu.usagePercent},
        'temperature': {
          'systemTemperatureC': ev.temperature.systemTemperatureC,
        },
        'memory': {
          'usedKB': ev.memory.usedKB,
          'availableKB': ev.memory.availableKB,
          'totalKB': ev.memory.totalKB,
        },
        'docker': _latestDockerContainers
            .map(
              (c) => {
                'id': c.id,
                'image': c.image,
                'command': c.command,
                'created': c.created,
                'status': c.status,
                'ports': c.ports,
                'names': c.names,
                'cpu': c.cpu,
                'memory': c.memory,
              },
            )
            .toList(),
        'keepEvents': keepEvents,
        'nextPollSeconds': pollSeconds,
      };

      // Keep a buffer of events to send to new clients.
      _clientMetricsBuffer.add(message);
      if (_clientMetricsBuffer.length > keepEvents) {
        _clientMetricsBuffer.length = keepEvents;
      }

      // Send to all connected clients.
      final jsonPayload = jsonEncode(message);
      for (final client in _connectedClients.toList()) {
        try {
          client.add(jsonPayload);
        } catch (e) {
          warning('Error sending to client: $e');
        }
      }
    });
  }

  void _stopDockerPolling() {
    _latestDockerContainers = [];
    _dockerPollTimer?.cancel();
    _dockerPollTimer = null;
    info('Stopped docker polling loop');
  }
}
