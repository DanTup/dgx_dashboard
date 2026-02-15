import 'dart:io';

import 'utils.dart';

/// Represents a Docker container with status/details.
typedef DockerContainer = ({
  String id,
  String image,
  String command,
  String created,
  String status,
  String ports,
  String names,
  String cpu,
  String memory,
});

/// Monitors Docker containers using the `docker` command-line tool.
class DockerMonitor {
  /// Returns a list of all Docker containers.
  Future<List<DockerContainer>> getContainers() async {
    try {
      final listArgs = [
        'container',
        'ls',
        '--all',
        '--no-trunc',
        '--format',
        '{{.ID}}|{{.Image}}|{{.Command}}|{{.CreatedAt}}|{{.Status}}|{{.Ports}}|{{.Names}}',
      ];
      fine('Executing process: docker ${listArgs.join(' ')}');
      final result = await Process.run('docker', listArgs);
      fine('Process docker container ls exited with code ${result.exitCode}');

      if (result.exitCode != 0) {
        warning('docker container ls failed with code ${result.exitCode}');
        return [];
      }

      final output = result.stdout.toString().trim();
      final lines = output.split('\n');
      if (output.isEmpty || lines.isEmpty) {
        return [];
      }

      // Fetch stats to get CPU/Memory usage.
      final statsArgs = [
        'stats',
        '--all',
        '--no-stream',
        '--no-trunc',
        '--format',
        '{{.ID}}|{{.CPUPerc}}|{{.MemUsage}}',
      ];
      fine('Executing process: docker ${statsArgs.join(' ')}');
      final statsResult = await Process.run('docker', statsArgs);
      fine('Process docker stats exited with code ${statsResult.exitCode}');

      final statsMap = <String, ({String cpu, String memory})>{};
      if (statsResult.exitCode == 0) {
        final statsLines = statsResult.stdout.toString().trim().split('\n');
        for (final line in statsLines) {
          final parts = line.split('|');
          if (parts.length != 3) continue;

          final id = parts[0];
          statsMap[id] = (cpu: parts[1], memory: parts[2]);
        }
      } else {
        warning('docker stats failed with code ${statsResult.exitCode}');
      }

      final containers = <DockerContainer>[];
      for (final line in lines) {
        final parts = line.split('|');
        if (parts.length != 7) continue;

        final id = parts[0];
        final stats = statsMap[id];
        containers.add((
          id: id,
          image: parts[1],
          command: parts[2],
          created: parts[3],
          status: parts[4],
          ports: parts[5],
          names: parts[6],
          cpu: stats?.cpu ?? '--',
          memory: stats?.memory ?? '--',
        ));
      }
      return containers;
    } catch (e) {
      error('Failed to query docker containers: $e');
      return [];
    }
  }

  /// Restarts the container with [id].
  Future<bool> restartContainer(String id) => _runDockerCommand('restart', id);

  /// Starts the container with [id].
  Future<bool> startContainer(String id) => _runDockerCommand('start', id);

  /// Stops the container with [id].
  Future<bool> stopContainer(String id) => _runDockerCommand('stop', id);

  Future<bool> _runDockerCommand(String command, String id) async {
    // Ensure a valid container id (alphanumeric, underscore, hyphen, period).
    // Must be 1-255 chars, no path separators or shell metacharacters.
    if (!RegExp(r'^[a-zA-Z0-9_.-]{1,255}$').hasMatch(id)) {
      warning('Rejected docker command due to invalid container id: $id');
      return false;
    }

    try {
      final args = [command, id];
      fine('Executing process: docker ${args.join(' ')}');
      final result = await Process.run('docker', args);
      fine('Process docker $command exited with code ${result.exitCode}');
      if (result.exitCode != 0) {
        warning('docker $command failed for $id with code ${result.exitCode}');
      }
      return result.exitCode == 0;
    } catch (e) {
      error('Failed to run docker $command for $id: $e');
      return false;
    }
  }
}
