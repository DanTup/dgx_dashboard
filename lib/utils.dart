import 'package:logging/logging.dart';

final Logger _logger = Logger('dgx_dashboard');

/// Configure application logging.
///
/// INFO logs are enabled by default. Set [verbose] to true to enable FINE.
void configureLogging({required bool verbose}) {
  Logger.root.level = verbose ? Level.FINE : Level.INFO;
  Logger.root.onRecord.listen((record) {
    final timestamp = record.time.toIso8601String();
    print('$timestamp ${record.level.name}: ${record.message}');
  });
}

/// Logs a SEVERE message.
void error(String message) => _logger.severe(message);

/// Logs a FINE message (visible when verbose logging is enabled).
void fine(String message) => _logger.fine(message);

/// Logs an INFO message.
void info(String message) => _logger.info(message);

/// Logs a WARNING message.
void warning(String message) => _logger.warning(message);
