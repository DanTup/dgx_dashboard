let usageChart, tempChart, memoryGauge, memoryLineChart;

// Historical data for line charts.
const historySize = 10;
const gpuHistory = [];
const cpuHistory = [];
const gpuTempHistory = [];
const systemTempHistory = [];
const memoryHistory = [];

// Consistent colors for GPU and CPU.
const GPU_COLOR = 'rgb(75, 192, 192)';
const GPU_BG_COLOR = 'rgba(75, 192, 192, 0.1)';
const CPU_COLOR = 'rgb(54, 162, 235)';
const CPU_BG_COLOR = 'rgba(54, 162, 235, 0.1)';

function createGauge(canvasId, label, maxValue, yellowFrom, redFrom) {
	const ctx = document.getElementById(canvasId).getContext('2d');

	return new Chart(ctx, {
		type: 'doughnut',
		data: {
			datasets: [{
				data: [0, maxValue],
				backgroundColor: [
					'rgb(75, 192, 192)',
					'rgb(230, 230, 230)'
				],
				borderWidth: 0,
				circumference: 180,
				rotation: 270,
				cutout: '60%',
			}]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			aspectRatio: 2,
			plugins: {
				legend: {
					display: false
				},
				tooltip: {
					enabled: false
				},
				annotation: {
					annotations: {
						usedLabel: {
							type: 'doughnutLabel',
							content: '0',
							font: {
								size: 32,
								weight: 'bold'
							},
							color: 'black',
							yAdjust: 20,
							position: {
								x: 'center',
								y: '80%'
							}
						},
						totalLabel: {
							type: 'doughnutLabel',
							content: label,
							font: {
								size: 14
							},
							color: 'gray',
							yAdjust: 20,
							position: {
								x: 'center',
								y: '0%'
							},
						}
					}
				}
			}
		}
	});
}

function updateGauge(chart, value, maxValue) {
	const yellowFrom = maxValue * 0.6;
	const redFrom = maxValue * 0.8;

	let color;
	if (value >= redFrom) {
		color = 'rgb(255, 99, 132)';
	} else if (value >= yellowFrom) {
		color = 'rgb(255, 205, 86)';
	} else {
		color = 'rgb(75, 192, 192)';
	}

	// Truncate so we we get 128GB when it's actually 128.5
	maxValue = Math.trunc(maxValue);
	if (value > maxValue) {
		value = maxValue;
	}

	chart.data.datasets[0].data = [value, maxValue - value];
	chart.data.datasets[0].backgroundColor = [color, 'rgb(230, 230, 230)'];
	chart.options.plugins.annotation.annotations.usedLabel.content = `${value.toFixed(1)}GB`;
	chart.options.plugins.annotation.annotations.totalLabel.content = `/${maxValue}GB`;
	chart.update('none');
}

function initCharts() {
	// Usage line chart
	const usageCtx = document.getElementById('usage-chart').getContext('2d');
	usageChart = new Chart(usageCtx, {
		type: 'line',
		data: {
			labels: [],
			datasets: [{
				label: 'GPU %',
				data: [],
				borderColor: GPU_COLOR,
				backgroundColor: GPU_BG_COLOR,
				tension: 0.4,
			}, {
				label: 'CPU %',
				data: [],
				borderColor: CPU_COLOR,
				backgroundColor: CPU_BG_COLOR,
				tension: 0.4,
			}]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			scales: {
				y: {
					beginAtZero: true,
					max: 100,
					title: {
						display: true,
						text: 'Usage %'
					}
				},
				x: {
					display: false
				}
			},
			plugins: {
				legend: {
					position: 'bottom',
				}
			}
		}
	});

	// Temperature line chart (combined GPU and CPU)
	const tempCtx = document.getElementById('temp-chart').getContext('2d');
	tempChart = new Chart(tempCtx, {
		type: 'line',
		data: {
			labels: [],
			datasets: [{
				label: 'GPU °C',
				data: [],
				borderColor: GPU_COLOR,
				backgroundColor: GPU_BG_COLOR,
				tension: 0.4,
			}, {
				label: 'System °C',
				data: [],
				borderColor: CPU_COLOR,
				backgroundColor: CPU_BG_COLOR,
				tension: 0.4,
			}]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			scales: {
				y: {
					beginAtZero: true,
					max: 100,
					title: {
						display: true,
						text: 'Temperature °C'
					}
				},
				x: {
					display: false
				}
			},
			plugins: {
				legend: {
					position: 'bottom'
				}
			}
		}
	});

	memoryGauge = createGauge('memory-gauge', '/128GB', 100, 60, 80);

	const memoryCtx = document.getElementById('memory-chart').getContext('2d');
	memoryLineChart = new Chart(memoryCtx, {
		type: 'line',
		data: {
			labels: [],
			datasets: [{
				label: 'Memory',
				data: [],
				borderColor: 'rgb(75, 192, 192)', // Default green color
				backgroundColor: 'rgba(75, 192, 192, 0.1)',
				tension: 0.4,
				segment: {
					borderColor: ctx => {
						// Get the max value from the y-axis scale
						const maxValue = ctx.chart.options.scales.y.max;
						const yellowThreshold = maxValue * 0.6;
						const redThreshold = maxValue * 0.8;

						// Get the value at the end of this segment
						const value = ctx.p1.parsed.y;

						if (value >= redThreshold) {
							return 'rgb(255, 99, 132)'; // Red
						} else if (value >= yellowThreshold) {
							return 'rgb(255, 205, 86)'; // Yellow
						} else {
							return 'rgb(75, 192, 192)'; // Green
						}
					}
				}
			}]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			scales: {
				y: {
					beginAtZero: true,
					max: 128,
					title: {
						display: true,
						text: 'GB'
					}
				},
				x: {
					display: false
				}
			},
			plugins: {
				legend: {
					display: false
				}
			}
		}
	});
}

