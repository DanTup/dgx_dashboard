import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:dgx_dashboard/cpu.dart';
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
  );
  await server.start(InternetAddress.anyIPv4, 8080);
}

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

/// A mock implementation of [GpuMonitor] that returns random values.
class MockGpuMonitor implements GpuMonitor {
  var _currentPercent = 0;
  var _currentTemperature = 30;
  var _currentPower = 4.1;

  @override
  late Stream<GpuMetrics> metrics = Stream<GpuMetrics>.periodic(
    Duration(seconds: 5),
    _computeNext,
  );

  GpuMetrics _computeNext(_) {
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
  final _totalKb = 128 * 1024 * 1024;
  var _usedKb = 5 * 1024 * 1024;

  @override
  MemoryMetrics readMetrics() {
    // Move up or down by up to 1GB per tick.
    final change = _random.nextInt(2048);
    _usedKb = (_usedKb + ((change - 1024) * 1024)).clamp(
      5 * 1024 * 1024,
      _totalKb,
    );
    return (
      totalKb: _totalKb,
      usedKb: _usedKb,
      availableKb: _totalKb - _usedKb,
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
