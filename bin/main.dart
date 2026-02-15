import 'dart:async';
import 'dart:io';

import 'package:args/args.dart';
import 'package:dgx_dashboard/cpu.dart';
import 'package:dgx_dashboard/docker.dart';
import 'package:dgx_dashboard/gpu.dart';
import 'package:dgx_dashboard/memory.dart';
import 'package:dgx_dashboard/server.dart';
import 'package:dgx_dashboard/temps.dart';
import 'package:dgx_dashboard/utils.dart';

Future<void> main(List<String> args) async {
  final parser = ArgParser()..addFlag('verbose', abbr: 'v', negatable: false);
  final results = parser.parse(args);
  configureLogging(verbose: results.flag('verbose'));

  final server = Server(
    GpuMonitor(),
    CpuMonitor(),
    MemoryMonitor(),
    TemperatureMonitor(),
    DockerMonitor(),
  );
  await server.start(InternetAddress.anyIPv4, 8080);
}
