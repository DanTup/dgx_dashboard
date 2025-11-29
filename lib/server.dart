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
  var _lastDockerUpdate = DateTime.fromMillisecondsSinceEpoch(0);

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
    log('Server listening on http://$clickableHost:$port');

    await server.map(_handleRequest).toList();
  }

  Future<List<DockerContainer>> _getDockerContainers() async {
    final now = DateTime.now();
    if (now.difference(_lastDockerUpdate).inSeconds > dockerPollSeconds) {
      _latestDockerContainers = await _dockerMonitor.getContainers();
      _latestDockerContainers.sort((c1, c2) => c1.names.compareTo(c2.names));
      _lastDockerUpdate = now;
    }
    return _latestDockerContainers;
  }

  Future<void> _handleRequest(HttpRequest request) async {
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
    final ws = await WebSocketTransformer.upgrade(request);

    // We need the ping otherwise onDone will never fire and we'll never detect
    // disconnections.
    ws.pingInterval = const Duration(seconds: 5);

    _connectedClients.add(ws);

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
            _lastDockerUpdate = DateTime.fromMillisecondsSinceEpoch(0);
          } else if (message case {
            'command': 'docker-stop',
            'id': final String id,
          }) {
            await _dockerMonitor.stopContainer(id);
            _lastDockerUpdate = DateTime.fromMillisecondsSinceEpoch(0);
          } else if (message case {
            'command': 'docker-restart',
            'id': final String id,
          }) {
            await _dockerMonitor.restartContainer(id);
            _lastDockerUpdate = DateTime.fromMillisecondsSinceEpoch(0);
          }
        } catch (e) {
          log('Error handling message:\n$data:\n$e');
        }
      },
      onDone: () {
        if (_connectedClients.remove(ws)) {
          _suspendTimer.reset();
        }
      },
    );
  }

  void _pauseStreamIfNoClients() {
    if (_connectedClients.isNotEmpty) return;

    if (_metricsSubscription case final sub? when !sub.isPaused) {
      _metricsSubscription?.pause();
      _clientMetricsBuffer.clear();
      log('Paused metrics stream and cleared data buffer');
    }
  }

  void _resumeStreamIfClients() {
    if (_connectedClients.isEmpty) return;

    if (_metricsSubscription case final sub? when sub.isPaused) {
      _metricsSubscription?.resume();
      log('Resumed metrics stream');

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

  void _startMetricsStream() {
    if (_metricsSubscription != null) {
      _resumeStreamIfClients();
      return;
    }

    log('Starting metrics stream');
    _metricsSubscription = metricsStream.listen((ev) async {
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
        'docker': (await _getDockerContainers())
            .map(
              (c) => {
                'id': c.id,
                'image': c.image,
                'command': c.command,
                'created': c.created,
                'status': c.status,
                'ports': c.ports,
                'names': c.names,
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
          log('Error sending to client: $e');
        }
      }
    });
  }
}
