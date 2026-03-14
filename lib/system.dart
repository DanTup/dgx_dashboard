import 'dart:io';

import 'conversions.dart';
import 'utils.dart';

/// Per-core CPU usage as a percentage (0-100).
typedef CoreUsage = List<int>;

/// A mounted filesystem with usage info.
typedef StorageDevice = ({
  String device,
  String mountPoint,
  String fsType,
  int totalKB,
  int usedKB,
  int availableKB,
});

/// System-level metrics not covered by other monitors.
typedef SystemMetrics = ({
  List<double> loadAverage,
  CoreUsage coreUsage,
  int cachedKB,
  int buffersKB,
  int swapTotalKB,
  int swapUsedKB,
  DiskIO diskIO,
  NetIO netIO,
  List<StorageDevice> storage,
});

/// Disk read/write bytes since last sample.
typedef DiskIO = ({int readBytesPerSec, int writeBytesPerSec});

/// Network receive/transmit bytes since last sample.
typedef NetIO = ({int rxBytesPerSec, int txBytesPerSec});

/// Monitors system-level metrics: load average, per-core CPU, memory
/// breakdown, disk I/O, and network I/O.
class SystemMonitor {
  /// Previous per-core CPU jiffies for delta calculation.
  List<({int idle, int total})>? _prevCoreJiffies;

  /// Previous disk stats for delta calculation.
  ({int readSectors, int writeSectors, DateTime time})? _prevDisk;

  /// Previous network stats for delta calculation.
  ({int rxBytes, int txBytes, DateTime time})? _prevNet;

  SystemMetrics readMetrics() {
    return (
      loadAverage: _readLoadAverage(),
      coreUsage: _readCoreUsage(),
      cachedKB: 0, // Filled below
      buffersKB: 0,
      swapTotalKB: 0,
      swapUsedKB: 0,
      diskIO: _readDiskIO(),
      netIO: _readNetIO(),
      storage: _readStorage(),
    )._withMemoryBreakdown(_readMemoryBreakdown());
  }

  List<double> _readLoadAverage() {
    try {
      final line = File('/proc/loadavg').readAsStringSync().trim();
      final parts = line.split(' ');
      return [
        double.tryParse(parts[0]) ?? 0.0,
        double.tryParse(parts[1]) ?? 0.0,
        double.tryParse(parts[2]) ?? 0.0,
      ];
    } catch (e) {
      fine('Failed to read /proc/loadavg: $e');
      return [0.0, 0.0, 0.0];
    }
  }

  CoreUsage _readCoreUsage() {
    try {
      final lines = File('/proc/stat').readAsLinesSync();
      final coreLines =
          lines.where((l) => l.startsWith('cpu') && !l.startsWith('cpu ')).toList();

      final currentJiffies = <({int idle, int total})>[];
      for (final line in coreLines) {
        final parts = line.split(RegExp(r'\s+')).skip(1).toList();
        if (parts.length < 7) continue;

        final values = parts.map((s) => int.tryParse(s) ?? 0).toList();
        // user, nice, system, idle, iowait, irq, softirq, [steal, guest, guest_nice]
        final idle = values[3] + (values.length > 4 ? values[4] : 0); // idle + iowait
        final total = values.fold(0, (a, b) => a + b);
        currentJiffies.add((idle: idle, total: total));
      }

      final prev = _prevCoreJiffies;
      _prevCoreJiffies = currentJiffies;

      if (prev == null || prev.length != currentJiffies.length) {
        return List.filled(currentJiffies.length, 0);
      }

      return List.generate(currentJiffies.length, (i) {
        final deltaTotal = currentJiffies[i].total - prev[i].total;
        final deltaIdle = currentJiffies[i].idle - prev[i].idle;
        if (deltaTotal <= 0) return 0;
        return ((1.0 - deltaIdle / deltaTotal) * 100).clamp(0.0, 100.0).round();
      });
    } catch (e) {
      fine('Failed to read /proc/stat: $e');
      return [];
    }
  }

  ({int cachedKB, int buffersKB, int swapTotalKB, int swapUsedKB})
      _readMemoryBreakdown() {
    int? cachedKiB, buffersKiB, swapTotalKiB, swapFreeKiB;
    try {
      for (final line in File('/proc/meminfo').readAsLinesSync()) {
        final value = int.tryParse(line.replaceAll(RegExp(r'[^0-9]'), ''));
        if (line.startsWith('Cached:')) cachedKiB = value;
        else if (line.startsWith('Buffers:')) buffersKiB = value;
        else if (line.startsWith('SwapTotal:')) swapTotalKiB = value;
        else if (line.startsWith('SwapFree:')) swapFreeKiB = value;

        if (cachedKiB != null &&
            buffersKiB != null &&
            swapTotalKiB != null &&
            swapFreeKiB != null) break;
      }
    } catch (e) {
      fine('Failed to read /proc/meminfo breakdown: $e');
    }

    final swapTotalKB = kibToKB(swapTotalKiB ?? 0);
    final swapFreeKB = kibToKB(swapFreeKiB ?? 0);
    return (
      cachedKB: kibToKB(cachedKiB ?? 0),
      buffersKB: kibToKB(buffersKiB ?? 0),
      swapTotalKB: swapTotalKB,
      swapUsedKB: (swapTotalKB - swapFreeKB).clamp(0, swapTotalKB),
    );
  }