function updateCharts(data) {
	// Convert KB to GB
	const usedGB = data.memory.usedKB / 1000000;
	const totalGB = data.memory.totalKB / 1000000;
	const memoryUsed = parseFloat(usedGB.toFixed(1));

	gpuHistory.push(data.gpu.usagePercent);
	cpuHistory.push(data.cpu.usagePercent);
	gpuTempHistory.push(data.gpu.temperatureC);
	systemTempHistory.push(data.temperature.systemTemperatureC);
	memoryHistory.push(memoryUsed);

	if (gpuHistory.length > historySize) {
		gpuHistory.shift();
		cpuHistory.shift();
		gpuTempHistory.shift();
		systemTempHistory.shift();
		memoryHistory.shift();
	}

	// Update usage line chart.
	usageChart.data.labels = Array.from({ length: gpuHistory.length }, (_, i) => i + 1);
	usageChart.data.datasets[0].data = [...gpuHistory];
	usageChart.data.datasets[1].data = [...cpuHistory];
	usageChart.update('none');

	// Update GPU power label.
	document.getElementById('gpu-power-label').textContent =
		`GPU Power: ${data.gpu.powerW.toFixed(0)} W`;

	// Update temperature line chart.
	tempChart.data.labels = Array.from({ length: gpuTempHistory.length }, (_, i) => i + 1);
	tempChart.data.datasets[0].data = [...gpuTempHistory];
	tempChart.data.datasets[1].data = [...systemTempHistory];
	tempChart.update('none');

	// Update memory gauge.
	updateGauge(memoryGauge, memoryUsed, totalGB);
	memoryGauge.update('none');

	// Update memory line chart.
	memoryLineChart.data.labels = Array.from({ length: memoryHistory.length }, (_, i) => i + 1);
	memoryLineChart.data.datasets[0].data = [...memoryHistory];
	memoryLineChart.update('none');

	// Update browser tab title.
	const maxUsage = Math.max(data.gpu.usagePercent, data.cpu.usagePercent);
	const maxTemp = Math.max(data.gpu.temperatureC, data.temperature.systemTemperatureC);
	document.title = `DGX ${Math.trunc(usedGB).toFixed(0)}GB ${maxUsage.toFixed(0)}% ${maxTemp.toFixed(0)}°`;

}

function updateDocker(data) {
	const dockerSection = document.getElementById('docker-section');
	const tableBody = document.getElementById('docker-table-body');
	const template = document.getElementById('docker-row-template');

	if (!data.docker || data.docker.length === 0) {
		dockerSection.style.display = 'none';
		return;
	}

	dockerSection.style.display = 'block';
	tableBody.innerHTML = '';

	data.docker.forEach(container => {
		const clone = template.content.cloneNode(true);

		clone.querySelector('.image').textContent = container.image;
		clone.querySelector('.name').textContent = container.names;
		clone.querySelector('.ports').textContent = container.ports;
		clone.querySelector('.status').textContent = `${container.status}`;

		const isRunning = container.status.toLowerCase().startsWith('up ');
		const statusClass = isRunning ? 'status-running' : 'status-stopped';
		const statusLabel = isRunning ? 'Running' : 'Stopped';

		const badge = clone.querySelector('.status-badge');
		badge.textContent = statusLabel;
		badge.classList.add(statusClass);

		tableBody.appendChild(clone);
	});
}

const statusDiv = document.getElementById('status');
const progressBar = document.getElementById('progress-bar');

function startProgressBar(seconds) {
	if (!progressBar) return;

	progressBar.style.transition = 'none';
	progressBar.style.width = '100%';

	// Force reflow to apply the reset before starting transition.
	progressBar.offsetHeight;

	progressBar.style.transition = `width ${seconds}s linear`;
	requestAnimationFrame(() => progressBar.style.width = '0%');
}

function connect() {
	const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

	ws.onopen = () => {
		statusDiv.textContent = 'Connected';
		statusDiv.style.color = '#4ec9b0';
		// Begin progress bar animation assuming default interval of 5 seconds.
		startProgressBar(5);
	};

	ws.onmessage = (event) => {
		const data = JSON.parse(event.data);

		if (data == null) {
			statusDiv.textContent = 'nvidia-smi has crashed, see log output';
			statusDiv.style.color = '#f48771';
			console.error('nvidia-smi has crashed, see log output');
			return;
		}

		updateCharts(data);
		updateDocker(data);

		// Start or restart the progress bar based on the server-provided interval.
		startProgressBar(data.nextPollSeconds);
	};

	ws.onerror = (error) => {
		statusDiv.textContent = 'Error';
		statusDiv.style.color = '#f48771';
		console.error('WebSocket error:', error);
	};

	ws.onclose = () => {
		statusDiv.textContent = 'Disconnected - Reconnecting...';
		statusDiv.style.color = '#ce9178';
		setTimeout(connect, 1000);
	};
}

// Initialize charts when page loads
document.addEventListener('DOMContentLoaded', () => {
	initCharts();
	connect();
});
