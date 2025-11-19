import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'constants.dart';
import 'utils.dart';

/// Represents GPU usage metrics.
typedef GpuMetrics = ({int usagePercent, int temperatureC, double powerW});

/// Monitors GPU metrics using `nvidia-smi`.
///
/// This monitor streams GPU metrics (utilization, temperature, and power draw)
/// from the nvidia-smi command-line tool. The underlying process is only active
/// while there is an active (unpaused) listener on the metrics stream.
class GpuMonitor {
  final StreamController<GpuMetrics?> _metricsController;
  Process? _nvidiaSmiProcess;
  StreamSubscription<String>? _processOutputSubscription;

  /// The number of restarts of nvidia-smi remaining.
  var _remainingRestarts = maxNvidiaSmiRestarts;

  /// Creates a new GPU monitor.
  ///
  /// The monitor will automatically start and stop the `nvidia-smi` process
  /// based on the stream subscription state.
  GpuMonitor() : _metricsController = StreamController<GpuMetrics>() {
    _metricsController
      ..onListen = _start
      ..onPause = _stop
      ..onResume = _start
      ..onCancel = _stop;
  }

  /// Whether the process has terminated the maximum number of times and won't
  /// start again.
  bool get hasTerminated => _remainingRestarts == 0;

  /// A stream of GPU metrics.
  ///
  /// Subscribe to this stream to receive periodic GPU metrics updates.
  /// The `nvidia-smi` process is automatically managed based on subscription
  /// state.
  ///
  /// If the `nvidia-smi` process crashes too many times and will not be
  /// restarted, a `null` will be emitted.
  Stream<GpuMetrics?> get metrics => _metricsController.stream;

  /// Whether the `nvidia-smi` process is running.
  bool get _isRunning => _nvidiaSmiProcess != null;

  void _handleProcessDone() {
    // If `nvidia-smi` quit but consumer still wants data, attempt restart.
    if (_metricsController.hasListener && !_metricsController.isPaused) {
      _stop();
      if (_remainingRestarts > 0) {
        log(
          'nvidia-smi process terminated unexpectedly - ${--_remainingRestarts} restarts remaining',
        );
        Future<void>.delayed(const Duration(seconds: 1)).then((_) => _start());
      } else {
        log('nvidia-smi process terminated unexpectedly - will not restart');
        _metricsController.add(null);
      }
    }
  }

  /// Parse an output line from `nvidia-smi` and emit an event with the metrics.
  void _parseAndEmitMetrics(String line) {
    final parts = line.split(',').map((s) => s.trim()).toList();
    if (parts.length < 3) return;

    try {
      _metricsController.add((
        usagePercent: int.parse(parts[0]),
        temperatureC: int.parse(parts[1]),
        powerW: double.parse(parts[2]),
      ));
    } catch (_) {
      // Ignore malformed lines.
    }
  }

  /// Starts the `nvidia-smi` process to collect metrics if it is not already
  /// running.
  Future<void> _start() async {
    if (_isRunning) return;

    try {
      // Use the shared poll interval constant.
      final process = _nvidiaSmiProcess = await Process.start('nvidia-smi', [
        '--query-gpu=utilization.gpu,temperature.gpu,power.draw',
        '--format=csv,noheader,nounits',
        '-l=$pollSeconds',
      ]);

      unawaited(
        process.exitCode.then((code) {
          log('nvidia-semi terminated with $exitCode');
        }),
      );

      _processOutputSubscription = process.stdout
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen(
            _parseAndEmitMetrics,
            onDone: _handleProcessDone,
            onError: (Object error, StackTrace stackTrace) {
              _metricsController.addError(error, stackTrace);
            },
          );

      // Forward stderr messages as errors
      process.stderr.transform(utf8.decoder).listen((errorOutput) {
        final trimmed = errorOutput.trim();
        if (trimmed.isNotEmpty) {
          log('nvidia-smi stderr: $trimmed');
          _metricsController.addError(StateError('nvidia-smi: $trimmed'));
        }
      });
    } catch (error, stackTrace) {
      _metricsController.addError(error, stackTrace);
      _stop();
    }
  }

  /// Stops the `nvidia-smi` process.
  void _stop() {
    _processOutputSubscription?.cancel();
    _processOutputSubscription = null;
    _nvidiaSmiProcess?.kill();
    _nvidiaSmiProcess = null;
  }
}
