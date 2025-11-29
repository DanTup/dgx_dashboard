import 'dart:core';
import 'dart:io';
import 'dart:math';

import 'package:dgx_dashboard/constants.dart';
import 'package:dgx_dashboard/conversions.dart';
import 'package:dgx_dashboard/cpu.dart';
import 'package:dgx_dashboard/docker.dart';
import 'package:dgx_dashboard/gpu.dart';
import 'package:dgx_dashboard/memory.dart';
import 'package:dgx_dashboard/server.dart';
import 'package:dgx_dashboard/temps.dart';

Future<void> main() async {
  final server = Server(
    MockGpuMonitor(),
    MockCpuMonitor(),
    MockMemoryMonitor(),
    MockTemperatureMonitor(),
    MockDockerMonitor(),
  );
  await server.start(InternetAddress.anyIPv4, 8080);
}

const simulateNvidiaSmiCrash = true;

final _random = Random();

/// A mock implementation of [CpuMonitor] that returns random values.
class MockCpuMonitor implements CpuMonitor {
  var _current = 0;

  @override
  CpuMetrics readMetrics() {
    // Move up or down by up to 10% per tick.
    final change = _random.nextInt(20);
    _current = (_current + (change - 10)).clamp(0, 100);
    return (usagePercent: _current);
  }
}

/// A mock implementation of [DockerMonitor] that returns some hard-coded
/// values.
class MockDockerMonitor implements DockerMonitor {
  final _containers = <DockerContainer>[
    (
      id: 'a1b2c3d4e5f6',
      image: 'fake-web-server:latest',
      command: '/docker-entrypoint.sh serve',
      created: '2025-11-18 19:01:02',
      status: 'Up 2 hours',
      ports: '0.0.0.0:80->80/tcp',
      names: 'web-server',
    ),
    (
      id: 'f6e5d4c3b2a1',
      image: 'postgres:13',
      command: 'docker-entrypoint.sh postgres',
      created: '2025-11-18 01:00:00',
      status: 'Exited (0) 10 minutes ago',
      ports: '',
      names: 'db-server',
    ),
    (
      id: 'd4c3b2a1f6e5',
      image: 'dgx_dashboard:latest',
      command: '/app/bin/server',
      created: '2025-11-18 10:00:00',
      status: 'Up 5 hours',
      ports: '0.0.0.0:8080->8080/tcp',
      names: 'dgx_dashboard',
    ),
  ];

  @override
  Future<List<DockerContainer>> getContainers() async {
    return _containers;
  }

  @override
  Future<bool> restartContainer(String id) async {
    return await stopContainer(id) && await startContainer(id);
  }

  @override
  Future<bool> startContainer(String id) async {
    final index = _containers.indexWhere((c) => c.id == id);
    if (index != -1) {
      final container = _containers[index];
      _containers[index] = (
        id: container.id,
        image: container.image,
        command: container.command,
        created: container.created,
        status: 'Up 1 second',
        ports: container.ports,
        names: container.names,
      );
      return true;
    }
    return false;
  }

  @override
  Future<bool> stopContainer(String id) async {
    final index = _containers.indexWhere((c) => c.id == id);
    if (index != -1) {
      final container = _containers[index];
      _containers[index] = (
        id: container.id,
        image: container.image,
        command: container.command,
        created: container.created,
        status: 'Exited (0) 1 minute ago',
        ports: container.ports,
        names: container.names,
      );
      return true;
    }
    return false;
  }
}

/// A mock implementation of [GpuMonitor] that returns random values.
class MockGpuMonitor implements GpuMonitor {
  var _currentPercent = 0;
  var _currentTemperature = 30;
  var _currentPower = 4.1;

  @override
  late Stream<GpuMetrics?> metrics = () async* {
    yield _computeNext();
    yield* Stream<GpuMetrics?>.periodic(
      Duration(seconds: pollSeconds),
      _computeNext,
    );
  }();

  var _remainingRestarts = 3;

  @override
  bool get hasTerminated => _remainingRestarts == 0;

  GpuMetrics? _computeNext([_]) {
    if (simulateNvidiaSmiCrash && _remainingRestarts-- <= 0) {
      return null;
    }

    _currentPercent = (_currentPercent + (_random.nextInt(20) - 10)).clamp(
      0,
      100,
    );
    _currentTemperature = (_currentTemperature + (_random.nextInt(20) - 10))
        .clamp(20, 90);
    _currentPower = (_currentPower + (_random.nextDouble() * 2 - 1)).clamp(
      3.0,
      130.0,
    );

    return (
      usagePercent: _currentPercent,
      temperatureC: _currentTemperature,
      powerW: _currentPower,
    );
  }
}

/// A mock implementation of [MemoryMonitor] that returns random values.
class MockMemoryMonitor implements MemoryMonitor {
  // Convert the mock total memory from bytes to decimal kilobytes.
  final _totalKB = kibToKB(125513944);
  var _usedKB = 5000000;

  @override
  MemoryMetrics readMetrics() {
    // Move up or down by up to 1GB per tick.
    final changeKB = _random.nextInt(2 * 1000000); // 2 GB range
    _usedKB = (_usedKB + (changeKB - 1000000)).clamp(5000000, _totalKB);
    return (
      totalKB: _totalKB,
      usedKB: _usedKB,
      availableKB: _totalKB - _usedKB,
    );
  }
}

/// A mock implementation of [TemperatureMonitor] that returns random values.
class MockTemperatureMonitor implements TemperatureMonitor {
  var _current = 30.1;

  @override
  TemperatureMetrics readMetrics() {
    // Move up or down by up to 1 degree per tick.
    final change = _random.nextDouble() * 2;
    _current = (_current + (change - 1)).clamp(20, 80);
    return (systemTemperatureC: _current);
  }
}
