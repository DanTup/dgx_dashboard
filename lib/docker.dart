import 'dart:io';

/// Represents a Docker container with status/details.
typedef DockerContainer = ({
  String id,
  String image,
  String command,
  String created,
  String status,
  String ports,
  String names,
});

/// Monitors Docker containers using the `docker` command-line tool.
class DockerMonitor {
  /// Returns a list of all Docker containers.
  Future<List<DockerContainer>> getContainers() async {
    try {
      final result = await Process.run('docker', [
        'container',
        'ls',
        '--all',
        '--no-trunc',
        '--format',
        '{{.ID}}|{{.Image}}|{{.Command}}|{{.CreatedAt}}|{{.Status}}|{{.Ports}}|{{.Names}}',
      ]);

      if (result.exitCode != 0) {
        return [];
      }

      final lines = result.stdout.toString().trim().split('\n');
      if (lines.isEmpty) {
        return [];
      }

      final containers = <DockerContainer>[];
      for (final line in lines) {
        final parts = line.split('|');
        if (parts.length == 7) {
          containers.add((
            id: parts[0],
            image: parts[1],
            command: parts[2],
            created: parts[3],
            status: parts[4],
            ports: parts[5],
            names: parts[6],
          ));
        }
      }
      return containers;
    } catch (e) {
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
    try {
      final result = await Process.run('docker', [command, id]);
      return result.exitCode == 0;
    } catch (e) {
      return false;
    }
  }
}
