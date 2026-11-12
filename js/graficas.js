let chartGeneral;

function inicializarGraficas() {
    const ctx = document.getElementById('graficaGeneral');
    if (!ctx) return;
    if (chartGeneral) chartGeneral.destroy();
    
    chartGeneral = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Humedad del Suelo (%)',
                    borderColor: '#2563eb',
                    backgroundColor: 'rgba(37, 99, 235, 0.1)',
                    data: [],
                    borderWidth: 3,
                    tension: 0.3,
                    fill: true,
                    yAxisID: 'y'
                },
                {
                    label: 'Temperatura (°C)',
                    borderColor: '#dc2626',
                    backgroundColor: 'rgba(220, 38, 38, 0.05)',
                    data: [],
                    borderWidth: 2.5,
                    tension: 0.3,
                    fill: false,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        font: {
                            weight: 'bold',
                            size: 12
                        },
                        padding: 20
                    }
                },
                tooltip: {
                    backgroundColor: '#1e293b',
                    titleFont: { size: 13, weight: 'bold' },
                    bodyFont: { size: 12 },
                    padding: 12,
                    cornerRadius: 8
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { font: { weight: '600', size: 11 } }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    min: 0,
                    max: 100,
                    title: {
                        display: true,
                        text: 'Humedad Suelo (%)',
                        color: '#2563eb',
                        font: { weight: 'bold', size: 11 }
                    },
                    grid: { color: '#f1f5f9' },
                    ticks: { color: '#2563eb', font: { weight: '600' } }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    min: 0,
                    max: 50,
                    title: {
                        display: true,
                        text: 'Temperatura (°C)',
                        color: '#dc2626',
                        font: { weight: 'bold', size: 11 }
                    },
                    grid: { drawOnChartArea: false }, // evita líneas duplicadas
                    ticks: { color: '#dc2626', font: { weight: '600' } }
                }
            }
        }
    });
    if (typeof repoblarGrafica === 'function') repoblarGrafica();
}
