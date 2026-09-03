export interface HealthResponse {
  status: 'ok'
  service: string
  environment: string
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${apiBaseUrl}/health`, { signal })

  if (!response.ok) {
    throw new Error(`健康检查失败：HTTP ${response.status}`)
  }

  return (await response.json()) as HealthResponse
}
