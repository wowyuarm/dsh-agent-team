export const zh = {
  team: '团队',
  backToConversations: '← 对话',
  workspaces: '工作区',
  channels: 'Channels',
  agents: 'Agents',
  members: '成员',
  addWorkspace: '新建工作区',
  selectWorkspace: '选择工作区',
  empty: '选择一个工作区开始团队协作',
  workspacePath: '工作目录',
  teamMode: '团队模式',
  workspaceCreateFailed: '工作区创建失败，请重试',
} as const

export const en = {
  team: 'Team',
  backToConversations: '← Conversations',
  workspaces: 'Workspaces',
  channels: 'Channels',
  agents: 'Agents',
  members: 'Members',
  addWorkspace: 'New workspace',
  selectWorkspace: 'Select workspace',
  empty: 'Select a workspace to start team work',
  workspacePath: 'Working directory',
  teamMode: 'Team mode',
  workspaceCreateFailed: 'Workspace creation failed. Try again.',
} as const

export type TeamKey = keyof typeof zh
