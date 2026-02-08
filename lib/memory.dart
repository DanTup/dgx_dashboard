import 'dart:io';

import 'conversions.dart';
import 'utils.dart';

/// Represents memory usage metrics.
typedef MemoryMetrics = ({int totalKB, int usedKB, int availableKB});

/// Monitors system memory usage by reading from `/proc/meminfo`.
///
/// This monitor reads total and available memory from the Linux `/proc/meminfo`
/// file and calculates used memory.
class MemoryMonitor {
  /// Reads the current memory usage metrics.
  ///
  /// Returns a [MemoryMetrics] record containing total, used, and available
  /// memory in kilobytes. Returns zeros if the data cannot be read.
  MemoryMetrics readMetrics() {
    int? totalKiB;
    int? availableKiB;

    for (final line in File('/proc/meminfo').readAsLinesSync()) {
      if (totalKiB == null && line.startsWith('MemTotal:')) {
        totalKiB = int.tryParse(line.replaceAll(RegExp(r'[^0-9]'), ''));
        // If parsing failed, set to 0 to prevent infinite searching
        if (totalKiB == null) {
          log('Warning: Failed to parse MemTotal from /proc/meminfo: $line');
          totalKiB = 0;
        }
      } else if (availableKiB == null && line.startsWith('MemAvailable:')) {
        availableKiB = int.tryParse(line.replaceAll(RegExp(r'[^0-9]'), ''));
        // If parsing failed, set to 0 to prevent infinite searching
        if (availableKiB == null) {
          log('Warning: Failed to parse MemAvailable from /proc/meminfo: $line');
          availableKiB = 0;
        }
      }

      // Exit early once we have both values
      if (totalKiB != null && availableKiB != null) break;
    }

    // Convert KiB (binary) to KB (decimal) using the helper.
    final totalKB = kibToKB(totalKiB ?? 0);
    final availableKB = kibToKB(availableKiB ?? 0);
    final usedKB = (totalKB - availableKB).clamp(0, totalKB);

    return (totalKB: totalKB, usedKB: usedKB, availableKB: availableKB);
  }
}
