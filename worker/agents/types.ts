export interface InferredIntent {
  pageUrl: string
  elementSelector: string
  purpose: string
  elementType: string
  confidence: number
}

export interface FlowStep {
  action: 'click' | 'fill' | 'navigate' | 'wait' | 'assert'
  selector?: string
  value?: string
  description: string
}

export interface AgentFlowSpec {
  name: string
  pageUrl: string
  steps: FlowStep[]
}

export interface FlowResult {
  specName: string
  pageUrl: string
  success: boolean
  completedSteps: number
  totalSteps: number
  error?: string
  screenshotPath?: string
}