  DiskIO _readDiskIO() {
    try {
      // Sum all physical disks (skip partitions — only entries with major 8 or 259).
      int readSectors = 0, writeSectors = 0;
      for (final line in File('/proc/diskstats').readAsLinesSync()) {
        final parts = line.trim().split(RegExp(r'\s+'));
        if (parts.length < 14) continue;
        final name = parts[2];
        // Only whole disks: sda, nvme0n1, etc. Skip partitions.
        if (RegExp(r'\d+$').hasMatch(name) && !name.startsWith('nvme')) continue;
        if (name.contains('loop') || name.contains('ram') || name.contains('dm-')) continue;
        readSectors += int.tryParse(parts[5]) ?? 0;
        writeSectors += int.tryParse(parts[9]) ?? 0;
      }

      final now = DateTime.now();
      final prev = _prevDisk;
      _prevDisk = (readSectors: readSectors, writeSectors: writeSectors, time: now);

      if (prev == null) return (readBytesPerSec: 0, writeBytesPerSec: 0);

      final elapsed = now.difference(prev.time).inMilliseconds / 1000.0;
      if (elapsed <= 0) return (readBytesPerSec: 0, writeBytesPerSec: 0);

      // Sectors are 512 bytes.
      return (
        readBytesPerSec: ((readSectors - prev.readSectors) * 512 / elapsed).round(),
        writeBytesPerSec: ((writeSectors - prev.writeSectors) * 512 / elapsed).round(),
      );
    } catch (e) {
      fine('Failed to read /proc/diskstats: $e');
      return (readBytesPerSec: 0, writeBytesPerSec: 0);
    }
  }

  NetIO _readNetIO() {
    try {
      int rxBytes = 0, txBytes = 0;
      for (final line in File('/proc/net/dev').readAsLinesSync()) {
        if (!line.contains(':')) continue;
        final ifName = line.split(':')[0].trim();
        if (ifName == 'lo') continue; // Skip loopback.
        final parts = line.split(':')[1].trim().split(RegExp(r'\s+'));
        if (parts.length < 10) continue;
        rxBytes += int.tryParse(parts[0]) ?? 0;
        txBytes += int.tryParse(parts[8]) ?? 0;
      }

      final now = DateTime.now();
      final prev = _prevNet;
      _prevNet = (rxBytes: rxBytes, txBytes: txBytes, time: now);

      if (prev == null) return (rxBytesPerSec: 0, txBytesPerSec: 0);

      final elapsed = now.difference(prev.time).inMilliseconds / 1000.0;
      if (elapsed <= 0) return (rxBytesPerSec: 0, txBytesPerSec: 0);

      return (
        rxBytesPerSec: ((rxBytes - prev.rxBytes) / elapsed).round(),
        txBytesPerSec: ((txBytes - prev.txBytes) / elapsed).round(),
      );
    } catch (e) {
      fine('Failed to read /proc/net/dev: $e');
      return (rxBytesPerSec: 0, txBytesPerSec: 0);
    }
  }

  List<StorageDevice> _readStorage() {
    try {
      final result = Process.runSync('df', ['-BK', '--output=source,fstype,size,used,avail,target']);
      if (result.exitCode != 0) return [];

      final lines = (result.stdout as String).trim().split('\n');
      if (lines.length < 2) return [];

      // Skip virtual/pseudo filesystems.
      const skipFsTypes = {
        'tmpfs', 'devtmpfs', 'sysfs', 'proc', 'devpts', 'securityfs',
        'cgroup', 'cgroup2', 'pstore', 'debugfs', 'hugetlbfs', 'mqueue',
        'configfs', 'fusectl', 'tracefs', 'bpf', 'nsfs', 'efivarfs',
        'autofs', 'squashfs', 'fuse.snapfuse',
      };

      final devices = <StorageDevice>[];
      for (final line in lines.skip(1)) {
        final parts = line.trim().split(RegExp(r'\s+'));
        if (parts.length < 6) continue;

        final fsType = parts[1];
        if (skipFsTypes.contains(fsType)) continue;

        // Skip Docker overlay and shm mounts.
        final source = parts[0];
        final mount = parts.sublist(5).join(' ');
        if (fsType == 'overlay' && mount != '/') continue;
        if (mount.startsWith('/var/lib/docker')) continue;

        // Parse sizes (df -BK outputs values like "123456K").
        int parseKB(String s) => int.tryParse(s.replaceAll('K', '')) ?? 0;

        devices.add((
          device: source,
          mountPoint: mount,
          fsType: fsType,
          totalKB: parseKB(parts[2]),
          usedKB: parseKB(parts[3]),
          availableKB: parseKB(parts[4]),
        ));
      }
      return devices;
    } catch (e) {
      fine('Failed to read storage info: $e');
      return [];
    }
  }
}

/// Helper to merge memory breakdown into SystemMetrics.
extension on SystemMetrics {
  SystemMetrics _withMemoryBreakdown(
    ({int cachedKB, int buffersKB, int swapTotalKB, int swapUsedKB}) mem,
  ) {
    return (
      loadAverage: loadAverage,
      coreUsage: coreUsage,
      cachedKB: mem.cachedKB,
      buffersKB: mem.buffersKB,
      swapTotalKB: mem.swapTotalKB,
      swapUsedKB: mem.swapUsedKB,
      diskIO: diskIO,
      netIO: netIO,
      storage: storage,
    );
  }
}
